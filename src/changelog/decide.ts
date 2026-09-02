// 「该不该弹更新提示」的判定 —— 纯函数，输入全部显式传入。
//
// 把判定从 content script 的副作用里摘出来单测，是因为它有五条互相
// 独立的拦截规则，而在真实环境里逐条复现（装扩展、改版本、拉黑站点、
// 开 iframe）代价过高。
//
// 返回原因而非裸 boolean,与 orchestration/orchestrator.ts 的 Admission
// 同一风格：调用方拿到 entry 可直接渲染，不必再查一次数据。

import { findEntry, type ChangelogEntry } from './data';

export interface ShowInput {
  /** manifest.version —— 当前运行的版本 */
  version: string;
  /** 开发构建。`pnpm dev` 每次热重载都会触发 onInstalled,必须压住 */
  isDev: boolean;
  isMainFrame: boolean;
  /** 站点在名单中被禁用翻译（黑名单命中 / 白名单未命中） */
  siteBlocked: boolean;
  entries?: readonly ChangelogEntry[];
}

export type ShowDecision =
  | { show: true; entry: ChangelogEntry }
  | {
      show: false;
      reason: 'dev' | 'sub-frame' | 'site-blocked' | 'no-entry';
    };

/**
 * 只做「不需要读存储」的本地预筛：开发模式、子框架、拉黑站点、内部版本。
 *
 * 已读判定**不在这里** —— 它必须与「标记已读」成对原子执行，否则并发的
 * 多个标签页会同时判定为未读而一起弹窗。那一步在 background 的
 * claim.ts 里串行完成。本函数放行只意味着「值得去申请显示权」。
 */
export function decideShow(input: ShowInput): ShowDecision {
  if (input.isDev) return { show: false, reason: 'dev' };
  if (!input.isMainFrame) return { show: false, reason: 'sub-frame' };
  if (input.siteBlocked) return { show: false, reason: 'site-blocked' };

  // ADR-0002: 数据里没有条目的版本就是内部版本，静默升级
  const entry = findEntry(input.version, input.entries);
  if (!entry) return { show: false, reason: 'no-entry' };

  return { show: true, entry };
}
