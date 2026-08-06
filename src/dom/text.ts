// Phase 9 — 提取可翻译文本（跳过 .notranslate 与站点元数据子树）。
//
// 单元文本不能直接取 textContent：Google AI 概览的来源角标（chip）是
// UI 元数据不是正文，混进译文就是「YouTube·Tech +2」这类噪声。规则分两层：
// - .notranslate 类：HTML 标准约定（Google 翻译同样尊重），通用
// - shouldOmitText()：域名补丁（compat.ts），站点的特定元数据

import { shouldOmitText } from './compat';
import { INLINE_SET } from './classify';

/**
 * 提取元素的全部可翻译文本：递归遍历子节点，跳过 .notranslate 与
 * 站点元数据子树。无忽略规则时与 textContent 等价。
 */
export function translatableText(el: Element): string {
  let out = '';
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child as Element;
        if (c.classList.contains('notranslate')) continue;
        if (shouldOmitText(c)) continue;
        // 元素子节点之间补空格，防止源 HTML 中相邻元素无空白时
        // textContent 把末字与首字粘在一起（如 "CertifiedProfessional"，#22）。
        // normalizeText 会将多余空白折叠为单个空格，多余的不会到达引擎。
        out += ' ';
        walk(c);
        out += ' ';
      }
    }
  };
  walk(el);
  return out;
}

/**
 * 浅层提取：只取直接文本节点与内联子元素的文本，跳过块级子元素。
 *
 * #23 混合内容元素专用 —— 对 `<li>标签文字<ul><li>子条目</li></ul></li>`
 * 只提取"标签文字"，子条目由各自的翻译单元独立翻译，避免重复。
 */
export function shallowTranslatableText(el: Element): string {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as Element;
      const tag = c.tagName.toLowerCase();

      // 跳过块级子元素 —— 它们的文本由各自翻译单元覆盖
      if (!INLINE_SET.has(tag)) continue;

      if (c.classList.contains('notranslate')) continue;
      if (shouldOmitText(c)) continue;
      out += ' ';
      out += translatableText(c); // 内联元素全递归
      out += ' ';
    }
  }
  return out;
}

/**
 * 元素是否含有带文本的非内联子元素（即混合内容元素）。
 * 此类元素在整页翻译时应使用 shallowTranslatableText，
 * 避免把嵌套子条目的文本重复翻译进父单元。
 */
export function hasBlockTextChildren(el: Element): boolean {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase();
    if (INLINE_SET.has(tag)) continue;
    if (child.textContent?.trim()) return true;
  }
  return false;
}
