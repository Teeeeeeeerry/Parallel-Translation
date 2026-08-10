// Phase 4 — 三模式渲染器，替换阶段 2 的 inject.ts。
//
// 三种显示模式共用同一套 DOM 结构 ——
// 模式差异全部由挂在 <html> 上的类名 + CSS 表达，切换时只改 className，
// 零 DOM 操作、零请求。
//
// 原文用 DOM 搬移（while + appendChild）而非 innerHTML，保留原有节点
// 结构与事件监听器。

import type { DisplayMode, StyleId } from '../storage/schema';
import { hasNonTextContent } from './classify';

/** 渲染来源：区分整页翻译与单段翻译，落成 data-pt-src 属性供 CSS 分流。 */
export type RenderSource = 'page' | 'para';

/**
 * 渲染译文。三种模式共用同一套 DOM 结构。
 *
 * 返回 false 表示元素含非文本内容（媒体 / 交互控件），拒绝渲染，
 * 由调用方决定是否提示用户。
 */
export function render(
  el: Element,
  translation: string,
  src: RenderSource = 'page',
): boolean {
  if (el.getAttribute('data-pt') === 'done') return true;

  // 纵深防御：拒绝含非文本内容的容器，防止缩略图、按钮等被藏进
  // display:none 的 .pt-origin（#22）。
  //
  // #50：主守卫已前移到 classify.ts 的 closestUnit() 与 collect() 中，
  // 正常路径不应再走到这里。保留此检查为纵深防御，仅在最外层代码路径
  // 绕过采集器（如手动构造 DOM 元素调用）时兜底。
  if (hasNonTextContent(el)) {
    console.debug('[PT] render 拒绝（纵深防御）：元素含非文本内容（媒体 / 交互控件）', el);
    return false;
  }

  // 把原有子节点整体包进 .pt-origin，保留其内部结构与事件绑定
  const origin = document.createElement('span');
  origin.className = 'pt-origin';
  while (el.firstChild) origin.appendChild(el.firstChild);

  const trans = document.createElement('span');
  trans.className = 'pt-trans';
  trans.textContent = translation;

  // #66：pre 内译文需要脱离等宽约束，按普通段落排版。
  // closest 从自身沿祖先链向上匹配，覆盖两种场景：
  // 1. pre 自身是翻译单元（短文本，未被 splitPre 切分）
  // 2. .pt-chunk 包装 span 是翻译单元（#65 切分后的块）
  if (el.closest('pre')) trans.classList.add('pt-pre');

  el.appendChild(origin);
  el.appendChild(trans);
  el.setAttribute('data-pt', 'done');
  el.setAttribute('data-pt-src', src);
  return true;
}

/** 还原原文，把 .pt-origin 的子节点放回去 */
export function unrender(el: Element): void {
  const origin = el.querySelector(':scope > .pt-origin');
  const trans = el.querySelector(':scope > .pt-trans');
  if (!origin) return;
  while (origin.firstChild) el.insertBefore(origin.firstChild, origin);
  origin.remove();
  trans?.remove();
  el.removeAttribute('data-pt');
  el.removeAttribute('data-pt-src');
}

/**
 * 模式切换：只改 <html> 上的类名，零 DOM 操作、零请求。
 *
 * paraMode 为 'follow' 时跟随 pageMode，否则独立生效。
 */
export function applyMode(
  pageMode: DisplayMode,
  paraMode: DisplayMode | 'follow',
): void {
  const root = document.documentElement;
  const effectivePara = paraMode === 'follow' ? pageMode : paraMode;
  root.classList.toggle('pt-only-trans-page', pageMode === 'translation-only');
  root.classList.toggle('pt-only-trans-para', effectivePara === 'translation-only');
}

/** 样式切换：替换 pt-style-* 类名 */
export function applyStyle(style: StyleId): void {
  const root = document.documentElement;
  [...root.classList]
    .filter((c) => c.startsWith('pt-style-'))
    .forEach((c) => root.classList.remove(c));
  root.classList.add(`pt-style-${style}`);
}
