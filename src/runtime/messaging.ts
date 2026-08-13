// content → background 消息通道健壮层。
//
// #89：Chrome MV3 的 service worker 在 headless/冷启动场景下，
// onMessage 监听器未必已注册 —— content script 此时发出的
// chrome.runtime.sendMessage 要么解析为 undefined（无监听器），
// 要么 reject "Could not establish connection. Receiving end does not exist."。
// 直接当作最终失败会让整页翻译静默失败（[data-pt="done"] 永不出现）。
//
// translateViaBackground 是 content script 三个翻译入口共用的通道：
// 1. 先 ping（pt:ping）确认 SW 消息通道就绪，有界重试
// 2. 再发 pt:translate；传输层失败（无响应/连接被拒）有界重试
// 3. SW 已响应的 {ok:false} 是引擎级失败（router 已做过引擎降级），不重试
// 4. 预算耗尽返回 {ok:false} + 错误说明，永不抛出 —— 调用方按原约定处理

import type { TranslateRequest, TranslateResponse } from '~/src/engines/types';

export type TranslateResult =
  | { ok: true; data: TranslateResponse }
  | { ok: false; error: string };

/** SW 就绪等待预算（ping 阶段）。覆盖 CI 中 SW 冷启动的常见耗时。 */
const READY_BUDGET_MS = 10_000;
/** 翻译消息传输层重试预算。 */
const SEND_BUDGET_MS = 15_000;
/** 退避起点（毫秒），每次翻倍，上限 2s。 */
const BACKOFF_INITIAL_MS = 250;
const BACKOFF_MAX_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 有界重试发送：只要收不到任何响应（undefined / 连接被拒），
 * 就以指数退避重发，直到预算耗尽。收到响应（无论内容）即返回。
 * 预算耗尽时抛出最后一次失败原因。
 */
async function sendWithTransportRetry(
  msg: unknown,
  budgetMs: number,
): Promise<unknown> {
  const deadline = Date.now() + budgetMs;
  let delay = BACKOFF_INITIAL_MS;
  let lastError = 'background 无响应';

  for (;;) {
    let resp: unknown;
    try {
      resp = await chrome.runtime.sendMessage(msg);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      resp = undefined;
    }
    if (resp !== undefined) return resp;
    if (Date.now() >= deadline) break;
    await sleep(delay);
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
): Promise<TranslateResult> {
  try {
    // 1) SW 就绪等待：任何 ping 响应都证明消息通道已注册监听器。
    await sendWithTransportRetry({ type: 'pt:ping' }, READY_BUDGET_MS);

    // 2) 发送翻译消息，传输层失败重试。
    const resp = (await sendWithTransportRetry(
      { type: 'pt:translate', payload },
      SEND_BUDGET_MS,
    )) as { ok?: boolean; data?: TranslateResponse; error?: string };

    if (resp?.ok === true && resp.data) {
      return { ok: true, data: resp.data };
    }
    return { ok: false, error: resp?.error ?? '未知错误' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
