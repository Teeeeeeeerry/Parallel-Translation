// Phase 3 — 节点分类三集合 + 判定规则。
//
// 设计原则：
// - DIRECT_SET：直接作为翻译单元的块级元素
// - SKIP_SET：整棵子树跳过，不再深入
// - INLINE_SET：自身不作为翻译单元，需向上找可翻父节点
// 此三层分类是 TreeWalker 过滤逻辑的基础。

/** 直接翻译的块级元素 */
export const DIRECT_SET = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'dd', 'blockquote', 'figcaption',
]);

/** 整棵子树跳过，不再深入 */
export const SKIP_SET = new Set([
  'html', 'body', 'script', 'style', 'noscript',
  'input', 'textarea', 'select', 'button',
  'code', 'pre',
]);

/** 内联元素：自身不作为翻译单元，需向上找可翻父节点 */
export const INLINE_SET = new Set([
  'a', 'b', 'strong', 'span', 'em', 'i', 'u', 'small', 'sub', 'sup',
  'font', 'mark', 'cite', 'q', 'abbr', 'time', 'ruby', 'img', 'br', 'svg',
]);

/** 应被整体跳过的非正文区域选择器（导航、页脚、侧栏、参考文献等） */
const NON_CONTENT =
  'nav,footer,aside,.reflist,.references,.refbegin,.mw-references-wrap,' +
  '.navbox,.sidebar,.toc,.mw-editsection,' +
  '.vector-menu-content-list,#catlinks,#mw-hidden-catlinks,#mw-normal-catlinks';

const MAX_TEXT = 3072;
const MAX_HTML = 4096;
const MIN_TEXT = 3;

export function shouldSkip(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_SET.has(tag)) return true;
  if (el.classList.contains('notranslate')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest('[data-pt="done"]')) return true;

  // 扩展自身注入的 UI —— 绝不能翻译自己的按钮文字
  if (el.closest('[data-pt-ui="1"]')) return true;

  // 非正文区域：导航、页脚、侧栏、参考文献等
  if (el.closest(NON_CONTENT)) return true;

  // 不可见元素（display:none 或祖先被隐藏）
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return true;

  const text = el.textContent?.trim() ?? '';
  if (text.length < MIN_TEXT || text.length > MAX_TEXT) return true;
  if ((el as HTMLElement).outerHTML.length > MAX_HTML) return true;
  if (isMainlyNumeric(text)) return true;

  return false;
}

/** 纯数字、日期、计数（"1.2k"、"2026-07-30"）翻了没意义还浪费额度 */
function isMainlyNumeric(text: string): boolean {
  if (text.length > 30) return false;
  return /^[\d\s.,:/\-+%$€¥£kKmMbB()]+$/.test(text);
}

/**
 * 判定元素是否是一个完整的翻译单元。
 * 核心规则：若子元素中存在非内联且带文本的元素，
 * 说明文本还在更深层，当前节点不是叶子翻译单元。
 */
export function isTranslationUnit(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!DIRECT_SET.has(tag)) return false;

  for (const child of el.children) {
    const childTag = child.tagName.toLowerCase();
    // 内联子元素属于本段的一部分，不影响判定
    if (INLINE_SET.has(childTag)) continue;
    // 非内联且有文本 → 文本在更深层，当前节点不是翻译单元
    if (child.textContent?.trim()) return false;
  }
  return true;
}
