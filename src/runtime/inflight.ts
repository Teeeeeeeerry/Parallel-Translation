// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 后台的在飞表（#1001）：批次身份 → 这次引擎调用的中止控制器。
//
// content 放弃一批（响应超时、用户点还原、失效短路）时发来批次身份，后台凭它
// 中止对应的引擎调用：排队的请求不再发出，在飞的 fetch 被取消。
//
// 表只在 service worker 实例的内存里。MV3 会回收实例，表随之清空 —— 这时查不到
// 就当没有可中止的，什么也不做：那次调用要么已随实例一起没了，要么在新实例里
// 根本没开始。中止是尽力而为，查不到不是错误。

/** 在飞表的键：同一个批次身份在不同标签页、不同 frame 里互不相干。 */
export function inFlightKey(tabId: number | undefined, frameId: number | undefined, batchId: string): string {
  return `${tabId ?? -1}:${frameId ?? -1}:${batchId}`;
}

export interface InFlightTable {
  /** 登记一次引擎调用，返回给它的中止信号。 */
  start(key: string): AbortSignal;
  /** 调用结束（成功、失败或已中止）：从表里移除。 */
  finish(key: string): void;
  /** 中止并移除；表里没有（已结束、实例换过）时返回 false，不报错。 */
  cancel(key: string): boolean;
  /** 在飞数量（测试用）。 */
  size(): number;
}

export function createInFlightTable(): InFlightTable {
  const table = new Map<string, AbortController>();
  return {
    start(key) {
      const ctrl = new AbortController();
      table.set(key, ctrl);
      return ctrl.signal;
    },
    finish(key) {
      table.delete(key);
    },
    cancel(key) {
      const ctrl = table.get(key);
      if (!ctrl) return false;
      table.delete(key);
      ctrl.abort();
      return true;
    },
    size() {
      return table.size;
    },
  };
}
