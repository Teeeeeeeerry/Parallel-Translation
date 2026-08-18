// 引擎 fetch 超时层 —— #154。
//
// Chrome fetch 无默认超时，网络黑洞 / 代理中断 / 服务端接受连接但不响应时
// 可挂数分钟（依赖 OS TCP 超时）。各引擎 fetch 统一走 fetchWithTimeout：
// 超时抛 retryable EngineError，router 降级到下一引擎；
// 同时 abort 掉在飞请求，不再空占连接与并发闸门槽位。
//
// 用 setTimeout + AbortController 手动实现而非 AbortSignal.timeout：
// 需 Promise.race 兜住「fetch 永不 settle」的 mock / 极端实现，
// 且 fake timers 可确定性推进，便于单测。

import { EngineError } from './types';

/** 引擎 fetch 超时（毫秒）。 */
export const FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  engineId: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new EngineError(engineId, true, `请求超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
    // race 放弃方（fetch 或 timeout）的后续 settle 由 race 内部消化，无未处理拒绝。
    return await Promise.race([
      fetch(input, { ...init, signal: ctrl.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
