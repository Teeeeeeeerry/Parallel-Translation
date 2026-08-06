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
  'p', 'li', 'dd', 'dt', 'blockquote', 'figcaption',
  'td', 'th', 'caption', 'summary',
]);

/**
 * div 型正文容器：直接持有文本时本身即为翻译单元（#19）。
 * Google 搜索摘要、AI 概览等现代站点把正文层层裹在 div 里，白名单
 * 永远选不中 —— 按钮不浮出、采集器也不收集。此集合在标签之外放行。
 */
export const CONTAINER_SET = new Set([
  'div', 'section', 'article', 'main', 'figure',
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

/** 非可见性相关的所有跳过判定。元素即便变为可见，这些条件也不会改变。 */
export function shouldSkipNonVisual(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_SET.has(tag)) return true;
  if (el.classList.contains('notranslate')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest('[data-pt="done"]')) return true;

  // 扩展自身注入的 UI —— 绝不能翻译自己的按钮文字
  if (el.closest('[data-pt-ui="1"]')) return true;

  // 非正文区域：导航、页脚、侧栏、参考文献等
  if (el.closest(NON_CONTENT)) return true;

  const text = el.textContent?.trim() ?? '';
  if (text.length < MIN_TEXT || text.length > MAX_TEXT) return true;
  if ((el as HTMLElement).outerHTML.length > MAX_HTML) return true;
  if (isMainlyNumeric(text)) return true;

  return false;
}

/** 元素是否可见（非 display:none 且祖先均可见）。 */
export function isVisible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

export function shouldSkip(el: Element): boolean {
  if (shouldSkipNonVisual(el)) return true;
  if (!isVisible(el)) return true;
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
 *
 * div 型正文（CONTAINER_SET）走同一套规则，只多一道门槛：必须直接持有
 * 文本 —— 纯壳容器（文本全在更深层）不算。两条规则对称，祖先与后代
 * 不会同时成单元，无需额外去重。
 */
export function isTranslationUnit(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const isContainer = CONTAINER_SET.has(tag);

  if (isContainer && directTextLength(el) === 0) return false;
  if (!DIRECT_SET.has(tag) && !isContainer) return false;

  // #23：元素自身持有直接文本时，即使有带文本的块级子元素也接受为翻译单元。
  // 直接文本部分由 shallowTranslatableText 提取，嵌套块级子元素各自独立采集。
  const hasDirect = directTextLength(el) > 0;

  for (const child of el.children) {
    const childTag = child.tagName.toLowerCase();
    // 内联子元素属于本段的一部分，不影响判定
    if (INLINE_SET.has(childTag)) continue;
    // 非内联且有文本 → 若当前元素有直接文本则接受（仅翻直接文本），否则拒收
    if (child.textContent?.trim()) {
      if (hasDirect) continue;
      return false;
    }
  }
  return true;
}

/** 直接子文本节点的有效字符数（不深入子元素，trim 后计数，排除格式化空白）。div 型正文判定的依据 */
function directTextLength(el: Element): number {
  let len = 0;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) len += (node.textContent ?? '').trim().length;
  }
  return len;
}

/**
 * 从 el（含自身）向上找最近的翻译单元（isTranslationUnit + shouldSkip）。
 * 按钮路径与 translateOne 共用 —— 判定标准与采集器同一套，不再各立门户，
 * 白名单之外的大容器（如 AI 概览的外层 li）不会再被错误命中。
 *
 * shouldSkip 有强制同步布局的昂贵步骤（outerHTML、getBoundingClientRect），
 * 只应在低频率路径调用：悬停意图计时器、点击/快捷键入口，不能挂在
 * 每次 mouseover 上。
 */
export function closestUnit(el: Element): Element | null {
  let cur: Element | null = el;
  while (cur) {
    if (isTranslationUnit(cur) && !shouldSkip(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}
