/**
 * engines/openai.ts — 真实 HTTP 路径单元测试（#135）
 *
 * fetch stub 断言：端点 / 授权头 / 请求体、编号 prompt 与换行归一化、
 * 401/403 key 无效、非 200 降级、响应解析。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: { openai: 'gpt-4o' } })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

const okResp = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('openai HTTP 路径', () => {
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
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { FETCH_TIMEOUT_MS } = await import('~/src/engines/fetch-timeout');
    const { openai } = await import('~/src/engines/openai');
    const pending = openai.translate({ texts: ['a'], from: 'en', to: 'zh-CN' });
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    await expect(pending).rejects.toMatchObject({
      name: 'EngineError',
      engineId: 'openai',
      retryable: true,
      message: expect.stringContaining('请求超时'),
    });
  });

  test('未配置 key → EngineError（retryable=false）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue(undefined);
    const { openai } = await import('~/src/engines/openai');
    await expect(
      openai.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({
      engineId: 'openai',
      retryable: false,
      category: 'invalid-key',
      message: '未配置 API key',
    });
    expect(getKey).toHaveBeenCalledWith('openai');
  });

  test('成功：端点 / 头 / 体断言 + 编号解析', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('sk-test');
    const fetchMock = vi.fn().mockResolvedValue(okResp('1. 你好\n2. 世界'));
    vi.stubGlobal('fetch', fetchMock);

    const { openai } = await import('~/src/engines/openai');
    const resp = await openai.translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('1. Hello');
    expect(body.messages[0].content).toContain('2. World');
    expect(body.messages[0].content).toContain('源语言：en');
  });

  test('文本自带换行被归一化，不撑破编号结构', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('sk-test');
    const fetchMock = vi.fn().mockResolvedValue(okResp('1. 你好'));
    vi.stubGlobal('fetch', fetchMock);

    const { openai } = await import('~/src/engines/openai');
    await openai.translate({ texts: ['line1\nline2'], from: 'auto', to: 'zh' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain('1. line1 line2');
    expect(body.messages[0].content).not.toContain('\nline');
  });

  test('401 / 403 → EngineError（retryable=false，key 无效）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('bad');
    for (const status of [401, 403]) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status })));
      const { openai } = await import('~/src/engines/openai');
      await expect(
        openai.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
      ).rejects.toMatchObject({ retryable: false, category: 'invalid-key', message: 'API key 无效' });
    }
  });

  test('其他非 200 → EngineError（retryable，transient）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 429 })));
    const { openai } = await import('~/src/engines/openai');
    await expect(
      openai.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, category: 'transient', message: 'HTTP 429' });
  });

  test('空 choices → 长度一致的空白译文数组', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    const { openai } = await import('~/src/engines/openai');
    const resp = await openai.translate({ texts: ['a', 'b'], from: 'auto', to: 'zh' });
    expect(resp.translations).toEqual(['', '']);
  });

  test('坏 JSON → 抛错', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 200 })));
    const { openai } = await import('~/src/engines/openai');
    await expect(
      openai.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toThrow();
  });

  test('并发闸门：并发 translate() 调用在飞请求不超过 maxConcurrency（#159）', async () => {
    const { getSettings } = await import('~/src/storage/settings');
    vi.mocked(getSettings).mockReturnValue({ maxConcurrency: 2, models: { openai: 'gpt-4o' } } as never);
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');

    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return okResp('1. 你好');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { openai } = await import('~/src/engines/openai');
    const resps = await Promise.all(
      Array.from({ length: 8 }, () =>
        openai.translate({ texts: ['Hello'], from: 'en', to: 'zh-CN' }),
      ),
    );

    expect(resps.every((r) => r.translations[0] === '你好')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
