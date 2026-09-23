// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的领域部分（#379，父 #365）；站点页面规则部分
// 见 specialization.ts。
//
// 设置页、popup、content、router 都只经这里读取领域。目前生效领域
// 列表只含内置领域；用户叠加层、自建领域与排序在后续 ticket 接入，
// 届时同样落在 storage.local（不占 sync 配额），对外接口不变。

import { siteMatches } from '~/src/dom/site-filter';
import { BUILTIN_DOMAINS } from './builtin-domains';

/** 术语：领域里的一条对照（原词 → 译法），或标记为「不翻译」。 */
export interface Term {
  /** 原词。 */
  source: string;
  /** 译法。noTranslate 为真时不需要。 */
  target?: string;
  /** 不翻译：原词原样出现在译文里。 */
  noTranslate?: boolean;
}

/** 领域：一组术语加一组适用网址，只服务一种目标语言。 */
export interface Domain {
  id: string;
  name: string;
  /** 目标语言（BCP-47，与 Settings.to 同一套语言码）。 */
  targetLang: string;
  /** 适用网址：裸域名，语义与站点黑白名单相同。 */
  sites: string[];
  terms: Term[];
  /** 来源：内置或用户自建。 */
  origin: 'builtin' | 'user';
}

/**
 * 生效领域列表 —— 已按优先级排序，调用方可随意改动返回值。
 */
export async function getEffectiveDomains(): Promise<Domain[]> {
  return BUILTIN_DOMAINS.map((d) => ({
    ...d,
    sites: [...d.sites],
    terms: d.terms.map((t) => ({ ...t })),
  }));
}

/**
 * 当前领域：列表中第一个目标语言一致、且适用网址命中 host 的领域。
 * 目标语言不一致的领域不启用，继续看后面的领域；都不命中返回 null。
 */
export function currentDomain(
  domains: readonly Domain[],
  host: string,
  targetLang: string,
): Domain | null {
  const lang = targetLang.toLowerCase();
  return (
    domains.find(
      (d) =>
        d.targetLang.toLowerCase() === lang &&
        d.sites.some((entry) => siteMatches(host, entry)),
    ) ?? null
  );
}
