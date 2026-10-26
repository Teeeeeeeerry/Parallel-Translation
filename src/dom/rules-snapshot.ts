// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 站点页面规则快照（#1144，父 #1138）：一次整页采集或一次“找最近单元”开始时
// 读一次当前站点的生效规则（#468），这一次里的判定、取文、切分都用这份快照。
//
// 取文发生在采集之后（整页翻译把采到的单元做成翻译项，逐段翻译拿找到的单元
// 取文），所以采集与找最近单元把这份快照记在交出去的单元上，取文时按单元
// 取回，不再各自重新读一遍。

import { getSiteRules, type EffectiveSiteRules } from '~/src/storage/specialization';

/** 一次采集或一次找最近单元用到的站点页面规则（带排除来源，#922）。 */
export type RulesSnapshot = EffectiveSiteRules;

/** 读一次当前站点的生效规则。 */
export function readRulesSnapshot(): RulesSnapshot {
  return getSiteRules(location.hostname, { withSources: true });
}

const byUnit = new WeakMap<Element, RulesSnapshot>();

/** 记下交出去的单元是按哪份快照判定的。 */
export function noteUnitRules(unit: Element, rules: RulesSnapshot): void {
  byUnit.set(unit, rules);
}

/**
 * 单元判定时用的那份快照。采集与找最近单元交出的单元都记过；没记过的（不是
 * 从这两处拿到的元素）按当前规则读一次并记下。
 */
export function unitRules(unit: Element): RulesSnapshot {
  let rules = byUnit.get(unit);
  if (!rules) {
    rules = readRulesSnapshot();
    byUnit.set(unit, rules);
  }
  return rules;
}
