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
  isInlineTag,
  MAX_TEXT,
  inCodeBlockContext,
} from './classify';
import { isDecorationLine, lineText, splitIntoChunks, type ChunkShape } from './chunk-split';
import { isChunk, isSplitContainer } from './chunk-marks';

/**
 * 空行：两个 br 之间看不见任何文字 —— 只有空白（含 &nbsp;）与零宽字符这类
 * 格式控制字符（Unicode 的 Cf 类：零宽空格、零宽连接符、BOM、软连字符等）。
 *
 * #709：只用 trim() 判空时，零宽字符不算空白，夹着一个零宽空格的空行被包成
 * 切块：它不会被采集（没有可翻译的文字），却平白多出一个包装元素。空行原样
 * 留作裸内容，不成切块、不送翻。
 */
function isBlankLine(text: string): boolean {
  return text.replace(/[\s\p{Cf}]/gu, '') === '';
}

/** 以 br 分行的形状：br 是换行、留在切块外，其余子节点原样作为行内 token；每行一块。 */
const BR_SHAPE: ChunkShape = {
  tokenize(child) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'BR') {
      return [{ kind: 'nl', node: child }];
    }
    return [{ kind: 'node', node: child }];
  },
  // 有字的行各自成块；空行留作裸内容，不成单元（#709）
  group(lines) {
    return lines.map((line) => ({
      kind: isBlankLine(lineText(line)) || isDecorationLine(lineText(line)) ? 'raw' : 'chunk',
      lines: [line],
    }));
  },
  breakOutside: true,
};

/** 段落型元素：直接翻译的块级元素与 div 型正文容器。pre 走自己的切块（#65）。 */
function isParagraphTag(tag: string): boolean {
  return tag !== 'pre' && (DIRECT_SET.has(tag) || CONTAINER_SET.has(tag));
}

/**
 * 超过长度上限：只看文字长度，与跳过判定（classify.ts，#731 起）同一口径 ——
 * 同一个段落，跳过判定放行的这里就不切，跳过判定因为太长而拒绝的这里才切。
 *
 * #768：不再看 outerHTML。#706 当初要求“文字不长但 HTML 超限”也切，是因为
 * 那时跳过判定按 HTML 上限拒绝，不切就整段漏翻；#731 去掉 HTML 上限之后不切
 * 也不漏翻，这条要求的前提已经不存在了。留着它的后果是同样形状的段落，带 br
 * 的被切成逐行、不带 br 的整段翻译；而逐行切块对 DOM 的改动更大，偏偏标记
 * 密集的页面最容易出事。
 */
function isOverLimit(el: Element): boolean {
  return (el.textContent ?? '').trim().length > MAX_TEXT;
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
    if (!isInlineTag(tag) || CODE_SEMANTIC_SET.has(tag)) return null;
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

/**
 * 已按行切过的段落里，有几行因为自己就超过长度上限而留作裸内容（#710）。
 *
 * 切成行之后仍比上限长的一行（整段一句话不断行）不往下切 —— 断句错乱的
 * 译文比不翻更糟 —— 也不把整段退回不翻：它留在段落里不成切块，其余行照常。
 * 这一行没进待翻列表，要和别的被跳过的单元一样进整页翻译的跳过汇总（#727），
 * 否则用户只看到正文中间有一大段没翻，没有任何提示。
 *
 * 只读 DOM：按段落的直接子节点里的 br 分行，含切块的行是已切出的行，其余行
 * 的文字超过上限就算一行。与切分时同一口径（chunk-split 的超长块判定）。
 * 段落是谁切的、什么时候切的都不影响结果，所以采集每次经过都能如实报出。
 * pre 的切块按空行成块、超长块另有口径，不在此列。
 */
export function oversizedLineCount(container: Element): number {
  if (container.tagName === 'PRE' || !isSplitContainer(container)) return 0;
  let count = 0;
  let text = '';
  let chunked = false;
  const endLine = () => {
    if (!chunked && text.trim().length > MAX_TEXT) count++;
    text = '';
    chunked = false;
  };
  for (const child of container.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.tagName === 'BR') {
        endLine();
        continue;
      }
      if (isChunk(el)) chunked = true;
    }
    text += child.textContent ?? '';
  }
  endLine();
  return count;
}
