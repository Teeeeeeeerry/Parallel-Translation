// Phase 9 — 提取可翻译文本（跳过 .notranslate 与站点元数据子树）。
//
// 单元文本不能直接取 textContent：Google AI 概览的来源角标（chip）是
// UI 元数据不是正文，混进译文就是「YouTube·Tech +2」这类噪声。规则分两层：
// - .notranslate 类：HTML 标准约定（Google 翻译同样尊重），通用
// - shouldOmitText()：域名补丁（compat.ts），站点的特定元数据

import { shouldOmitText } from './compat';

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
        walk(c);
      }
    }
  };
  walk(el);
  return out;
}
