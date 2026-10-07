// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 切块内核 —— 把超长容器切成若干切块单元，以及把它们拆回去（#705）。
//
// 从 #65 的纯文本 pre 切块里抽出来，不认任何具体标签：容器的形状只在两处
// 不同，由调用方以配置给出 ——
// - 换行从哪儿来：tokenize 把每个直接子节点拆成文本片段、行内节点、换行；
// - 行怎么聚成块：group 把行聚合成若干部分，每部分要么包成切块，要么原样
//   留作裸内容。
//
// 内核负责其余的一切：行聚合、超长块不包装、按原顺序重建（逐字节不变）、
// 打切分标记与幂等，以及还原时的逆操作。切块是
// <span class="pt-chunk" data-pt-chunk="1">，由采集的切块单元判定收为
// 翻译单元（#65）；观察器据同一标记忽略扩展自己插入的切块（#158）。

import { MAX_TEXT } from './classify';

/**
 * 节点流 token：行内文本片段 / 行内节点 / 换行。
 * 换行带着它重建时要放回去的节点（文本里的 '\n' 拆出来的文本节点等）。
 */
export type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'node'; node: Node }
  | { kind: 'nl'; node: Node };

/** 行内 token（换行在行聚合时被消费，记在行尾，不进 toks） */
type LineTok = Exclude<Tok, { kind: 'nl' }>;

/** 一行：行内 token，加上结束这一行的换行节点（最后一行可能没有）。 */
export interface Line {
  toks: LineTok[];
  end: Node | null;
}

/** 聚合后的一部分：chunk 包成切块，raw 原样留作裸内容。 */
export interface Part {
  kind: 'raw' | 'chunk';
  lines: Line[];
}

/** 容器形状的配置：换行从哪儿来、行怎么聚成块。 */
export interface ChunkShape {
  tokenize(child: ChildNode): Tok[];
  group(lines: Line[]): Part[];
}

/** 切分标记：带它的容器已经切过（幂等），还原时据此找回来。 */
const SPLIT_ATTR = 'data-pt-split';

/** 行的纯文本（含行内节点文本），供形状判定空行、装饰行等。 */
export function lineText(line: Line): string {
  let s = '';
  for (const t of line.toks) {
    if (t.kind === 'text') s += t.text;
    else s += t.node.textContent ?? '';
  }
  return s;
}

/** 文本是否超过单块上限 —— 超长块不参与翻译 */
function isOversized(text: string): boolean {
  return text.trim().length > MAX_TEXT;
}

/**
 * 按形状把容器切成切块。
 *
 * 空行、装饰行之类（形状聚成 raw 的部分）与超长块保留为裸内容 —— 渲染逐字节
 * 不变，但只有切块会成为翻译单元。
 *
 * 返回切出的切块数组；已切过、在已翻译结果内部、或一块也切不出时返回 null
 * （调用方走原逻辑）。
 */
export function splitIntoChunks(container: Element, shape: ChunkShape): HTMLSpanElement[] | null {
  // 幂等：已切分过的不再处理（observer / IO / toggle 会反复 collect）
  if (container.hasAttribute(SPLIT_ATTR)) return null;

  // 已在翻译结果内部 —— 不切
  if (container.closest('[data-pt="done"]')) return null;

  // ── 节点流 token 化 ──
  const toks: Tok[] = [];
  for (const child of [...container.childNodes]) toks.push(...shape.tokenize(child));

  // ── 行聚合：行结束于换行 token（含） ──
  const lines: Line[] = [];
  let cur: LineTok[] = [];
  for (const t of toks) {
    if (t.kind === 'nl') {
      lines.push({ toks: cur, end: t.node });
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) lines.push({ toks: cur, end: null });

  const parts = shape.group(lines);

  // ── 重建容器内容：按 token 顺序 append，逐字节还原 ──
  // textContent = '' 只清空 DOM 树，token 持有的节点引用仍可重新挂回。
  container.textContent = '';
  const spans: HTMLSpanElement[] = [];
  const appendLine = (holder: Node, line: Line) => {
    for (const t of line.toks) {
      if (t.kind === 'text') holder.appendChild(document.createTextNode(t.text));
      else holder.appendChild(t.node); // 原节点移入，属性 / 事件保留
    }
    if (line.end) holder.appendChild(line.end);
  };

  for (const part of parts) {
    const partText = part.lines.map(lineText).join('\n');
    if (part.kind === 'chunk' && !isOversized(partText)) {
      const span = document.createElement('span');
      span.className = 'pt-chunk';
      span.setAttribute('data-pt-chunk', '1');
      for (const line of part.lines) appendLine(span, line);
      container.appendChild(span);
      spans.push(span);
    } else {
      for (const line of part.lines) appendLine(container, line);
    }
  }

  if (spans.length === 0) return null;

  container.setAttribute(SPLIT_ATTR, '1');
  return spans;
}

/**
 * 还原切分：把每个切块里的所有子节点（文本节点与原样移入的行内节点）搬回
 * 容器原位，移除切块与切分标记。splitIntoChunks 的逆操作 —— 在还原流程里
 * unrender 所有切块之后调用，将 DOM 恢复为切分前的逐字节原貌。
 */
export function unsplitChunks(container: Element): void {
  const chunks = [...container.querySelectorAll(':scope > .pt-chunk')];
  for (const span of chunks) {
    while (span.firstChild) container.insertBefore(span.firstChild, span);
    span.remove();
  }
  container.removeAttribute(SPLIT_ATTR);
}
