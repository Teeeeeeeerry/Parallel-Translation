// Phase 3 — MutationObserver 增量补翻。
//
// 监听 DOM 变化，对新增节点补翻。
// 覆盖三种场景：无限滚动、SPA 路由切换、懒加载内容。
//
// 关键设计决策：
// - 只监听 childList，绝不监听 characterData 或属性 ——
//   否则插入译文 → 触发 mutation → 再次采集 → 再次插入 → 死循环
// - 防抖 300ms：无限滚动一次加载能产生数百条 mutation record，
//   不防抖会导致全量采集与翻译请求瞬间打爆并发闸门
// - 每个 shadowRoot 各挂一个 MutationObserver ——
//   MutationObserver 与 TreeWalker 一样不穿透 shadow 边界

import { collect } from './walker';

/**
 * 递归收集 root 下所有 shadowRoot，对每个挂载 observer。
 * 已观察的 shadowRoot 不会重复挂载。
 * 返回本次新增的 observer 数组。
 */
function observeShadowRoots(
  root: Node,
  onMutation: (records: MutationRecord[]) => void,
  seen: WeakSet<ShadowRoot>,
): MutationObserver[] {
  const observers: MutationObserver[] = [];

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.shadowRoot && !seen.has(el.shadowRoot)) {
      seen.add(el.shadowRoot);
      const mo = new MutationObserver(onMutation);
      mo.observe(el.shadowRoot, { childList: true, subtree: true });
      observers.push(mo);
      // 递归：shadow 内可能还有嵌套 shadow host
      el.shadowRoot.querySelectorAll('*').forEach((child) => walk(child));
    }
    // light DOM 子元素
    el.querySelectorAll?.('*')?.forEach((child) => walk(child));
  };

  walk(root);
  return observers;
}

/**
 * 启动 MutationObserver，对新增节点触发补翻回调。
 * 返回取消订阅函数。
 */
export function startObserver(
  onNewNodes: (els: Element[]) => void,
): () => void {
  let pending: Node[] = [];
  let timer: number | undefined;
  // 所有活跃的 observer 列表（主文档 + 各 shadow root）
  const observers: MutationObserver[] = [];
  // 已挂载 observer 的 shadowRoot，避免重复观察
  const observedRoots = new WeakSet<ShadowRoot>();

  const flush = () => {
    timer = undefined;
    const batch = pending;
    pending = [];
    const found = batch.flatMap((n) =>
      n.nodeType === Node.ELEMENT_NODE ? collect(n) : [],
    );

    // 新增节点中可能出现新的 shadow host，为其 shadow root 补挂 observer
    for (const n of batch) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const subs = observeShadowRoots(n, onMutationRecord, observedRoots);
        observers.push(...subs);
      }
    }

    if (found.length) onNewNodes(found);
  };

  const onMutationRecord = (records: MutationRecord[]) => {
    for (const r of records) {
      // 只看新增节点。属性变化、文本变化不触发重翻，
      // 否则会与自身渲染互相激发
      for (const n of r.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const el = n as HTMLElement;
        // 忽略自己插入的译文与自己的 UI，否则形成无限循环
        if (el.classList?.contains('pt-trans')) continue;
        if (el.dataset?.ptUi === '1') continue;
        pending.push(n);
      }
    }
    // 防抖：无限滚动会在极短时间内产生大量 mutation
    if (pending.length && timer === undefined) {
      timer = self.setTimeout(flush, 300);
    }
  };

  // 主文档 observer
  const mainMo = new MutationObserver(onMutationRecord);
  mainMo.observe(document.body, { childList: true, subtree: true });
  observers.push(mainMo);

  // 初始扫描：为文档中已存在的 shadow root 各挂 observer
  const initial = observeShadowRoots(document.body, onMutationRecord, observedRoots);
  observers.push(...initial);

  return () => {
    for (const mo of observers) mo.disconnect();
    if (timer) clearTimeout(timer);
  };
}
