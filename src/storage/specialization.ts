// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的站点页面规则部分（#366，父 #365）；领域部分
// 见 domains.ts。
//
// 设置页与 DOM 采集都只经这里读取站点页面规则。目前只有内置来源；
// 用户规则、停用内置规则在后续 ticket 接入，对外接口不变。

import { siteMatches } from '~/src/dom/site-filter';
import { BUILTIN_SITE_RULES } from './builtin-site-rules';

/** 一个站点的页面规则：CSS 选择器列表。 */
export interface SiteRules {
  /** 排除：命中的元素整块不翻译 */
  exclude: string[];
}

/**
 * 按当前站点读取生效站点规则。
 * 同步返回 —— walker 的采集入口是同步的，每次采集调用一次。
 */
export function getSiteRules(host: string): SiteRules {
  const exclude: string[] = [];
  for (const [site, rules] of Object.entries(BUILTIN_SITE_RULES)) {
    if (siteMatches(host, site)) exclude.push(...rules.exclude);
  }
  return { exclude };
}
