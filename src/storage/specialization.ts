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

/** 选择器能否解析：按“站点 + 选择器”缓存，无效的只警告一次。 */
const selectorValidity = new Map<string, boolean>();

/**
 * #368：运行时解析失败的选择器只跳过它自己（ADR-0003），避免重演
 * #93 —— 一条带尾随逗号的无效选择器让 walker 对每个元素抛错，整页
 * 采集 0 个单元。用空文档片段试解析，不触碰页面。
 *
 * 需要 DOM：只在 content script 等有 document 的上下文调用。只把
 * SyntaxError 当作无效选择器，其他错误（例如在 service worker 里
 * document 未定义）照常抛出，不会把全部选择器静默判为无效。
 */
function isValidSelector(site: string, sel: string): boolean {
  const key = `${site}\n${sel}`;
  let valid = selectorValidity.get(key);
  if (valid === undefined) {
    try {
      document.createDocumentFragment().querySelector(sel);
      valid = true;
    } catch (e) {
      if ((e as Error).name !== 'SyntaxError') throw e;
      valid = false;
      console.warn(
        `[PT] 站点页面规则中的无效选择器已跳过：${site} ${JSON.stringify(sel)}`,
      );
    }
    selectorValidity.set(key, valid);
  }
  return valid;
}

/**
 * 按当前站点读取生效站点规则，已剔除无法解析的选择器。
 * 同步返回 —— walker 的采集入口是同步的，每次采集调用一次。
 */
export function getSiteRules(host: string): SiteRules {
  const exclude: string[] = [];
  for (const [site, rules] of Object.entries(BUILTIN_SITE_RULES)) {
    if (!siteMatches(host, site)) continue;
    exclude.push(...rules.exclude.filter((sel) => isValidSelector(site, sel)));
  }
  return { exclude };
}
