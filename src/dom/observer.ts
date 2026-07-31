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

  const attach = (el: Element): boolean => {
    if (!el.shadowRoot || seen.has(el.shadowRoot)) return false;
    seen.add(el.shadowRoot);
    const mo = new MutationObserver(onMutation);
    mo.observe(el.shadowRoot, { childList: true, subtree: true });
    observers.push(mo);
    return true;
  };

  // querySelectorAll('*') 返回的已经是整棵子树，因此每个 scope 只扫一遍即可。
  // 若再对其中每个后代重复调用，深度 k 的节点会沿 2^(k-1) 条祖先路径被反复
  // 访问 —— 代价随嵌套深度指数增长，真实页面上会直接冻结主线程。
  // 递归只发生在 shadow 边界，因为 querySelectorAll 不穿透 shadow root。
  const walk = (scope: ParentNode) => {
    scope.querySelectorAll('*').forEach((el) => {
      if (attach(el)) walk(el.shadowRoot!);
    });
  };

  if (root.nodeType === Node.ELEMENT_NODE) {
    // root 自身也可能是 shadow host —— querySelectorAll 不包含根节点
    const el = root as Element;
    if (attach(el)) walk(el.shadowRoot!);
    walk(el);
  } else if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    walk(root as ParentNode);
  }
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
