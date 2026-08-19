/**
 * engines/contract.test.ts — 外部 API 契约测试（#181）
 *
 * 与实现细节解耦的契约断言：对外部翻译 API 的「语言码映射」与
 * 「响应形状」按官方文档独立验证 —— 防止 mock 把实现错误固化为
 * 预期（如 #155 前 DeepL 测试断言 target_lang='ZH-CN'，而 DeepL
 * API 实际只接受 ZH-HANS/ZH-HANT，400 静默降级）。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

// ── DeepL 语言码契约（官方文档：v2 API 只认大写码，中文只有 ZH/ZH-HANS/ZH-HANT）──

describe('DeepL 语言码契约', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function bodyFor(to: string, from = 'auto'): Promise<URLSearchParams> {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    const okResp = () =>
      new Response(JSON.stringify({ translations: [{ text: '你好' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal('fetch', fetchMock);
    const { deepl } = await import('~/src/engines/deepl');
    await deepl.translate({ texts: ['Hello'], from, to });
    return new URLSearchParams(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
  }

  test('zh-CN → ZH-HANS（DeepL 不接受带国家后缀中文码）', async () => {
    const body = await bodyFor('zh-CN');
    expect(body.get('target_lang')).toBe('ZH-HANS');
  });

  test('zh-TW → ZH-HANT', async () => {
    const body = await bodyFor('zh-TW');
    expect(body.get('target_lang')).toBe('ZH-HANT');
  });

  test('zh → ZH（无国家后缀直接大写）', async () => {
    const body = await bodyFor('zh');
    expect(body.get('target_lang')).toBe('ZH');
  });

  test('普通码大写化：en-gb → EN-GB、ja → JA', async () => {
    expect((await bodyFor('en-gb')).get('target_lang')).toBe('EN-GB');
    expect((await bodyFor('ja')).get('target_lang')).toBe('JA');
  });

  test('from=auto → 不发送 source_lang', async () => {
    const body = await bodyFor('zh-CN', 'auto');
    expect(body.has('source_lang')).toBe(false);
  });

  test('显式源语言 → source_lang 大写化', async () => {
    const body = await bodyFor('zh-CN', 'en-gb');
    expect(body.get('source_lang')).toBe('EN-GB');
  });
});

// ── 响应形状契约（各引擎官方响应结构）──

describe('响应形状契约', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test('google-web：data[0] 分句数组每项 [0] 为译文，拼接为整段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          [['你好', 'Hello', null, null, 1], ['，世界', 'World', null, null, 1]],
          null,
          'en',
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { googleWeb } = await import('~/src/engines/google-web');
    const resp = await googleWeb.translate({ texts: ['Hello World'], from: 'auto', to: 'zh-CN' });
    // 分句按顺序拼接，不留空格（Google 分句自带标点）
    expect(resp.translations[0]).toBe('你好，世界');
  });

  test('bing-edge：data[i].translations[0].text 为译文，detectedLanguage 可选', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('translate/auth')) {
        return new Response('jwt.payload.sig', { status: 200 });
      }
      return new Response(
        JSON.stringify([
          { translations: [{ text: '你好' }], detectedLanguage: { language: 'en' } },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bingEdge } = await import('~/src/engines/bing-edge');
    const resp = await bingEdge.translate({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['你好']);
    expect(resp.detectedFrom).toBe('en');
  });

  test('openai/gemini：编号输出 "N. text" 按序号回填', async () => {
    const { parseNumbered } = await import('~/src/engines/openai');
    expect(
      parseNumbered('1. 你好\n2. 世界\n3. 再见', 3),
    ).toEqual(['你好', '世界', '再见']);
    // 漏行 → 空字符串占位（长度必须与预期一致，防止错位）
    expect(parseNumbered('1. 你好\n3. 再见', 3)).toEqual(['你好', '', '再见']);
  });
});
