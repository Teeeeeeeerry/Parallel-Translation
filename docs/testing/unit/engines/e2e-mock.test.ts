/**
 * engines/e2e-mock.ts — mock 包裹层单元测试（#135）
 *
 * 验证：描述符安装 / 幂等包裹、各类故障模式（failOnce / fail /
 * failTexts）、echoTargetLang、delayMs、非 Google URL 透传、
 * storage 自愈路径（ensureE2EMock）、DeepL 端点替身（#723）、
 * Bing 与对话式引擎的端点替身、替身层的请求记录（#766）。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const G_URL =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh&q=Hello';
const OTHER_URL = 'https://example.com/x';

/** 本地 storage 替代实现（setup 的 set 不回调，applyE2EMock 会挂起） */
function installStorageStub(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  const area = chrome.storage.local as unknown as {
    get: (keys: string) => Promise<Record<string, unknown>>;
    set: (
      items: Record<string, unknown>,
      cb?: () => void,
    ) => Promise<void>;
  };
  area.get = vi.fn((keys: string) => Promise.resolve({ [keys]: store.get(keys) }));
  area.set = vi.fn((items: Record<string, unknown>, cb?: () => void) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
    cb?.();
    return Promise.resolve();
  });
  return store;
}

describe('e2e-mock', () => {
  let realFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installStorageStub();
    realFetch = vi.fn().mockResolvedValue(new Response('real', { status: 200 }));
    (self as unknown as { fetch: unknown }).fetch = realFetch;
  });

  afterEach(() => {
    // 注意：不能用 vi.unstubAllGlobals() —— 会连 setup.ts stub 的 chrome 一起清掉
    delete (self as unknown as { fetch?: unknown }).fetch;
  });

  test('未配置 mock → ensureE2EMock 不安装包裹层，请求透传', async () => {
    const { ensureE2EMock } = await import('~/src/engines/e2e-mock');
    await ensureE2EMock();
    const resp = await fetch(G_URL);
    expect(resp.status).toBe(200);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  test('applyE2EMock → Google URL 命中 mock，其他 URL 透传', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ prefix: '【译】' });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【译】Hello');
    expect(realFetch).not.toHaveBeenCalled();

    await fetch(OTHER_URL);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  test('failOnce：首次 500，之后自动恢复', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ failOnce: true });

    const r1 = await fetch(G_URL);
    expect(r1.status).toBe(500);
    const r2 = await fetch(G_URL);
    expect(r2.status).toBe(200);
    expect(getE2EMockStats().failOnceServed).toBe(1);
  });

  test('fail：全部请求 500，计数可断言', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ fail: true });

    const r1 = await fetch(G_URL);
    const r2 = await fetch(G_URL);
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(500);
    expect(getE2EMockStats().failServed).toBe(2);
  });

  test('failTexts：命中文本 500，其余正常', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ failTexts: ['Hello'] });

    const bad = await fetch(G_URL);
    expect(bad.status).toBe(500);
    const ok = await fetch(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh&q=World',
    );
    expect(ok.status).toBe(200);
    expect(getE2EMockStats().failTextsServed).toBe(1);
  });

  test('echoTargetLang：响应带 [tl=] 标记', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ echoTargetLang: true });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【译】Hello [tl=zh]');
  });

  test('keepCjk：不含拉丁字母的文本原样还回来，含拉丁字母的照常加前缀（#796）', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ keepCjk: true });

    const zh = await (await fetch(`${G_URL.split('?')[0]}?tl=zh-CN&q=${encodeURIComponent('回收站')}`)).json();
    expect(zh[0][0][0]).toBe('回收站');
    const en = await (await fetch(G_URL)).json();
    expect(en[0][0][0]).toBe('【译】Hello');
  });

  test('delayMs：响应延迟生效', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ delayMs: 60 });

    const t0 = Date.now();
    await fetch(G_URL);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  test('重复安装幂等：包裹层不叠加', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ prefix: 'A' });
    await applyE2EMock({ prefix: 'B' });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('BHello');
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('ensureE2EMock：从 storage 读取描述符并安装（SW 自愈路径）', async () => {
    const { ensureE2EMock, applyE2EMock } = await import('~/src/engines/e2e-mock');
    // 模拟 fixture 已把描述符写入 storage
    await applyE2EMock({ prefix: '【存】' });
    // 模拟 SW 实例被替换：fetch 还原为真实 fetch，activeCfg 丢失
    delete (self as unknown as { fetch?: unknown }).fetch;
    (self as unknown as { fetch: unknown }).fetch = realFetch;

    await ensureE2EMock();
    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【存】Hello');
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('deepl：DeepL 端点命中替身，译文带目标语言、报告检测语言（#723）', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ deepl: { detectedSourceLanguage: 'JA' } });

    const resp = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      body: new URLSearchParams([['text', '你好'], ['text', '世界'], ['target_lang', 'EN-US']]).toString(),
    });
    expect(await resp.json()).toEqual({
      translations: [
        { text: '[DL:EN-US] 你好', detected_source_language: 'JA' },
        { text: '[DL:EN-US] 世界', detected_source_language: 'JA' },
      ],
    });
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('deepl：SW 实例被替换后，下一次 ensureE2EMock 从 storage 恢复 DeepL 替身（#723）', async () => {
    const { ensureE2EMock, applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ deepl: { detectedSourceLanguage: 'JA' } });
    // 模拟 SW 实例被替换：fetch 还原为真实 fetch
    delete (self as unknown as { fetch?: unknown }).fetch;
    (self as unknown as { fetch: unknown }).fetch = realFetch;

    await ensureE2EMock();
    const resp = await fetch('https://api.deepl.com/v2/translate', {
      method: 'POST',
      body: new URLSearchParams([['text', 'Hi'], ['target_lang', 'ZH']]).toString(),
    });
    expect((await resp.json()).translations[0].text).toBe('[DL:ZH] Hi');
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('bing：鉴权端点给出令牌，翻译端点按前缀回显，计数可断言（#766）', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ bing: { prefix: '[BING] ' } });
    const before = getE2EMockStats().bingServed;

    const auth = await fetch('https://edge.microsoft.com/translate/auth');
    expect(await auth.text()).toBe('mock-jwt-token');
    const resp = await fetch(
      'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans',
      { method: 'POST', body: JSON.stringify([{ Text: 'Hello' }, { Text: 'World' }]) },
    );
    expect(await resp.json()).toEqual([
      { translations: [{ text: '[BING] Hello' }] },
      { translations: [{ text: '[BING] World' }] },
    ]);
    expect(getE2EMockStats().bingServed - before).toBe(1);
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('bing：SW 实例被替换后，下一次 ensureE2EMock 从 storage 恢复 Bing 替身（#766）', async () => {
    const { ensureE2EMock, applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ bing: { prefix: '[BING] ' } });
    delete (self as unknown as { fetch?: unknown }).fetch;
    (self as unknown as { fetch: unknown }).fetch = realFetch;

    await ensureE2EMock();
    const resp = await fetch('https://api-edge.cognitive.microsofttranslator.com/translate', {
      method: 'POST',
      body: JSON.stringify([{ Text: 'Hi' }]),
    });
    expect((await resp.json())[0].translations[0].text).toBe('[BING] Hi');
    expect(realFetch).not.toHaveBeenCalled();
  });

  describe('chat：OpenAI 兼容的对话式端点（#766）', () => {
    const CHAT = 'https://api.deepseek.com/chat/completions';
    const ask = (lines: string[], url = CHAT) =>
      fetch(url, {
        method: 'POST',
        body: JSON.stringify({ messages: [{ content: ['Translate:', ...lines].join('\n') }] }),
      });
    const content = async (r: Response) => (await r.json()).choices[0].message.content as string;

    test('按请求的编号行回显，译文加前缀，非编号行不回显；计数按端点', async () => {
      const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
      await applyE2EMock({ chat: { [CHAT]: { prefix: '[DS] ' } } });
      const before = getE2EMockStats().chatServed[CHAT] ?? 0;

      expect(await content(await ask(['1. Hello', '2. World']))).toBe('1. [DS] Hello\n2. [DS] World');
      expect((getE2EMockStats().chatServed[CHAT] ?? 0) - before).toBe(1);
      expect(realFetch).not.toHaveBeenCalled();
      // 没登记的端点照常透传
      await ask(['1. Hello'], 'https://api.x.ai/v1/chat/completions');
      expect(realFetch).toHaveBeenCalledTimes(1);
    });

    test('dropText：含该文本的编号行不回显（模拟 LLM 漏行），其余编号不变', async () => {
      const { applyE2EMock } = await import('~/src/engines/e2e-mock');
      await applyE2EMock({ chat: { [CHAT]: { dropText: 'P two' } } });

      expect(await content(await ask(['1. P one', '2. P two', '3. P three']))).toBe('1. P one\n3. P three');
    });

    test('status：按给定状态码失败，照样计数', async () => {
      const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
      await applyE2EMock({ chat: { [CHAT]: { status: 401 } } });
      const before = getE2EMockStats().chatServed[CHAT] ?? 0;

      expect((await ask(['1. Hello'])).status).toBe(401);
      expect((getE2EMockStats().chatServed[CHAT] ?? 0) - before).toBe(1);
    });

    test('SW 实例被替换后，下一次 ensureE2EMock 从 storage 恢复对话式端点替身', async () => {
      const { ensureE2EMock, applyE2EMock } = await import('~/src/engines/e2e-mock');
      await applyE2EMock({ chat: { [CHAT]: { prefix: '[DS] ' } } });
      delete (self as unknown as { fetch?: unknown }).fetch;
      (self as unknown as { fetch: unknown }).fetch = realFetch;

      await ensureE2EMock();
      expect(await content(await ask(['1. Hi']))).toBe('1. [DS] Hi');
      expect(realFetch).not.toHaveBeenCalled();
    });
  });

  test('请求记录：发给 Google 的原文按顺序记在替身层，失败的请求也记（#766）', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ failTexts: ['Boom'] });
    const before = getE2EMockStats().queries.length;

    await fetch(G_URL);
    await fetch(`${G_URL.split('&q=')[0]}&q=Boom`);
    expect(getE2EMockStats().queries.slice(before)).toEqual(['Hello', 'Boom']);
  });
});
