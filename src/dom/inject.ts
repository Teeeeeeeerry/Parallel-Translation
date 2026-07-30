// Phase 2 — 最简译文注入 / 还原。
// 阶段 4 升级为完整的三模式渲染器。

const ORIGIN = 'pt-origin';
const TRANS = 'pt-trans';
const DONE = 'data-pt';

/**
 * 在元素内注入对照译文。
 * 原文包入 <span class="pt-origin">，译文追加为 <span class="pt-trans">，
 * 容器打 data-pt="done"。
 */
export function injectSimple(el: Element, origin: string, trans: string): void {
  el.innerHTML = `<span class="${ORIGIN}">${origin}</span><span class="${TRANS}">${trans}</span>`;
  el.setAttribute(DONE, 'done');
}

/**
 * 移除注入的译文，还原原文。
 */
export function removeSimple(el: Element): void {
  const originSpan = el.querySelector(`.${ORIGIN}`);
  if (originSpan) {
    el.innerHTML = originSpan.innerHTML;
  }
  el.removeAttribute(DONE);
}

/**
 * 页面上所有已翻译容器。
 */
export function allTranslated(): Element[] {
  return [...document.querySelectorAll('[data-pt="done"]')];
}
