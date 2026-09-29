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
//
// 中日韩术语按子串匹配（#385）：原词边缘是中日韩文字的一侧不检查词边界，
// “K8s集群”里的“集群”照样命中。混合原词两侧分别看：“K8s 集群”左侧是
// 拉丁字母，仍按整词，“EK8s 集群”不命中；右侧是中文，“K8s 集群化”命中。

import type { Term } from '~/src/storage/domains';

/**
 * 中日韩文字。按 Script_Extensions 判定，长音符“ー”这类兼属多种文字的
 * 字符也算在内（#385）。
 */
const CJK = '[\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}]';
const CJK_CHAR = new RegExp(CJK, 'u');

/** 词内字符：字母、数字、下划线，中日韩文字除外。 */
const WORD_CHAR = `(?:(?!${CJK})[\\p{L}\\p{N}_])`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 一个原词的匹配式：边缘不是中日韩文字的一侧要求词边界。 */
function termPattern(source: string): string {
  const chars = [...source];
  const before = CJK_CHAR.test(chars[0]!) ? '' : `(?<!${WORD_CHAR})`;
  const after = CJK_CHAR.test(chars[chars.length - 1]!) ? '' : `(?!${WORD_CHAR})`;
  return `${before}${escapeRegExp(source)}${after}`;
}

/** 按词边界匹配任一原词（不区分大小写；中日韩文字一侧按子串，#385）。 */
function termRegExp(sources: readonly string[], flags: string): RegExp {
  return new RegExp(sources.map(termPattern).join('|'), flags);
}

/** 能约束译文的术语：给了译法，或标为“不翻译”。 */
function isEffective(t: Term): boolean {
  return t.source.trim() !== '' && (t.noTranslate === true || !!t.target?.trim());
}

const WORD_CHAR_RE = new RegExp(`^${WORD_CHAR}$`, 'u');

/** text 里 i 之前的一个字符（按码点，代理对算一个）；在开头时为空。 */
function charBefore(text: string, i: number): string {
  if (i === 0) return '';
  const cp = text.codePointAt(i - 2);
  return i >= 2 && cp !== undefined && cp > 0xffff ? text.slice(i - 2, i) : text[i - 1]!;
}

/** text 里从 i 开始的一个字符（按码点）；在结尾时为空。 */
function charAt(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * 一条原词的匹配函数（#418）：判定与 termPattern 相同，但原词本身只用
 * 一个不带词边界的正则找，词边界在每个出现位置单独检查。带 Unicode
 * 属性类的整词正则每条编译要约 1 毫秒，几千条术语就是几秒。
 */
function termMatcher(source: string): (text: string) => boolean {
  const chars = [...source];
  const checkBefore = !CJK_CHAR.test(chars[0]!);
  const checkAfter = !CJK_CHAR.test(chars[chars.length - 1]!);
  const re = new RegExp(escapeRegExp(source), 'giu');
  return (text) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const end = m.index + m[0].length;
      if (
        (!checkBefore || !WORD_CHAR_RE.test(charBefore(text, m.index))) &&
        (!checkAfter || !WORD_CHAR_RE.test(charAt(text, end)))
      ) {
        return true;
      }
      // 从下一个字符接着找：重叠的出现位置（“a-a”在“xa-a-a”里）也要检查
      re.lastIndex = m.index + charAt(text, m.index).length;
    }
    return false;
  };
}

/**
 * 每份术语表的匹配函数，按术语表对象缓存（#418）：同一领域的几千条术语
 * 只构造一次，不按“术语 × 段落”重复构造。领域数据变了，生效领域列表是
 * 新对象，旧的随之回收。每条术语各自匹配 —— 合并成一个正则会让重叠的
 * 术语（“pull request”与“request”）只命中一条。
 */
const compiledTerms = new WeakMap<readonly Term[], { term: Term; test: (text: string) => boolean }[]>();

function termMatchers(terms: readonly Term[]): { term: Term; test: (text: string) => boolean }[] {
  let matchers = compiledTerms.get(terms);
  if (!matchers) {
    matchers = terms.filter(isEffective).map((term) => ({ term, test: termMatcher(term.source.trim()) }));
    compiledTerms.set(terms, matchers);
  }
  return matchers;
}

/**
 * 原文里命中的术语，保持术语在领域里的顺序。无从约束译文的术语
 * （既没给译法、也没标“不翻译”）不算命中，不进缓存 key 也不发送。
 * 调用方不得原地修改传入的术语表 —— 匹配式按术语表对象缓存。
 */
export function matchTerms(terms: readonly Term[], text: string): Term[] {
  return termMatchers(terms)
    .filter(({ test }) => test(text))
    .map(({ term }) => term);
}

/**
 * 术语占位符（#386）：⟦TM0⟧、⟦TM1⟧ ……
 * 与保留原文的 ⟦PT0⟧ 区分开 —— 两者同段出现时编号互不冲突，
 * content 侧的保留原文回填也不会误认它。
 */
const TERM_PLACEHOLDER_RE = /⟦TM(\d+)⟧/g;

/** 占位符替换结果：发给机翻引擎的文本 + 每个占位符回填的文字。 */
export interface MaskedText {
  text: string;
  /**
   * replacements[n] 是 ⟦TMn⟧ 回填的文字：“不翻译”术语是被替换掉的那段
   * 原文（大小写与原文一致），指定了译法的术语（#390）是它的译法。
   */
  replacements: string[];
}

/**
 * 把传入的术语换成占位符（#386）。调用方决定哪些术语参与：默认只有
 * “不翻译”术语，机翻“指定译法”开关打开后也包括指定了译法的术语（#390）。
 * 多条术语重叠时长的优先（“pull request”先于“request”）。原文里本来
 * 就有占位符样式的文字时不替换 —— 回填时无法区分，编号会错乱。
 */
export function maskTerms(text: string, terms: readonly Term[]): MaskedText {
  const sources = terms.map((t) => t.source.trim()).sort((a, b) => b.length - a.length);
  if (sources.length === 0 || /⟦TM\d+⟧/.test(text)) return { text, replacements: [] };

  const replacements: string[] = [];
  const masked = text.replace(termRegExp(sources, 'giu'), (m) => {
    const term = terms.find((t) => t.source.trim().toLowerCase() === m.toLowerCase());
    // 同时标了“不翻译”和译法时按“不翻译”处理
    const fill = term && !term.noTranslate && term.target?.trim() ? term.target.trim() : m;
    return `⟦TM${replacements.push(fill) - 1}⟧`;
  });
  return { text: masked, replacements };
}

/**
 * 把译文里的占位符换回对应文字（#386）。占位符缺失、重复或编号越界说明
 * 引擎把它改坏了，返回 null —— 调用方不采用这份译文。
 */
export function unmaskTerms(translation: string, replacements: readonly string[]): string | null {
  if (replacements.length === 0) return translation;
  const found = [...translation.matchAll(TERM_PLACEHOLDER_RE)].map((m) => Number(m[1]));
  const intact =
    found.length === replacements.length &&
    replacements.every((_, n) => found.filter((f) => f === n).length === 1);
  if (!intact) return null;
  return translation.replace(TERM_PLACEHOLDER_RE, (_, n: string) => replacements[Number(n)]!);
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
