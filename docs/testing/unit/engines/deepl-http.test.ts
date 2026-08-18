/**
 * engines/deepl.ts — 真实 HTTP 路径单元测试（#135）
 *
 * fetch stub 断言：free/pro 端点选择（:fx 后缀）、form 请求体、
 * 401/403 key 无效、非 200 降级、响应解析。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

const okResp = (texts: string[], sourceLang?: string) => {
  const translations = texts.map((text) => ({
    text,
    ...(sourceLang ? { detected_source_language: sourceLang } : {}),
  }));
  return new Response(JSON.stringify({ translations }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

describe('deepl HTTP 路径', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  test('未配置 key → EngineError（retryable=false）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue(undefined);
    const { deepl } = await import('~/src/engines/deepl');
    await expect(
      deepl.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ engineId: 'deepl', retryable: false, message: '未配置 API key' });
    expect(getKey).toHaveBeenCalledWith('deepl');
  });

  test('免费 key（:fx）→ api-free 端点；请求体断言', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('abc:fx');
    const fetchMock = vi.fn().mockResolvedValue(okResp(['你好'], 'EN'));
    vi.stubGlobal('fetch', fetchMock);

    const { deepl } = await import('~/src/engines/deepl');
    const resp = await deepl.translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好']);
    expect(resp.detectedFrom).toBe('EN');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api-free.deepl.com/v2/translate');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'DeepL-Auth-Key abc:fx',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get('target_lang')).toBe('ZH-HANS');
    expect(body.get('source_lang')).toBe('EN');
    expect(body.getAll('text')).toEqual(['Hello', 'World']);
  });

  test('zh-CN → ZH-HANS、zh-TW → ZH-HANT（#155：DeepL 不接受带国家后缀中文码）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    for (const [to, expected] of [
      ['zh-CN', 'ZH-HANS'],
      ['zh-TW', 'ZH-HANT'],
    ] as const) {
      vi.resetModules();
      const fetchMock = vi.fn().mockResolvedValue(okResp(['你好']));
      vi.stubGlobal('fetch', fetchMock);
      const { deepl } = await import('~/src/engines/deepl');
      await deepl.translate({ texts: ['Hello'], from: 'auto', to });
      const body = new URLSearchParams(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.get('target_lang')).toBe(expected);
    }
  });

  test('普通 key → api.deepl.com 端点', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('pro-key');
    const fetchMock = vi.fn().mockResolvedValue(okResp(['你好']));
    vi.stubGlobal('fetch', fetchMock);

    const { deepl } = await import('~/src/engines/deepl');
    await deepl.translate({ texts: ['Hello'], from: 'auto', to: 'zh' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.deepl.com/v2/translate');
  });

  test('from=auto → 不发送 source_lang；语言码大写化', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    const fetchMock = vi.fn().mockResolvedValue(okResp(['你好']));
    vi.stubGlobal('fetch', fetchMock);

    const { deepl } = await import('~/src/engines/deepl');
    await deepl.translate({ texts: ['Hello'], from: 'auto', to: 'en-gb' });
    const body = new URLSearchParams((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.get('target_lang')).toBe('EN-GB');
    expect(body.has('source_lang')).toBe(false);
  });

  test('401 / 403 → EngineError（retryable=false，key 无效）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('bad');
    for (const status of [401, 403]) {
      vi.resetModules();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status })));
      const { deepl } = await import('~/src/engines/deepl');
      await expect(
        deepl.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
      ).rejects.toMatchObject({ retryable: false, message: 'API key 无效' });
    }
  });

  test('其他非 200 → EngineError（retryable）', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 456 })));
    const { deepl } = await import('~/src/engines/deepl');
    await expect(
      deepl.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({ retryable: true, message: 'HTTP 456' });
  });

  test('坏 JSON → 抛错', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 200 })));
    const { deepl } = await import('~/src/engines/deepl');
    await expect(
      deepl.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toThrow();
  });
});
