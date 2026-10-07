// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 11 — 纯文本 <pre> 按空行切块。
//
// #65：大型纯文本文档（如 GitHub README 的 .plain > pre）一次性文本过长，
// 无法通过 MAX_TEXT 阈值。本模块按连续空行将其切分为多个 <span> 翻译单元，
// 保留原始渲染逐字节不变，让现有 collect → translate → render 管道零改动复用。
//
// GitHub 对 RST README 的 .plain > pre 渲染会插入 autolink <a>。
// 早退条件“pre.children.length > 0”把这类 pre 整棵拒切 —— 全文远超
// MAX_TEXT / MAX_HTML，采集 0 单元（翻译静默失败）。改为仅当存在
// 块级子元素才拒切，内联子元素随文本流切分保留。

import { INLINE_SET, MAX_TEXT, CODE_SEMANTIC_SET, isCodeBlockPre } from './classify';
import { lineText, splitIntoChunks, type ChunkShape, type Part, type Tok } from './chunk-split';

// #705：token 化、行聚合、包切块、打标记与还原都在切块内核里（chunk-split），
// 这里只留 pre 的形状 —— 换行来自文本里的 '\n'，行按空行聚成段落块 —— 与
// pre 专属的拒切条件。

/**
 * 装饰行：=====、-----、***** 等纯符号行 —— plain-text 文档的分节装饰。
 * 这些行不是正文，不应独立构成翻译单元。
 */
function isDecorationLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  return /^[=\-*_~#]+$/.test(t);
}

/**
 * 列表条目行：行首（允许缩进）为项目符号或编号标记。
 * 条目行强制独立成翻译单元 —— 渲染后一行原文紧贴一行译文，
 * 行级对照。非列表行保持段落块聚合（按行翻译会切断句子）。
 */
const LIST_MARKER_RE = /^\s*(?:[*+-]\s+|\d+\.\s+)/;

function isListLine(line: string): boolean {
  return LIST_MARKER_RE.test(line);
}

/** pre 的形状：文本节点按 '\n' 拆行片段，内联元素整体作为行内 token；按空行聚块。 */
const PRE_SHAPE: ChunkShape = {
  tokenize(child) {
    if (child.nodeType !== Node.TEXT_NODE) return [{ kind: 'node', node: child }];
    const toks: Tok[] = [];
    const parts = (child.textContent ?? '').split('\n');
    parts.forEach((p, i) => {
      if (p.length > 0) toks.push({ kind: 'text', text: p });
      if (i < parts.length - 1) toks.push({ kind: 'nl', node: document.createTextNode('\n') });
    });
    return toks;
  },

  // 按行 kind 聚合为块：空行 / 装饰行 → raw，其余 → chunk。
  // 列表条目行强制独立成块 —— 行级对照（一行原文一行译文）。
  // 强制独立块带 locked 标记，后续 chunk 行不得并入（#115）。
  group(lines) {
    const parts: (Part & { locked?: boolean })[] = [];
    for (const line of lines) {
      const lt = lineText(line).trim();
      const kind = lt === '' || isDecorationLine(lt) ? 'raw' : 'chunk';
      const last = parts[parts.length - 1];
      if (kind === 'chunk' && isListLine(lt)) {
        parts.push({ kind, lines: [line], locked: true });
      } else if (last && last.kind === kind && !last.locked) {
        last.lines.push(line);
      } else {
        parts.push({ kind, lines: [line] });
      }
    }
    return parts;
  },
};

/**
 * 将超长纯文本 <pre> 按连续空行切分为块。
 *
 * 每块内容包装为 <span class="pt-chunk" data-pt-chunk="1">，
 * 空行、装饰行、超长块保留为裸文本节点 —— 渲染逐字节不变，
 * 但只有内容块会成为翻译单元。
 *
 * 返回切出的 span 数组；不满足切分条件时返回 null（调用方走原逻辑）。
 * 已切过、已在翻译结果内部的由切块内核拒切。
 */
export function splitPre(pre: HTMLPreElement): HTMLSpanElement[] | null {
  // 代码块上下文不切（#64 通用规则）
  if (isCodeBlockPre(pre)) return null;

  // 含块级或代码语义子元素的 pre 结构复杂，保持现有行为不切；
  // 仅纯行内文本子元素（GitHub .plain > pre 的 autolink <a>）可随文本流切分保留。
  // <pre><code> 是经典代码块结构，code 虽在 INLINE_SET（供段落判定用），
  // 但此处必须视为代码语义而拒切，避免纯代码 pre 被翻译。
  // #136：CODE_SEMANTIC_SET 与 classify 共享，不再局部重定义。
  for (const child of pre.children) {
    const tag = child.tagName.toLowerCase();
    if (!INLINE_SET.has(tag) || CODE_SEMANTIC_SET.has(tag)) return null;
  }

  const text = pre.textContent ?? '';
  if (text.trim().length <= MAX_TEXT) return null;

  return splitIntoChunks(pre, PRE_SHAPE);
}
