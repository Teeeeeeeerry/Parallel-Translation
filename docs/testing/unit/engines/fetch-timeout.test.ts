/**
 * engines/fetch-timeout.ts — 引擎 fetch 超时层 单元测试（#154）
 *
 * Chrome fetch 无默认超时，网络黑洞时连接可挂数分钟。断言：
 * 永不 settle 的 fetch 在有界时间内抛 retryable EngineError；
 * 正常路径透传 init 并挂 AbortSignal。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
  test('fetch 永不 settle → 30s 超时抛 EngineError（retryable）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { fetchWithTimeout, FETCH_TIMEOUT_MS } = await import(
      '~/src/engines/fetch-timeout'
    );
    const pending = fetchWithTimeout('google-web', 'https://example.com');
    // 先挂兜底 handler：fake timer tick 内 reject 会被 Node 记为未处理
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({
      name: 'EngineError',
      engineId: 'google-web',
      retryable: true,
      message: expect.stringContaining('请求超时'),
    });
  });

  test('超时后 abort 在飞 fetch（信号已挂）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithTimeout, FETCH_TIMEOUT_MS } = await import(
      '~/src/engines/fetch-timeout'
    );
    const pending = fetchWithTimeout('bing-edge', 'https://example.com');
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({ retryable: true });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(true);
  });

  test('正常响应：透传 init 并返回 Response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchWithTimeout } = await import('~/src/engines/fetch-timeout');
    const resp = await fetchWithTimeout('deepl', 'https://example.com', {
      method: 'POST',
    });

    expect(await resp.text()).toBe('ok');
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).toBe('https://example.com');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
