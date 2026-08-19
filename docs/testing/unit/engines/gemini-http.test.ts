/**
 * engines/gemini.ts — 真实 HTTP 路径单元测试（#135）
 *
 * fetch stub 断言：端点 / 请求头 / 请求体、编号 prompt、
 * 400/403 key 无效、非 200 降级、响应解析。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: { gemini: 'gemini-2.5-flash' } })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

const okResp = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('gemini HTTP 路径', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  test('未配置 key → EngineError（retryable=false）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue(undefined);
    const { gemini } = await import('~/src/engines/gemini');
    await expect(
      gemini.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ engineId: 'gemini', retryable: false, message: '未配置 API key' });
    expect(getKey).toHaveBeenCalledWith('gemini');
  });

  test('成功：端点 / 头 / 体断言 + 编号解析', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('test-key');
    const fetchMock = vi.fn().mockResolvedValue(okResp('1. 你好\n2. 世界'));
    vi.stubGlobal('fetch', fetchMock);

    const { gemini } = await import('~/src/engines/gemini');
    const resp = await gemini.translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'test-key',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain('1. Hello');
    expect(body.contents[0].parts[0].text).toContain('2. World');
    expect(body.contents[0].parts[0].text).toContain('源语言：en');
    expect(body.generationConfig).toEqual({ temperature: 0 });
  });

  test('from=auto → prompt 不带源语言', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    const fetchMock = vi.fn().mockResolvedValue(okResp('1. 你好'));
    vi.stubGlobal('fetch', fetchMock);

    const { gemini } = await import('~/src/engines/gemini');
    await gemini.translate({ texts: ['Hello'], from: 'auto', to: 'zh' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).not.toContain('源语言');
  });

  test('pre 多行文本换行被归一化，不撑破编号结构（#160）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    const fetchMock = vi.fn().mockResolvedValue(okResp('1. 你好'));
    vi.stubGlobal('fetch', fetchMock);

    const { gemini } = await import('~/src/engines/gemini');
    await gemini.translate({ texts: ['line1\nline2'], from: 'auto', to: 'zh' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toContain('1. line1 line2');
    expect(body.contents[0].parts[0].text).not.toContain('\nline');
  });

  test('400 / 403 → EngineError（retryable=false，key 无效）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 400 })));
    const { gemini } = await import('~/src/engines/gemini');
    await expect(
      gemini.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: false, message: 'API key 无效' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 403 })));
    const { gemini: gemini2 } = await import('~/src/engines/gemini');
    await expect(
      gemini2.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: false, message: 'API key 无效' });
  });

  test('其他非 200 → EngineError（retryable）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 503 })));
    const { gemini } = await import('~/src/engines/gemini');
    await expect(
      gemini.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, message: 'HTTP 503' });
  });

  test('空 candidates → 长度一致的空白译文数组', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    const { gemini } = await import('~/src/engines/gemini');
    const resp = await gemini.translate({ texts: ['a', 'b'], from: 'auto', to: 'zh' });
    expect(resp.translations).toEqual(['', '']);
  });

  test('坏 JSON → 抛错', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 200 })));
    const { gemini } = await import('~/src/engines/gemini');
    await expect(
      gemini.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toThrow();
  });

  test('并发闸门：并发 translate() 调用在飞请求不超过 maxConcurrency（#159）', async () => {
    const { getSettings } = await import('~/src/storage/settings');
    vi.mocked(getSettings).mockReturnValue({ maxConcurrency: 2, models: { gemini: 'gemini-2.5-flash' } } as never);
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

    const { gemini } = await import('~/src/engines/gemini');
    const resps = await Promise.all(
      Array.from({ length: 8 }, () =>
        gemini.translate({ texts: ['Hello'], from: 'en', to: 'zh-CN' }),
      ),
    );

    expect(resps.every((r) => r.translations[0] === '你好')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
