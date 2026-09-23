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

function termPattern(source: string): RegExp {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`, 'iu');
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
  return terms.filter((t) => isEffective(t) && termPattern(t.source.trim()).test(text));
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
