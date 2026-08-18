// 批次级「发送 → 失败重试」循环（content script 整页翻译专用）。
//
// 与 messaging.ts 的分工：messaging 负责消息通道的传输层重试
// （ping + 有界退避）；本模块负责引擎级失败（{ok:false}）的批次重试。
//
// #91：传输层成功后引擎仍可能失败（CI 中 SW 冷启动/实例替换），
// 修复前增量翻译是一次性的，瞬时故障后新内容永久漏翻。这里按
// BATCH_RETRY_DELAYS_MS 有界重试，文本在批次切分时已捕获一次，
// 重试复用同一份 —— 不会因 DOM 已变而重新采集到译文本身。
//
// #111：扩展上下文失效（重载 / 更新）不可恢复 —— 重试永远无意义，
// 检测到立即失败（0 次重试），由调用方置全局短路，其余批次
// 不再发起新尝试，toast 立即出现而非等完 [1000, 3000]ms 重试序列。
// #116：失效判定用 messaging 透出的类型化 invalidated 标志，
// 不匹配错误文案 —— 文案改写不影响短路行为。

import type { TranslateResponse } from '~/src/engines/types';
import { sleep as defaultSleep } from '~/src/runtime/sleep';

/** #91: 批次级引擎失败最大重试次数。 */
export const BATCH_RETRY_LIMIT = 2;
/** #91: 重试退避序列（毫秒）。 */
export const BATCH_RETRY_DELAYS_MS = [1000, 3000];

export type BatchRetryResult =
  | { ok: true; data: TranslateResponse }
  | {
      ok: false;
      /** 上下文失效（不可恢复）—— 未重试（#111）。 */
      invalidated: boolean;
      /** 中止（还原 / 其他批次已判失效）—— 未完成。 */
      aborted: boolean;
      error: string;
    };

export interface BatchRetryOptions {
  /** 注入 sleep 以便测试推进虚拟时钟（#136）；默认 src/runtime/sleep 共享实现。 */
  sleep?: (ms: number) => Promise<void>;
  /** 每次尝试前后检查；返回 true 则立即中止剩余重试。 */
  shouldAbort?: () => boolean;
}

/**
 * 发送一批文本直至成功或重试预算耗尽。
 * - ok 响应立即返回（调用方负责渲染）
 * - 引擎级失败按 BATCH_RETRY_DELAYS_MS 有界重试（#91）
 * - 上下文失效立即返回 invalidated，0 次重试（#111）
 */
export async function attemptBatchWithRetry(
  send: () => Promise<{
    ok: boolean;
    data?: TranslateResponse;
    error?: string;
    /** #116: messaging 透出的类型化上下文失效标志。 */
    invalidated?: boolean;
  }>,
  opts: BatchRetryOptions = {},
): Promise<BatchRetryResult> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError = '未知错误';
  for (let attempt = 0; ; attempt++) {
    if (opts.shouldAbort?.()) {
      return { ok: false, invalidated: false, aborted: true, error: '' };
    }
    const resp = await send();
    if (opts.shouldAbort?.()) {
      return { ok: false, invalidated: false, aborted: true, error: '' };
    }
    if (resp?.ok && resp.data) {
      return { ok: true, data: resp.data };
    }
    lastError = resp?.error ?? '未知错误';
    // #111/#116: 上下文失效是类型化标志 —— 立即失败，不进入重试序列
    if (resp?.invalidated) {
      return { ok: false, invalidated: true, aborted: false, error: lastError };
    }
    if (attempt >= BATCH_RETRY_LIMIT) break;
    await sleep(BATCH_RETRY_DELAYS_MS[attempt]!);
  }
  // #157: 最后一次尝试失败后、返回前再查一次中止 —— 还原（纪元递增）
  // 恰在最后失败与返回之间发生时，也必须报 aborted 而不是 failed，
  // 否则调用方把它记成真失败（allFailed/错误 toast 误报）
  return {
    ok: false,
    invalidated: false,
    aborted: opts.shouldAbort?.() ?? false,
    error: lastError,
  };
}
