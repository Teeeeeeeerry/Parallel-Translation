/**
 * engines/bing-edge.ts — 真实 HTTP 路径单元测试（#135、#1021）
 *
 * fetch stub 断言：一次 POST 直接拿译文、不取令牌（#1021）；
 * 翻译 POST 的 URL / 头 / 体、响应解析、非 200 降级。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const TRANS_URL = 'https://edge.microsoft.com/translate/translatetext';

const okTrans = (translations: string[], lang?: string) => {
  const rows: Array<Record<string, unknown>> = translations.map((text) => ({
    translations: [{ text }],
  }));
  if (lang) rows[0] = { ...rows[0]!, detectedLanguage: { language: lang } };
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

describe('bing-edge HTTP 路径', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('fetch 永不 settle → 有界超时抛 retryable EngineError（#181/#154）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { FETCH_TIMEOUT_MS } = await import('~/src/engines/fetch-timeout');
    const { bingEdge } = await import('~/src/engines/bing-edge');
    const pending = bingEdge.translate({ texts: ['a'], from: 'en', to: 'zh-CN' });
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({
      name: 'EngineError',
      engineId: 'bing-edge',
      retryable: true,
      message: expect.stringContaining('请求超时'),
    });
  });

  test('并发闸门：并发 translate() 调用在飞请求不超过 maxConcurrency（#159）', async () => {
    const { getSettings } = await import('~/src/storage/settings');
    vi.mocked(getSettings).mockReturnValue({ maxConcurrency: 2 } as never);

    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return okTrans(['你好']);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    const resps = await Promise.all(
      Array.from({ length: 8 }, () =>
        bingEdge.translate({ texts: ['Hello'], from: 'en', to: 'zh-CN' }),
      ),
    );

    expect(resps.every((r) => r.translations[0] === '你好')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('成功：一次 POST 拿译文，不取令牌、不带 Authorization（#1021）', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okTrans(['你好', '世界'], 'en'));
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    const resp = await bingEdge.translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    expect(resp.detectedFrom).toBe('en');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [transUrl, transInit] = fetchMock.mock.calls[0]!;
    const url = new URL(String(transUrl));
    expect(`${url.origin}${url.pathname}`).toBe(TRANS_URL);
    expect(url.searchParams.get('from')).toBe('en');
    expect(url.searchParams.get('to')).toBe('zh-CN');
    expect(url.searchParams.get('isEnterpriseClient')).toBe('false');
    expect((transInit as RequestInit).method).toBe('POST');
    expect((transInit as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' });
    // 请求体是字符串数组：发 v3 的 { Text } 对象，端点直接 400
    expect(JSON.parse((transInit as RequestInit).body as string)).toEqual(['Hello', 'World']);
  });

  test('from=auto → from 参数为空字符串', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okTrans(['你好']));
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await bingEdge.translate({ texts: ['Hello'], from: 'auto', to: 'zh' });

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('from')).toBe('');
    expect(url.searchParams.has('from')).toBe(true);
  });

  test.each([404, 400, 429, 500])('翻译 HTTP %i → EngineError（retryable）', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status })));
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({
      engineId: 'bing-edge',
      retryable: true,
      category: 'transient',
      message: `HTTP ${status}`,
    });
  });

  test('坏 JSON → 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toThrow();
  });

  // #1026：超过单次上限（1000 条或 5 万字）时 translatetext 回 400，正文是纯文本
  // “Request exceeds the maximum allowed translation size.”（2026-10-16 实测）。同样的
  // 请求重发多少次都是 400，判成不可重试的“请求过大”；router 照常换下一个引擎，
  // 别的引擎上限不同
  test('400 请求过大 → 类别 too-large，不按瞬时故障处理（#1026）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Request exceeds the maximum allowed translation size.', {
          status: 400,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      ),
    );
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh-CN' })).rejects.toMatchObject({
      name: 'EngineError',
      engineId: 'bing-edge',
      category: 'too-large',
      retryable: true,
    });
  });

  // 其它 400 不划进去：目标语言非法时同样回 400、正文为空（同日实测），有些 400 是
  // 瞬时的。判据只认“请求过大”这一句
  test.each([
    ['正文为空', ''],
    ['别的说明', 'The request is invalid.'],
  ])('其它 400（%s）→ 仍是瞬时故障，行为不变（#1026）', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 400 })));
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh-CN' })).rejects.toMatchObject({
      category: 'transient',
      retryable: true,
    });
  });

  test('5xx 带同一句说明也不算请求过大：只认 400（#1026）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Request exceeds the maximum allowed translation size.', { status: 503 })),
    );
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh-CN' })).rejects.toMatchObject({
      category: 'transient',
    });
  });
});
