// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// content → background 消息通道健壮层。
//
// #89：Chrome MV3 的 service worker 在 headless/冷启动场景下，
// onMessage 监听器未必已注册 —— content script 此时发出的
// chrome.runtime.sendMessage 要么解析为 undefined（无监听器），
// 要么 reject "Could not establish connection. Receiving end does not exist."。
// 直接当作最终失败会让整页翻译静默失败（[data-pt="done"] 永不出现）。
//
// #154：sendMessage 在 SW 挂起时永不 settle（响应级超时前的原实现
// 只 await 不设限），deadline 检查走不到，预算形同虚设。现在每次发送
// 都套 withTimeout —— 单次最长等 MESSAGE_TIMEOUT_MS（与引擎 fetch
// 超时对齐），超时视为一次传输层失败进入重试，预算真正封顶总耗时。
//
// translateViaBackground 是 content script 三个翻译入口共用的通道：
// 1. 先 ping（pt:ping）确认 SW 消息通道就绪，有界重试
// 2. 再发 pt:translate；传输层失败（无响应/连接被拒/超时）有界重试
// 3. SW 已响应的 {ok:false} 是引擎级失败（router 已做过引擎降级），不重试
// 4. 预算耗尽返回 {ok:false} + 错误说明，永不抛出 —— 调用方按原约定处理
//
// #1001：每次发出 pt:translate 都带一个新的批次身份。这一次不再等了（单次
// 响应超时、连接被拒），或调用方的中止信号触发（用户点还原、别的批次判了
// 失效），就把这个身份发给后台（pt:cancel-batches），后台中止对应的引擎调用。
// 中止消息发出去就算数：不等回复、不重试，后台没收到只是回到原来的行为
// （后台把这一批翻完，结果没人要）。
//
// #1065：传输重试也认调用方的中止信号。每次发送前查一次，已中止就不再生成新的
// 批次身份、以放弃结束；退避等待可被打断。等后台就绪（ping）阶段同样如此。
// 已经发出、正在等回复的那一次不被打断：它交给后台中止，回复照旧等。

import type {
  TranslateRequest,
  TranslateResponse,
  FailureCategory,
} from '~/src/engines/types';
import { sleepUnlessAborted } from '~/src/runtime/sleep';

export type TranslateResult =
  | { ok: true; data: TranslateResponse }
  | {
      ok: false;
      error: string;
      invalidated: boolean;
      /** #236: 类型化失败类别 —— 语义判定只在引擎处做一次，原样透传。 */
      category: FailureCategory;
      /** #236: 已中止。 */
      aborted: boolean;
      /**
       * #579: 扩展上下文失效（区别于同样置 invalidated 的配额耗尽），
       * 仅在失效时出现。
       */
      contextInvalidated?: boolean;
    };

/** SW 就绪等待预算（ping 阶段）。覆盖 CI 中 SW 冷启动的常见耗时。 */
const READY_BUDGET_MS = 10_000;
/**
 * 翻译消息总预算（含重试）。须 ≥ MESSAGE_TIMEOUT_MS 让单次完整
 * 引擎往返（30s fetch 超时 + SW 开销）能在预算内完成。
 */
const SEND_BUDGET_MS = 45_000;
/** 单次 sendMessage 响应级超时 —— 与引擎 fetch 超时对齐（#154）。 */
export const MESSAGE_TIMEOUT_MS = 30_000;
/** 退避起点（毫秒），每次翻倍，上限 2s。 */
const BACKOFF_INITIAL_MS = 250;
const BACKOFF_MAX_MS = 2000;

/** 上下文失效错误文案。 */
export const CONTEXT_INVALIDATED_MSG =
  '[PT] 扩展上下文已失效（扩展已更新或重载），请刷新页面后重试';

/**
 * 上下文失效错误 —— 类型化错误类别（#116）。
 * 调用方按 instanceof 判定而非匹配文案，messaging 层改写文案不影响判定。
 */
export class ContextInvalidatedError extends Error {
  constructor(message: string = CONTEXT_INVALIDATED_MSG) {
    super(message);
    this.name = 'ContextInvalidatedError';
  }
}

/**
 * 扩展上下文是否已失效。重载 / 更新 / 禁用扩展后，已注入页面的
 * content script 里 chrome.runtime 变为 undefined 且永不恢复 ——
 * 当作 SW 冷启动重试只会空耗 ping + translate 两级预算（25 秒），
 * 最终报出误导性的“消息通道不可用”。
 */
function isContextInvalidated(): boolean {
  try {
    return (globalThis.chrome as { runtime?: { id?: string } } | undefined)
      ?.runtime?.id == null;
  } catch {
    return true; // chrome 访问本身抛异常 —— 上下文已异常
  }
}

/**
 * 响应级超时包装（#154）：ms 内未 settle 即拒绝。
 * 放弃方（sendMessage）的后续 settle 由内部 then/catch 消化，无未处理拒绝。
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`响应超时（${ms}ms）`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 批次身份（#1001）：本 content 实例内唯一，前缀区分同一 frame 里重新注入的实例。 */
const BATCH_ID_PREFIX = Math.random().toString(36).slice(2, 10);
let batchSeq = 0;
function newBatchId(): string {
  return `${BATCH_ID_PREFIX}-${++batchSeq}`;
}

/** 调用方中止了（#1065）：传输重试在发送前或退避中发现，不再发下一条。 */
class SendAbortedError extends Error {
  constructor() {
    super('已中止');
    this.name = 'SendAbortedError';
  }
}

