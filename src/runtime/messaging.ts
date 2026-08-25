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

import type {
  TranslateRequest,
  TranslateResponse,
  FailureCategory,
} from '~/src/engines/types';
import { sleep } from '~/src/runtime/sleep';

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
    };

/** SW 就绪等待预算（ping 阶段）。覆盖 CI 中 SW 冷启动的常见耗时。 */
const READY_BUDGET_MS = 10_000;
/**
 * 翻译消息总预算（含重试）。须 ≥ MESSAGE_TIMEOUT_MS 让单次完整
 * 引擎往返（30s fetch 超时 + SW 开销）能在预算内完成。
 */
const SEND_BUDGET_MS = 45_000;
/** 单次 sendMessage 响应级超时 —— 与引擎 fetch 超时对齐（#154）。 */
const MESSAGE_TIMEOUT_MS = 30_000;
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

/**
 * 有界重试发送：只要收不到任何响应（undefined / 连接被拒 / 超时），
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
    // 上下文失效不可恢复：立即失败并提示刷新页面，不空等重试预算
    if (isContextInvalidated()) {
      throw new ContextInvalidatedError();
    }

    // 单次最长等待 = 剩余预算与响应级超时的较小者（#154）
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.min(remaining, MESSAGE_TIMEOUT_MS);

    let resp: unknown;
    try {
      resp = await withTimeout(
        chrome.runtime.sendMessage(msg),
        attemptTimeout,
      );
    } catch (e) {
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
    // #116: 上下文失效以类型化标志透出，调用方无需匹配文案
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      invalidated: e instanceof ContextInvalidatedError,
      category: 'transient',
      aborted: false,
    };
  }
}
