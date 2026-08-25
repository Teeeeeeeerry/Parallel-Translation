/**
 * engines/bing-edge.ts — 真实 HTTP 路径单元测试（#135）
 *
 * fetch stub 断言：JWT 获取与缓存 / 过期重取 / 401 清缓存、
 * 翻译 POST 的 URL / 头 / 体、响应解析、非 200 降级。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const TRANS_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate';

/** 构造 payload 可控的假 JWT */
function fakeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const futureJwt = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
const expiredJwt = fakeJwt(Math.floor(Date.now() / 1000) - 3600);

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

/** 按调用序号编排响应的 fetch stub（每次调用返回全新 Response，避免 body 复用） */
function scriptedFetch(
  script: Array<(call: number, url: string) => Response>,
): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn().mockImplementation(async (url: string) => {
    const handler = script[Math.min(n, script.length - 1)]!;
    n++;
    return handler(n, String(url));
  });
}

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
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      // auth 请求返回 JWT，翻译请求返回译文（URL 分流）
      return String(url) === AUTH_URL
        ? new Response(futureJwt, { status: 200 })
        : okTrans(['你好']);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    const resps = await Promise.all(
      Array.from({ length: 8 }, () =>
        bingEdge.translate({ texts: ['Hello'], from: 'en', to: 'zh-CN' }),
      ),
    );

    // 全部成功（JWT 首取后缓存 → 1 次 auth + 8 次翻译 POST）
    expect(resps.every((r) => r.translations[0] === '你好')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('成功：先取 JWT，再 POST 翻译（URL / 头 / 体断言）', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['你好', '世界'], 'en'),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    const resp = await bingEdge.translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    expect(resp.detectedFrom).toBe('en');

    // auth 请求：GET 无头
    expect(String(fetchMock.mock.calls[0]![0])).toBe(AUTH_URL);
    // 翻译请求
    const [transUrl, transInit] = fetchMock.mock.calls[1]!;
    const url = new URL(String(transUrl));
    expect(`${url.origin}${url.pathname}`).toBe(TRANS_URL);
    expect(url.searchParams.get('from')).toBe('en');
    expect(url.searchParams.get('to')).toBe('zh-CN');
    expect(url.searchParams.get('api-version')).toBe('3.0');
    expect(url.searchParams.get('textType')).toBe('html');
    expect((transInit as RequestInit).method).toBe('POST');
    expect((transInit as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${futureJwt}`,
    });
    expect(JSON.parse((transInit as RequestInit).body as string)).toEqual([
      { Text: 'Hello' },
      { Text: 'World' },
    ]);
  });

  test('from=auto → from 参数为空字符串', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['你好']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await bingEdge.translate({ texts: ['Hello'], from: 'auto', to: 'zh' });

    const url = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(url.searchParams.get('from')).toBe('');
    expect(url.searchParams.has('from')).toBe(true);
  });

  test('JWT 缓存：两次翻译只取一次 auth', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['甲']),
      () => okTrans(['乙']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    await bingEdge.translate({ texts: ['b'], from: 'auto', to: 'zh' });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(AUTH_URL);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/translate');
    expect(String(fetchMock.mock.calls[2]![0])).toContain('/translate');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('JWT 过期（服务端下发过期 JWT，缓存后重取）→ 再次翻译重新取 auth', async () => {
    // 首次 getJwt 不做有效期校验（校验只在命中缓存时发生），
    // 过期 JWT 靠翻译 401 兜底。此处直接验证缓存命中过期 JWT → 重取。
    const fetchMock = scriptedFetch([
      () => new Response(expiredJwt, { status: 200 }),
      () => okTrans(['甲']),
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['乙']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    // 第一次：拿到过期 JWT（引擎不校验新取的值），翻译成功
    await bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    // 第二次：缓存命中过期 JWT → isExpired=true → 重新取 auth
    await bingEdge.translate({ texts: ['b'], from: 'auto', to: 'zh' });

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === AUTH_URL);
    expect(authCalls).toHaveLength(2);
  });

  test('服务端返回过期 JWT → 翻译 401 → 清缓存 → 下次重取恢复', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(expiredJwt, { status: 200 }),
      () => new Response('Unauthorized', { status: 401 }),
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['你好']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, category: 'transient', message: 'HTTP 401' });
    const resp = await bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    expect(resp.translations).toEqual(['你好']);

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === AUTH_URL);
    expect(authCalls).toHaveLength(2);
  });

  test('翻译 401 → 清空 JWT 缓存，下次重新取 auth', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => new Response('Unauthorized', { status: 401 }),
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['你好']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ name: 'EngineError', retryable: true, category: 'transient', message: 'HTTP 401' });
    // 缓存已清 → 第二次翻译重新取 auth
    const resp = await bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    expect(resp.translations).toEqual(['你好']);

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === AUTH_URL);
    expect(authCalls).toHaveLength(2);
  });

  test('auth 非 200 → EngineError（retryable）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 500 })));
    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({
      engineId: 'bing-edge',
      retryable: true,
      category: 'transient',
      message: 'auth HTTP 500',
    });
  });

  test('翻译非 200 → EngineError（retryable）', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => new Response('err', { status: 429 }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, category: 'transient', message: 'HTTP 429' });
  });

  test('坏 JSON → 抛错', async () => {
    const fetchMock = scriptedFetch([
      () => new Response(futureJwt, { status: 200 }),
      () => new Response('not json', { status: 200 }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await expect(
      bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toThrow();
  });

  test('坏 JWT 入缓存 → 下次翻译 isExpired 判定过期重取', async () => {
    // 'not-a-jwt' 无法解析 exp → isExpired 走 catch 返回 true（视为过期）
    const fetchMock = scriptedFetch([
      () => new Response('not-a-jwt', { status: 200 }),
      () => okTrans(['甲']),
      () => new Response(futureJwt, { status: 200 }),
      () => okTrans(['乙']),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const { bingEdge } = await import('~/src/engines/bing-edge');
    await bingEdge.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    await bingEdge.translate({ texts: ['b'], from: 'auto', to: 'zh' });

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === AUTH_URL);
    expect(authCalls).toHaveLength(2);
  });
});
