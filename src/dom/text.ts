// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 9 — 提取可翻译文本（跳过 .notranslate 与站点元数据子树）。
//
// 单元文本不能直接取 textContent：Google AI 概览的来源角标（chip）是
// UI 元数据不是正文，混进译文就是“YouTube·Tech +2”这类噪声。规则分两层：
// - .notranslate 类：HTML 标准约定（Google 翻译同样尊重），通用
// - shouldOmitText()：域名补丁（compat.ts），站点的特定元数据
// - shouldPreserveText()：#58 占位符机制，用户名等标识符不翻译但保留原文

import { shouldOmitText, shouldPreserveText } from './compat';
import { INLINE_SET } from './classify';

/**
 * Preserve 占位符格式：⟦PT0⟧、⟦PT1⟧ ...
 * 使用 U+27E6/U+27E7 数学括号 + "PT" 前缀 + 自增索引。
 * 这些 Unicode 字符极少出现在自然文本中，各翻译引擎通常原样透传。
 */
const PLACEHOLDER_RE = /⟦PT\d+⟧/g;
const PLACEHOLDER_PREFIX = '⟦PT';
const PLACEHOLDER_SUFFIX = '⟧';

interface PreserveMap {
  placeholders: Map<string, string>; // ⟦PT0⟧ → 原文
  nextIndex: number;
}

function makePlaceholder(idx: number): string {
  return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
}

/**
 * 提取元素的全部可翻译文本（含 preserve 占位符）。
 * 返回占位符文本与原文映射表，供译文回填时替换。
 *
 * 遍历逻辑与 translatableText() 相同，额外在遇到 preserve 节点时
 * 写入占位符并记录映射。
 */
export function translatableTextEx(el: Element): {
  text: string;
  preserves: Map<string, string>;
} {
  const pm: PreserveMap = { placeholders: new Map(), nextIndex: 0 };
  const text = walkTranslatable(el, pm);
  return { text, preserves: pm.placeholders };
}

/**
 * 提取元素的全部可翻译文本：递归遍历子节点，跳过 .notranslate 与
 * 站点元数据子树。无忽略规则时与 textContent 等价。
 */
export function translatableText(el: Element): string {
  return walkTranslatable(el, null);
}

/** 共享遍历实现：pm 为 null 时不启用 preserve（向后兼容） */
function walkTranslatable(el: Element, pm: PreserveMap | null): string {
  let out = '';
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? '';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child as Element;

        // #58 preserve：不翻译但保留原文（用户名等标识符）
        if (pm) {
          const preserved = shouldPreserveText(c);
          if (preserved) {
            const ph = makePlaceholder(pm.nextIndex);
            pm.placeholders.set(ph, preserved);
            pm.nextIndex++;
            out += ' ';
            out += ph;
            out += ' ';
            continue;
          }
        }

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
 * 只提取“标签文字”，子条目由各自的翻译单元独立翻译，避免重复。
 */
export function shallowTranslatableText(el: Element): string {
  return walkShallow(el, null);
}

/** 含 preserve 的浅层提取变体 */
export function shallowTranslatableTextEx(el: Element): {
  text: string;
  preserves: Map<string, string>;
} {
  const pm: PreserveMap = { placeholders: new Map(), nextIndex: 0 };
  const text = walkShallow(el, pm);
  return { text, preserves: pm.placeholders };
}

function walkShallow(el: Element, pm: PreserveMap | null): string {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as Element;
      const tag = c.tagName.toLowerCase();

      // 跳过块级子元素 —— 它们的文本由各自翻译单元覆盖
      if (!INLINE_SET.has(tag)) continue;

      // #58 preserve
      if (pm) {
        const preserved = shouldPreserveText(c);
        if (preserved) {
          const ph = makePlaceholder(pm.nextIndex);
          pm.placeholders.set(ph, preserved);
          pm.nextIndex++;
          out += ' ';
          out += ph;
          out += ' ';
          continue;
        }
      }

      if (c.classList.contains('notranslate')) continue;
      if (shouldOmitText(c)) continue;
      out += ' ';
      out += walkTranslatable(c, pm); // 内联元素全递归
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

/**
 * 译文回填：将占位符替换回原文。
 *
 * 安全降级：若译文中占位符数量/序号与原文不符（引擎破坏了占位符），
 * 返回原始文本而非含破碎占位符的译文 —— 用户绝不会见到 ⟦PT0⟧ 残留。
 *
 * @param translation 引擎返回的译文
 * @param preserves 占位符 → 原文映射表
 * @param originalText 发往引擎前的原文（含占位符），用于校验
 * @returns 还原后的译文，或降级返回的原始无占位符文本
 */
export function restorePreserves(
  translation: string,
  preserves: Map<string, string>,
  originalText: string,
): string {
  if (preserves.size === 0) return translation;

  // 统计原文中的占位符
  const origPlaceholders = originalText.match(PLACEHOLDER_RE) ?? [];

  // 统计译文中的占位符
  const transPlaceholders = translation.match(PLACEHOLDER_RE) ?? [];

  // 数量或序号不一致 → 引擎破坏了占位符，降级
  if (origPlaceholders.length !== transPlaceholders.length) {
    console.debug(
      '[PT] preserve 降级：占位符数量不匹配',
      { orig: origPlaceholders, trans: transPlaceholders },
    );
    return restoreFallback(originalText, preserves);
  }

  for (let i = 0; i < origPlaceholders.length; i++) {
    if (origPlaceholders[i] !== transPlaceholders[i]) {
      console.debug(
        '[PT] preserve 降级：占位符序号不匹配',
        { orig: origPlaceholders[i], trans: transPlaceholders[i] },
      );
      return restoreFallback(originalText, preserves);
    }
  }

  // 全部匹配 → 安全替换
  let result = translation;
  for (const [ph, orig] of preserves) {
    // #173: 必须用函数替换器 —— orig 含 $& / $' / $` / $1 等序列时，
    // 字符串替换参数会被 String.replace 当作替换模式展开，产生与原文
    // 不同的字符。函数返回值不做任何模式解释。
    result = result.replace(ph, () => orig);
  }
  return result;
}

/** 降级：从含占位符的原文中还原出无占位符的原始文本 */
function restoreFallback(
  placeholderText: string,
  preserves: Map<string, string>,
): string {
  let result = placeholderText;
  for (const [ph, orig] of preserves) {
    // #173: 函数替换器，避免 orig 中的 $ 序列被当作替换模式展开
    result = result.replace(ph, () => orig);
  }
  return result;
}
