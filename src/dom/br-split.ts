// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 以 br 分行的超长段落按行切块（#706，规格 #694）。
//
// 作者用换行而不是空行分段的长文（论坛帖、邮件存档、歌词与诗歌页、聊天
// 记录导出页）：整篇正文是一个段落，行与行之间只隔一个 br。总长超过长度
// 上限时，它当不了翻译单元，采集时被整段静默丢掉。这里在采集遍历里、长度
// 上限判定之前，把这类段落按 br 切成逐行的切块，每行一个翻译单元 —— 与
// pre 切块（#65）同一个位置、同一个切块内核（#705），只是换行来自 br 元素、
// 每行一块，br 留在切块之外。
//
// 只是超长段落的补救，不是新的分段策略：长度没超上限的段落哪怕有 br 也
// 不切。按文档结构判定，不认任何站点的 class 名（#694）。

import {
  CODE_SEMANTIC_SET,
  CONTAINER_SET,
  DIRECT_SET,
  INLINE_SET,
  MAX_HTML,
  MAX_TEXT,
  inCodeBlockContext,
} from './classify';
import { lineText, splitIntoChunks, type ChunkShape } from './chunk-split';

/** 以 br 分行的形状：br 是换行、留在切块外，其余子节点原样作为行内 token；每行一块。 */
const BR_SHAPE: ChunkShape = {
  tokenize(child) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'BR') {
      return [{ kind: 'nl', node: child }];
    }
    return [{ kind: 'node', node: child }];
  },
  // 有字的行各自成块；空行（只有空白）留作裸内容，不成单元
  group(lines) {
    return lines.map((line) => ({
      kind: lineText(line).trim() === '' ? 'raw' : 'chunk',
      lines: [line],
    }));
  },
  breakOutside: true,
};

/** 段落型元素：直接翻译的块级元素与 div 型正文容器。pre 走自己的切块（#65）。 */
function isParagraphTag(tag: string): boolean {
  return tag !== 'pre' && (DIRECT_SET.has(tag) || CONTAINER_SET.has(tag));
}

/** 超过采集的长度上限 —— 与跳过判定同一口径：文本或 HTML 任一超限。 */
function isOverLimit(el: Element): boolean {
  return (el.textContent ?? '').trim().length > MAX_TEXT || el.outerHTML.length > MAX_HTML;
}

/**
 * 把以 br 分行的超长段落切成逐行切块。
 *
 * 返回切出的切块；不满足条件时返回 null，DOM 一个字节都不动。拒切：
 * - 不是段落型元素（pre 也不在此列）；
 * - 长度没超上限，或直接子节点里没有 br；
 * - 子元素里有块级元素或代码语义元素（code、kbd 等），或处于代码块上下文
 *   （高亮容器、notranslate）；
 * - 在原文容器（.pt-origin）或编辑区里；
 * - 已切过、在已翻译结果内（切块内核负责）。
 */
export function splitBrParagraph(el: Element): HTMLSpanElement[] | null {
  if (!isParagraphTag(el.tagName.toLowerCase())) return null;

  let hasBr = false;
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase();
    if (!INLINE_SET.has(tag) || CODE_SEMANTIC_SET.has(tag)) return null;
    if (tag === 'br') hasBr = true;
  }
  if (!hasBr) return null;

  if (inCodeBlockContext(el)) return null;
  if (el.closest('.pt-origin')) return null;
  // 编辑区的 DOM 归编辑器管，切开会打乱它的模型
  if (el.closest('[contenteditable]:not([contenteditable="false"])')) return null;

  if (!isOverLimit(el)) return null;

  return splitIntoChunks(el, BR_SHAPE);
}
