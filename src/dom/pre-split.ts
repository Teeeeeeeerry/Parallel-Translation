// Phase 11 — 纯文本 <pre> 按空行切块。
//
// #65：大型纯文本文档（如 GitHub README 的 .plain > pre）一次性文本过长，
// 无法通过 MAX_TEXT 阈值。本模块按连续空行将其切分为多个 <span> 翻译单元，
// 保留原始渲染逐字节不变，让现有 collect → translate → render 管道零改动复用。

import { MAX_TEXT, isCodeBlockPre } from './classify';

/**
 * 装饰行：=====、-----、***** 等纯符号行 —— plain-text 文档的分节装饰。
 * 这些行不是正文，不应独立构成翻译单元。
 */
function isDecorationLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  return /^[=\-*_~#]+$/.test(t);
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

  // 含子元素的 pre 可能有内联标记，保持现有行为
  if (pre.children.length > 0) return null;

  const text = pre.textContent ?? '';
  if (text.trim().length <= MAX_TEXT) return null;

  // ── 按连续空行 / 装饰行切分 ──
  const lines = text.split('\n');
  const parts: { kind: 'raw' | 'chunk'; text: string }[] = [];
  let cur: string[] = [];
  let curKind: 'raw' | 'chunk' | null = null;

  for (const line of lines) {
    const kind =
      line.trim() === '' || isDecorationLine(line) ? 'raw' : 'chunk';
    if (kind !== curKind) {
      if (cur.length > 0) parts.push({ kind: curKind!, text: cur.join('\n') });
      cur = [];
      curKind = kind;
    }
    cur.push(line);
  }
  if (cur.length > 0 && curKind) {
    parts.push({ kind: curKind, text: cur.join('\n') });
  }

  // ── 重建 pre 内容 ──
  pre.textContent = '';
  const spans: HTMLSpanElement[] = [];

  for (const p of parts) {
    if (p.kind === 'chunk' && !isOversized(p.text)) {
      const span = document.createElement('span');
      span.className = 'pt-chunk';
      span.setAttribute('data-pt-chunk', '1');
      span.textContent = p.text;
      pre.appendChild(span);
      spans.push(span);
    } else {
      pre.appendChild(document.createTextNode(p.text));
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
