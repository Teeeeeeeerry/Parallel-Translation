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

/** 节点流 token：行内文本片段 / 行内元素 / 换行 */
type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'node'; node: Node }
  | { kind: 'nl' };

/** 行内 token（nl 在行聚合时被消费，不进 Line） */
type LineTok = Exclude<Tok, { kind: 'nl' }>;

interface Line {
  toks: LineTok[];
  endsWithNl: boolean;
}

/** 行的纯文本（含内联节点文本），用于空行 / 装饰行判定 */
function lineText(line: Line): string {
  let s = '';
  for (const t of line.toks) {
    if (t.kind === 'text') s += t.text;
    else if (t.kind === 'node') s += t.node.textContent ?? '';
  }
  return s;
}

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

/** 文本是否超过单块上限 —— 超长块不参与翻译 */
function isOversized(text: string): boolean {
  return text.trim().length > MAX_TEXT;
}

/**
 * 将超长纯文本 <pre> 按连续空行切分为块。
 *
 * 每块内容包装为 <span class="pt-chunk" data-pt-chunk="1">，
 * 空行、装饰行、超长块保留为裸文本节点 —— 渲染逐字节不变，
 * 但只有内容块会成为翻译单元。
 *
 * 返回切出的 span 数组；不满足切分条件时返回 null（调用方走原逻辑）。
 */
export function splitPre(pre: HTMLPreElement): HTMLSpanElement[] | null {
  // 幂等：已切分过的不再处理（observer / IO / toggle 会反复 collect）
  if (pre.hasAttribute('data-pt-split')) return null;

  // 已在翻译结果内部 —— 不切
  if (pre.closest('[data-pt="done"]')) return null;

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

  // ── 节点流 token 化：文本节点按 '\n' 拆行片段，内联元素整体作为行内 token ──
  const toks: Tok[] = [];
  for (const child of [...pre.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const parts = (child.textContent ?? '').split('\n');
      parts.forEach((p, i) => {
        if (p.length > 0) toks.push({ kind: 'text', text: p });
        if (i < parts.length - 1) toks.push({ kind: 'nl' });
      });
    } else {
      toks.push({ kind: 'node', node: child });
    }
  }

  // ── 行聚合：行结束于换行 token（含） ──
  const lines: Line[] = [];
  let cur: LineTok[] = [];
  for (const t of toks) {
    if (t.kind === 'nl') {
      lines.push({ toks: cur, endsWithNl: true });
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) lines.push({ toks: cur, endsWithNl: false });

  // ── 按行 kind 聚合为块：空行 / 装饰行 → raw，其余 → chunk。
  //    列表条目行强制独立成块 —— 行级对照（一行原文一行译文）──
  //    强制独立块带 locked 标记，后续 chunk 行不得并入（#115）。
  const parts: { kind: 'raw' | 'chunk'; lines: Line[]; locked?: boolean }[] = [];
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

  // ── 重建 pre 内容：按 token 顺序 append，逐字节还原 ──
  // textContent = '' 只清空 DOM 树，node token 持有的引用仍可重新挂回。
  pre.textContent = '';
  const spans: HTMLSpanElement[] = [];
  const appendLine = (holder: Node, line: Line) => {
    for (const t of line.toks) {
      if (t.kind === 'text') holder.appendChild(document.createTextNode(t.text));
      else holder.appendChild(t.node); // 原内联节点移入，属性 / 事件保留
    }
    if (line.endsWithNl) holder.appendChild(document.createTextNode('\n'));
  };

  for (const part of parts) {
    const partText = part.lines.map(lineText).join('\n');
    if (part.kind === 'chunk' && !isOversized(partText)) {
      const span = document.createElement('span');
      span.className = 'pt-chunk';
      span.setAttribute('data-pt-chunk', '1');
      for (const line of part.lines) appendLine(span, line);
      pre.appendChild(span);
      spans.push(span);
    } else {
      for (const line of part.lines) appendLine(pre, line);
    }
  }

  if (spans.length === 0) return null;

  pre.setAttribute('data-pt-split', '1');
  return spans;
}

/**
 * 还原 pre 切分包装：把 .pt-chunk 子元素的文本节点放回 pre 并移除包装 span。
 * #65 的逆操作 —— 在 doRestore 中 unrender 所有 chunk 后调用，
 * 将 DOM 恢复为切分前的逐字节原貌。
 */
export function unsplitPre(pre: Element): void {
  const chunks = [...pre.querySelectorAll(':scope > .pt-chunk')];
  for (const span of chunks) {
    while (span.firstChild) pre.insertBefore(span.firstChild, span);
    span.remove();
  }
  pre.removeAttribute('data-pt-split');
}