/**
 * 通知后台这些批次不用再翻了（#1001）。发出去就算数：不等回复，发送失败
 * （上下文已失效、后台没在听）一律吞掉 —— 后台没收到只是回到原来的行为。
 */
export function cancelBatches(ids: string[]): void {
  if (ids.length === 0) return;
  try {
    chrome.runtime.sendMessage({ type: 'pt:cancel-batches', ids }).catch(() => {});
  } catch {
    // 上下文失效时 chrome.runtime 访问本身会抛
  }
}

/**
 * 有界重试发送：只要收不到任何响应（undefined / 连接被拒 / 超时），
 * 就以指数退避重发，直到预算耗尽。收到响应（无论内容）即返回。
 * 预算耗尽时抛出最后一次失败原因。
 *
 * #1001：消息按次生成（每次重发是一条新消息）；某一次不再等时交给
 * onAbandon（翻译消息据此通知后台中止那一次）。
 */
async function sendWithTransportRetry(
  makeMsg: () => unknown,
  budgetMs: number,
  signal: AbortSignal | undefined,
  onAbandon?: (msg: unknown) => void,
): Promise<unknown> {
  const deadline = Date.now() + budgetMs;
  let delay = BACKOFF_INITIAL_MS;
  let lastError = 'background 无响应';

  for (;;) {
    // 上下文失效不可恢复：立即失败并提示刷新页面，不空等重试预算
    if (isContextInvalidated()) {
      throw new ContextInvalidatedError();
    }
    // #1065：调用方已放弃 —— 不再生成新消息（也就没有新的批次身份）
    if (signal?.aborted) throw new SendAbortedError();

    // 单次最长等待 = 剩余预算与响应级超时的较小者（#154）
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.min(remaining, MESSAGE_TIMEOUT_MS);

    let resp: unknown;
    const msg = makeMsg();
    try {
      resp = await withTimeout(
        chrome.runtime.sendMessage(msg),
        attemptTimeout,
      );
    } catch (e) {
      onAbandon?.(msg);
      // 类型化判定（#139）：sendMessage 抛错时再查一次上下文是否已失效 ——
      // 失效是结构化状态（chrome.runtime.id 为 null），不依赖错误文案。
      // 上下文仍有效则视为可重试的传输层错误（如 SW 监听器未注册、响应超时）。
      if (isContextInvalidated()) {
        throw new ContextInvalidatedError();
      }
      lastError = e instanceof Error ? e.message : String(e);
      resp = undefined;
    }
    if (resp !== undefined) return resp;
    if (Date.now() >= deadline) break;
    await sleepUnlessAborted(delay, signal);
    delay = Math.min(delay * 2, BACKOFF_MAX_MS);
  }

  throw new Error(`[PT] 消息通道不可用: ${lastError}`);
}

/**
 * 通过 background 翻译文本。
 *
 * 永不抛出 —— 通道彻底不可用时返回 {ok:false, error}，
 * 与 SW 的 pt:translate 失败响应同构，调用方无需区分。
 */
export async function translateViaBackground(
  payload: TranslateRequest,
  ctl?: { signal?: AbortSignal },
): Promise<TranslateResult> {
  // #1001：正在等的那一次的批次身份；调用方中止时通知后台中止它
  let current: string | null = null;
  const onAbort = () => {
    if (current) cancelBatches([current]);
  };
  ctl?.signal?.addEventListener('abort', onAbort);
  try {
    // 1) SW 就绪等待：任何 ping 响应都证明消息通道已注册监听器。
    await sendWithTransportRetry(() => ({ type: 'pt:ping' }), READY_BUDGET_MS, ctl?.signal);

    // 2) 发送翻译消息，传输层失败重试。每次发送一个新的批次身份；
    // 这一次不再等（超时、连接被拒）时通知后台中止它
    const resp = (await sendWithTransportRetry(
      () => {
        current = newBatchId();
        return { type: 'pt:translate', payload: { ...payload, batchId: current } };
      },
      SEND_BUDGET_MS,
      ctl?.signal,
      (msg) => {
        const id = (msg as { payload: { batchId: string } }).payload.batchId;
        if (current === id) current = null;
        cancelBatches([id]);
      },
    )) as {
      ok?: boolean;
      data?: TranslateResponse;
      error?: string;
      category?: FailureCategory;
      invalidated?: boolean;
      aborted?: boolean;
    };

    if (resp?.ok === true && resp.data) {
      return { ok: true, data: resp.data };
    }
    return {
      ok: false,
      error: resp?.error ?? '未知错误',
      invalidated: resp?.invalidated ?? false,
      // #263: 类型化字段原样透传，缺省按瞬时处理；不再转述 retryable
      category: resp?.category ?? 'transient',
      aborted: resp?.aborted ?? false,
    };
  } catch (e) {
    if (e instanceof SendAbortedError) {
      return { ok: false, error: e.message, invalidated: false, category: 'aborted', aborted: true };
    }
    // #116: 上下文失效以类型化标志透出，调用方无需匹配文案
    const contextInvalidated = e instanceof ContextInvalidatedError;
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      invalidated: contextInvalidated,
      category: 'transient',
      aborted: false,
      ...(contextInvalidated && { contextInvalidated: true }),
    };
  } finally {
    current = null;
    ctl?.signal?.removeEventListener('abort', onAbort);
  }
}
