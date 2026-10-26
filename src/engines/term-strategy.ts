// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 术语策略（#1155，父 #1142）：“一个引擎怎么处理术语”收在这里，每种处理方式
// 一个策略，负责四件事 ——
//
// 1. 哪些术语参与缓存键（#419：不生效的术语改了不该让缓存失效），以及缓存键
//    要不要带“指定译法”开关（#390）；
// 2. 发送前怎么改写：AI 引擎把本批命中的术语带进请求、写进提示词（#381/#382）；
//    机翻引擎把生效的术语换成占位符（#386）；
// 3. 收到后怎么还原：占位符换回原词或指定译法；
// 4. 占位符被引擎改坏时报出来（还原结果为 null），路由改用原文、不带术语重译
//    这一段（#389）。
//
// 引擎只声明用哪种策略（TranslateEngine.termHandling），路由主流程不再按引擎
// 类型分支。原先这几件事散在路由的生效术语计算、发送前替换、收到后换回、缓存
// 键哈希与引擎上的两个标志里，改规则时容易漏改缓存键那一处。

import type { Term } from '~/src/storage/domains';
import { maskTerms, unmaskTerms } from './terms';

/** 引擎处理术语的方式：不处理、注入提示词、用占位符落实。 */
export type TermHandling = 'none' | 'inject' | 'mask';

/** 一批文字按策略改写后的结果。 */
export interface TermPlan {
  /** 发给引擎的文字（与原文一一对应） */
  texts: string[];
  /** 随请求带给引擎的术语；不带时为 undefined */
  terms: Term[] | undefined;
  /** 第 j 段的译文还原；占位符被改坏时为 null */
  restore(raw: string, j: number): string | null;
}

export interface TermStrategy {
  /** 一段原文命中的术语里，本引擎实际生效、参与缓存键的那些 */
  effectiveTerms(hits: readonly Term[], mtApplyTermTargets: boolean): Term[];
  /** 缓存键要不要带“指定译法”开关的状态（#390） */
  keyFlag(mtApplyTermTargets: boolean): boolean;
  /**
   * 发送前改写一批：texts 是原文，effective 是每段的生效术语，batch 是本批
   * （未命中缓存的段落）命中的术语，已去重
   */
  prepare(texts: readonly string[], effective: readonly Term[][], batch: readonly Term[]): TermPlan;
}

const asIs = (raw: string) => raw;

/** 不处理术语：缓存键不带术语，请求原样发送。 */
const none: TermStrategy = {
  effectiveTerms: () => [],
  keyFlag: () => false,
  prepare: (texts) => ({ texts: [...texts], terms: undefined, restore: asIs }),
};

/**
 * 注入提示词（AI 引擎，#381/#382/#419）：全部命中术语都生效、参与缓存键；
 * 只带本批命中的术语，不发送整个领域；译文原样采用。
 */
const inject: TermStrategy = {
  effectiveTerms: (hits) => [...hits],
  keyFlag: () => false,
  prepare: (texts, _effective, batch) => ({
    texts: [...texts],
    terms: batch.length > 0 ? [...batch] : undefined,
    restore: asIs,
  }),
};

/**
 * 占位符落实（机翻引擎，#386/#390）：默认只有“不翻译”术语生效，“指定译法”
 * 开关打开后也落实指定了译法的术语，开关状态一并进缓存键。发送前把生效的
 * 术语换成占位符，收到后换回；占位符被改坏时还原为 null（#389）。
 */
const mask: TermStrategy = {
  effectiveTerms: (hits, mtApplyTermTargets) =>
    mtApplyTermTargets ? [...hits] : hits.filter((t) => t.noTranslate === true),
  keyFlag: (mtApplyTermTargets) => mtApplyTermTargets,
  prepare: (texts, effective) => {
    const masks = texts.map((t, j) => maskTerms(t, effective[j]!));
    return {
      texts: masks.map((m) => m.text),
      terms: undefined,
      restore: (raw, j) => unmaskTerms(raw, masks[j]!.replacements),
    };
  },
};

const STRATEGIES: Record<TermHandling, TermStrategy> = { none, inject, mask };

/** 引擎声明的处理方式对应的策略；没有声明的引擎不处理术语。 */
export function termStrategy(handling: TermHandling | undefined): TermStrategy {
  return STRATEGIES[handling ?? 'none'];
}
