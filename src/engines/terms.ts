// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 术语匹配（#380，父 #365）—— 找出一段原文里命中的术语。
//
// 不区分大小写；拉丁字母术语按整词匹配：术语两侧不能紧挨字母、数字
// 或下划线，这样 PR 不会误命中 price 里的 pr。中日韩文字不算词内字符
// —— 这些语言不用空格分词，“打开PR页面”里的 PR 照样命中。

import type { Term } from '~/src/storage/domains';

/** 词内字符：字母、数字、下划线，中日韩文字除外。 */
const WORD_CHAR =
  '(?:(?![\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}])[\\p{L}\\p{N}_])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 按整词边界匹配任一原词（不区分大小写）。 */
function wholeWord(sources: readonly string[], flags: string): RegExp {
  const body = sources.map(escapeRegExp).join('|');
  return new RegExp(`(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})`, flags);
}

/** 能约束译文的术语：给了译法，或标为“不翻译”。 */
function isEffective(t: Term): boolean {
  return t.source.trim() !== '' && (t.noTranslate === true || !!t.target?.trim());
}

/**
 * 原文里命中的术语，保持术语在领域里的顺序。无从约束译文的术语
 * （既没给译法、也没标“不翻译”）不算命中，不进缓存 key 也不发送。
 */
export function matchTerms(terms: readonly Term[], text: string): Term[] {
  return terms.filter((t) => isEffective(t) && wholeWord([t.source.trim()], 'iu').test(text));
}

/**
 * “不翻译”术语占位符（#386）：⟦TM0⟧、⟦TM1⟧ ……
 * 与保留原文的 ⟦PT0⟧ 区分开 —— 两者同段出现时编号互不冲突，
 * content 侧的保留原文回填也不会误认它。
 */
const TERM_PLACEHOLDER_RE = /⟦TM(\d+)⟧/g;

/** 占位符替换结果：发给机翻引擎的文本 + 每个占位符对应的原文。 */
export interface MaskedText {
  text: string;
  /** originals[n] 是 ⟦TMn⟧ 替换掉的那段原文（大小写与原文一致）。 */
  originals: string[];
}

/**
 * 把命中的“不翻译”术语换成占位符（#386）。指定了译法的术语不参与。
 * 多条术语重叠时长的优先（“pull request”先于“request”）。原文里本来
 * 就有占位符样式的文字时不替换 —— 回填时无法区分，编号会错乱。
 */
export function maskNoTranslate(text: string, hits: readonly Term[]): MaskedText {
  const sources = hits
    .filter((t) => t.noTranslate)
    .map((t) => t.source.trim())
    .sort((a, b) => b.length - a.length);
  if (sources.length === 0 || /⟦TM\d+⟧/.test(text)) return { text, originals: [] };

  const originals: string[] = [];
  const masked = text.replace(wholeWord(sources, 'giu'), (m) => `⟦TM${originals.push(m) - 1}⟧`);
  return { text: masked, originals };
}

/**
 * 把译文里的占位符换回原文（#386）。占位符缺失、重复或编号越界说明
 * 引擎把它改坏了，返回 null —— 调用方不采用这份译文。
 */
export function unmaskNoTranslate(translation: string, originals: readonly string[]): string | null {
  if (originals.length === 0) return translation;
  const found = [...translation.matchAll(TERM_PLACEHOLDER_RE)].map((m) => Number(m[1]));
  const intact =
    found.length === originals.length &&
    originals.every((_, n) => found.filter((f) => f === n).length === 1);
  if (!intact) return null;
  return translation.replace(TERM_PLACEHOLDER_RE, (_, n: string) => originals[Number(n)]!);
}

/** 按原词去重（不区分大小写，与匹配口径一致），保留先出现的一条（#381）。 */
export function uniqueTerms(terms: readonly Term[]): Term[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const k = t.source.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
