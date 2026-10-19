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
//
// #1071：引擎时段的超时也在这里。一批在后台先在引擎闸门里排队（google-web 一条
// 文本一个请求，和别的批次的文本混在同一个队列里），排队的时间不该算进超时；从这
// 一批第一次拿到引擎许可起计 ENGINE_PHASE_TIMEOUT_MS，到点中止这一批，并报成可
// 重试的瞬时超时。content 那一侧的单次响应超时因此只作兜底（messaging.ts）。

import { EngineError, type TranslateResponse } from '~/src/engines/types';
import { FETCH_TIMEOUT_MS } from '~/src/engines/fetch-timeout';

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

/** 引擎时段超时（#1071）：从这一批第一次拿到引擎许可起计。与单个请求的 fetch 超时同值。 */
export const ENGINE_PHASE_TIMEOUT_MS = FETCH_TIMEOUT_MS;

/**
 * 带引擎时段超时跑一次引擎调用（#1071）。call 拿到的 signal 在超时到点、或
 * opts.signal（在飞表给的，content 放弃这一批）中止时中止；
 * onGateStart 在每次拿到引擎许可时调用，第一次调用起开始计时。超时到点后调用以
 * 可重试的瞬时失败结束，不报“已中止” —— 这一批没人放弃，只是引擎太慢。
 * 已有段落译好时路由带着“已中止”的原因返回部分结果（#440）：这里去掉这个原因，
 * 失败段落照常交给批次重试补齐。
 */
export async function runEngineCall(
  call: (ctl: { signal: AbortSignal; onGateStart: () => void }) => Promise<TranslateResponse>,
  opts: {
    signal?: AbortSignal;
    /** 超时到点时调用（#1083 的观测据此计数） */
    onTimeout?: () => void;
  } = {},
): Promise<TranslateResponse> {
  const ctrl = new AbortController();
  const onCancel = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener('abort', onCancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const onGateStart = () => {
    timer ??= setTimeout(() => {
      // content 已经放弃了这一批：结果没人要，不算超时
      if (opts.signal?.aborted) return;
      timedOut = true;
      opts.onTimeout?.();
      ctrl.abort();
    }, ENGINE_PHASE_TIMEOUT_MS);
  };
  try {
    const resp = await call({ signal: ctrl.signal, onGateStart });
    if (timedOut && resp.failure?.category === 'aborted') {
      const { failure: _aborted, ...rest } = resp;
      return rest;
    }
    return resp;
  } catch (e) {
    if (timedOut) throw new EngineError('router', true, `引擎响应超时（${ENGINE_PHASE_TIMEOUT_MS}ms）`);
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCancel);
  }
}
