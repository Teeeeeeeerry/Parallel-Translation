// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 站点黑白名单判定（#153）。
//
// options 页存的是裸域名（小写、无协议）。运行时按 location.hostname
// 匹配，归一化规则：
//   1. 精确相等（localhost、IP 等无域名层级的主机）
//   2. 子域归入条目：news.example.com 命中 example.com
//   3. 主域名归一（www. 前缀、多级子域）：复用 compat.mainDomain 的
//      末两段规则，www.github.com 与 github.com 互为命中
// IP 不做子域/主域归一 —— 精确匹配即可，避免 "192.168.1.1" 被
// "168.1.1" 这类条目误命中。

import { mainDomain } from './compat';

/** 纯 IPv4（也兜住 "127.0.0.1"、"0.0.0.0" 这类常见本地地址）。 */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** 单个域名条目是否命中当前 host。 */
export function siteMatches(host: string, entry: string): boolean {
  if (!entry) return false;
  if (host === entry) return true;
  if (IPV4_RE.test(host) || IPV4_RE.test(entry)) return false;

  // 子域归入条目：news.example.com 命中 example.com
  if (host.endsWith('.' + entry)) return true;

  // 主域名归一：www 前缀与多级子域都归到末两段后比对
  const mdHost = mainDomain(host);
  const mdEntry = mainDomain(entry);
  return mdHost === entry || mdHost === mdEntry || host === mdEntry;
}

/**
 * 当前站点是否应跳过翻译（返回 true = 不翻译）。
 * 黑名单：命中列表 → 跳过；白名单：未命中列表 → 跳过（空列表 = 全站跳过）。
 */
export function isSiteBlocked(
  host: string,
  cfg: { mode: 'blacklist' | 'whitelist'; list: string[] },
): boolean {
  const hit = cfg.list.some((entry) => siteMatches(host, entry));
  return cfg.mode === 'blacklist' ? hit : !hit;
}
