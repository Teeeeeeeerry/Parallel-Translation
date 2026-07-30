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

import { collect } from './walker';

/**
 * 启动 MutationObserver，对新增节点触发补翻回调。
 * 返回取消订阅函数。
 */
export function startObserver(
  onNewNodes: (els: Element[]) => void,
): () => void {
  let pending: Node[] = [];
  let timer: number | undefined;

  const flush = () => {
    timer = undefined;
    const batch = pending;
    pending = [];
    const found = batch.flatMap((n) =>
      n.nodeType === Node.ELEMENT_NODE ? collect(n) : [],
    );
    if (found.length) onNewNodes(found);
  };

  const mo = new MutationObserver((records) => {
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
  });

  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
  };
}
