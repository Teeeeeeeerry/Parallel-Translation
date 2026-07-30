// Phase 2 — 最简译文注入 / 还原。
// 阶段 4 升级为完整的三模式渲染器。
//
// 原文用 DOM 搬移保留原节点（链接/格式不丢），
// 译文用 textContent 赋值（远端返回值不会被解析为 HTML）。

const ORIGIN = 'pt-origin';
const TRANS = 'pt-trans';
const DONE = 'data-pt';

/**
 * 将元素的全部子节点搬入 <span class="pt-origin">，
 * 再追加 <span class="pt-trans">（纯文本），容器打 data-pt="done"。
 */
export function injectSimple(el: Element, transText: string): void {
  const origin = document.createElement('span');
  origin.className = ORIGIN;
  // 搬移原节点，保留链接、格式标记等 DOM 结构
  while (el.firstChild) {
    origin.appendChild(el.firstChild);
  }

  const trans = document.createElement('span');
  trans.className = TRANS;
  trans.textContent = transText; // 不解析 HTML，防注入

  el.append(origin, trans);
  el.setAttribute(DONE, 'done');
}

/**
 * 移除注入的译文，将原节点搬回元素内，还原为注入前的 DOM。
 */
export function removeSimple(el: Element): void {
  const origin = el.querySelector(`.${ORIGIN}`);
  const trans = el.querySelector(`.${TRANS}`);

  // 将原节点搬回元素
  if (origin) {
    while (origin.firstChild) {
      el.insertBefore(origin.firstChild, trans ?? null);
    }
    origin.remove();
  }

  if (trans) trans.remove();
  el.removeAttribute(DONE);
}

/**
 * 页面上所有已翻译容器。
 */
export function allTranslated(): Element[] {
  return [...document.querySelectorAll('[data-pt="done"]')];
}
