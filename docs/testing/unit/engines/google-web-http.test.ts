/**
 * engines/google-web.ts — 真实 HTTP 路径单元测试（#135）
 *
 * 用 fetch stub 断言：请求 URL / query 参数、分句响应解析、
 * 非 200 / 坏 JSON 降级、部分失败槽位、并发闸门。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const G_API = 'https://translate.googleapis.com/translate_a/single';

function okResponse(segments: unknown[][]): Response {
  return new Response(JSON.stringify([segments, null, 'en']), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('google-web HTTP 路径', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('成功：URL 参数正确 + 分句拼接为整段译文', async () => {
    const byQ: Record<string, string> = { Hello: '你好', World: '世界' };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const q = new URL(String(url)).searchParams.get('q');
      return Promise.resolve(okResponse([[byQ[q!] ?? q!, '', null, null, 1]]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({
      texts: ['Hello', 'World'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好', '世界']);
    expect(resp.failedIndices).toBeUndefined();

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${url.origin}${url.pathname}`).toBe(G_API);
    expect(url.searchParams.get('client')).toBe('gtx');
    expect(url.searchParams.get('sl')).toBe('auto');
    expect(url.searchParams.get('tl')).toBe('zh-CN');
    expect(url.searchParams.get('dt')).toBe('t');
    expect(url.searchParams.get('strip')).toBe('1');
    expect(url.searchParams.get('nonced')).toBe('1');
    expect(url.searchParams.get('q')).toBe('Hello');
  });

  test('批量：每个文本一个请求，q 参数一一对应', async () => {
    const bodies = ['甲', '乙', '丙'];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const q = new URL(String(url)).searchParams.get('q');
      return Promise.resolve(okResponse([[`${q}→${bodies.shift()}`]]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({
      texts: ['a', 'b', 'c'],
      from: 'en',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['a→甲', 'b→乙', 'c→丙']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const qs = fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q'));
    expect(qs).toEqual(['a', 'b', 'c']);
  });

  test('空分句项被忽略，不产生空译文', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([['有效', '', null, null, 1], [], [null, '', null, null, 1]]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({ texts: ['x'], from: 'auto', to: 'zh' });
    expect(resp.translations).toEqual(['有效']);
  });

  test('非 200 → 全部失败抛 EngineError（retryable）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 503 })));
    const { googleWeb } = await import('~/src/engines/google-web');
    await expect(
      googleWeb.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ name: 'EngineError', engineId: 'google-web', retryable: true, category: 'transient' });
  });

  test('坏 JSON → 全部失败抛 EngineError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    const { googleWeb } = await import('~/src/engines/google-web');
    await expect(
      googleWeb.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ name: 'EngineError', retryable: true, category: 'transient' });
  });

  test('部分失败：失败槽位进 failedIndices，成功槽位保留', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([['你好']]))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({ texts: ['Hello', 'Boom'], from: 'auto', to: 'zh-CN' });
    expect(resp.translations).toEqual(['你好', '']);
    expect(resp.failedIndices).toEqual([1]);
  });

  test('全部失败（含混合原因）→ 抛 EngineError 让 router 切换', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    await expect(
      googleWeb.translate({ texts: ['a', 'b'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, category: 'transient', message: '全部 2 条翻译失败' });
  });

  test('并发闸门：maxConcurrency 生效（设置读取于首次翻译）', async () => {
    const { getSettings } = await import('~/src/storage/settings');
    vi.mocked(getSettings).mockReturnValue({ maxConcurrency: 2 } as never);

    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return okResponse([['t']]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({
      texts: ['1', '2', '3', '4', '5'],
      from: 'auto',
      to: 'zh',
    });

    expect(resp.translations).toEqual(['t', 't', 't', 't', 't']);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('fetch 永不 settle → 30s 超时，全部失败抛 EngineError 让 router 降级（#154）', async () => {
    vi.useFakeTimers();
    // 网络黑洞：mock 的 fetch 永不 settle —— 修复前整批 route() 永不返回
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { googleWeb } = await import('~/src/engines/google-web');
    const pending = googleWeb.translate({
      texts: ['a', 'b'],
      from: 'auto',
      to: 'zh',
    });
    // 先挂兜底 handler：fake timer tick 内 reject 会被 Node 记为未处理
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).rejects.toMatchObject({
      name: 'EngineError',
      engineId: 'google-web',
      retryable: true,
      message: '全部 2 条翻译失败',
    });
  });
});
