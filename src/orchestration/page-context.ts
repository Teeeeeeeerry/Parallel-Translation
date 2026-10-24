// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 页面上下文（#1119，父 #1112）：“这个页面能不能翻”与“当前领域是哪个”只在这里算。
//
// 持有设置读取、本 frame 与顶层页面的主机名、领域列表与本标签页的临时选择，对外
// 只回答几个问题：准入结果、按目标语言解析的当前领域 ID、popup 用的领域状态。
// 编排模块（整页、逐段、划词、输入翻译）问它；规则只有这一份：
// - 准入：总开关关闭为 disabled；站点名单按本 frame 的主机名判定（#311、#632）；
// - 当前领域按顶层页面的主机名判定，一个标签页里所有 frame 同一个领域（#471）；
// - 临时选择（popup 里临时切换或选“无领域”，#400）优先于按网址判定；
// - 领域按调用方给的目标语言解析：输入翻译传的是对方语言（ADR-0005）。
//
// 领域与站点页面规则两个存储模块不合并（ADR-0004）：这里只读它们交来的数据。

import type { Settings } from '~/src/storage/schema';
import { currentDomain, type Domain, type DomainChoice } from '~/src/storage/domains';
import { isSiteBlocked } from '~/src/dom/site-filter';

/**
 * 准入结果（#311）—— 总开关与站点名单判定：
 *   - allowed：放行
 *   - disabled：总开关关闭，不发请求
 *   - blocked：站点在黑名单中（或白名单未命中），不发请求
 */
export type Admission = 'allowed' | 'disabled' | 'blocked';

/** popup 显示用的领域状态（#399、#400）。 */
export interface DomainState {
  /** 顶层页面的主机名 —— #401“以后在此站点都使用”按它记住 */
  host: string;
  /** 自动判定会选中的领域名；没有时为 null */
  autoName: string | null;
  /** 本标签页的临时选择 */
  choice: DomainChoice;
  /** 可切换到的领域：一个领域只服务一种目标语言 */
  options: { id: string; name: string }[];
}

/** 页面上下文的输入。都可省：省略时放行、没有领域、算主框架（单测用）。 */
export interface PageContextSource {
  /** 读取当前设置（#310）；省略时不做准入判定 */
  getSettings?: () => Settings;
  /** 本 frame 的主机名（#311）：站点名单按它判定 */
  getHostname?: () => string;
  /** 顶层页面的主机名（#471）：当前领域按它判定；省略时同本 frame */
  getTopHostname?: () => string;
  /** 生效领域列表（#379）；省略时视同没有领域 */
  getDomains?: () => readonly Domain[];
  /** 本标签页的临时领域选择（#400）；省略时视同自动 */
  getDomainChoice?: () => DomainChoice;
  /** 是否主框架（#327）；省略时算主框架 */
  isMainFrame?: () => boolean;
}

export interface PageContext {
  /** 当前设置；没注入设置读取时为 undefined。 */
  settings(): Settings | undefined;
  /** 这个页面能不能翻（总开关与站点名单）。 */
  admission(): Admission;
  /** 是否主框架。 */
  isMainFrame(): boolean;
  /** 按目标语言解析的当前领域 ID；没有时为 undefined（请求里不带这个字段）。 */
  domainId(to: string): string | undefined;
  /** popup 用的领域状态，按 popup 当前所选的目标语言。 */
  domainState(to: string): DomainState;
}

export function createPageContext(src: PageContextSource): PageContext {
  const hostname = () => src.getHostname?.() ?? '';
  const topHostname = () => (src.getTopHostname ?? hostname)();
  const domains = () => src.getDomains?.() ?? [];
  const choice = (): DomainChoice => src.getDomainChoice?.() ?? { kind: 'auto' };

  return {
    settings: () => src.getSettings?.(),

    admission() {
      const s = src.getSettings?.();
      if (!s) return 'allowed';
      if (!s.enabled) return 'disabled';
      if (isSiteBlocked(hostname(), s.siteList)) return 'blocked';
      return 'allowed';
    },

    isMainFrame: () => src.isMainFrame?.() !== false,

    domainId(to) {
      if (!src.getDomains) return undefined;
      return currentDomain(domains(), topHostname(), to, choice())?.id;
    },

    domainState(to) {
      const lang = to.toLowerCase();
      const host = topHostname();
      const list = domains();
      return {
        host,
        autoName: currentDomain(list, host, to)?.name ?? null,
        choice: choice(),
        options: list
          .filter((d) => d.targetLang.toLowerCase() === lang)
          .map((d) => ({ id: d.id, name: d.name })),
      };
    },
  };
}
