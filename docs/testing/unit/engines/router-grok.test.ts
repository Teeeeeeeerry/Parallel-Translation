/**
 * Grok 引擎（#613）—— 切入点是 route()：真实 router + 真实引擎，stub fetch
 * 与权限查询。断言请求（端点、Bearer key、模型名、术语段）、编号译文回填、
 * 失败类别（401/403 → key 无效且原因带授权提示；429 → 配额；5xx → 切到下一
 * 个引擎）与缺权限时的回退。
 */
import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { Domain } from '~/src/storage/domains';

const settings = vi.hoisted(() => ({
  enginePriority: ['grok'] as string[],
  useCache: false,
  maxConcurrency: 6,
  models: {} as Record<string, string>,
  mtApplyTermTargets: false,
}));

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => settings),
}));

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(async (engine: string) => `key-${engine}`),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getCachedEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';
import { resetStorage } from '~/docs/testing/setup';

const GROK = 'https://api.x.ai/v1/chat/completions';

const chatResp = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;
const contains = chrome.permissions.contains as unknown as Mock<
  (p: chrome.permissions.Permissions) => Promise<boolean>
>;

/** Grok 端点按 handler 应答；OpenAI 端点（作下一个引擎）回显“[O]”译文。 */
function stubFetch(grok: (init: RequestInit) => Response): void {
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url === GROK) return grok(init);
    if (url.startsWith('https://api.openai.com/')) return chatResp('1. [O]');
    throw new Error(`unexpected fetch ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const grokCalls = () => fetchMock.mock.calls.filter(([url]) => url === GROK);

function body(call: unknown[]): { model: string; messages: Array<{ content: string }> } {
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  resetStorage();
  settings.enginePriority = ['grok'];
  settings.models = {};
  domains = [];
  contains.mockClear();
  contains.mockResolvedValue(true);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  contains.mockResolvedValue(true);
});

describe('Grok 翻译请求（#613）', () => {
  test('请求发到 xAI 端点，带 Bearer key 与默认模型，编号译文回填', async () => {
    stubFetch(() => chatResp('1. 你好\n2. 世界'));
    const resp = await route({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    const [call] = grokCalls();
    const init = call![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-grok');
    expect(body(call!).model).toBe('grok-4.20-0309-non-reasoning');
    expect(body(call!).messages[0]!.content).toContain('1. Hello\n2. World');
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.x.ai/*'] });
  });

  test('设置里改了模型名 → 请求用自定义模型', async () => {
    settings.models = { grok: 'grok-4.3' };
    stubFetch(() => chatResp('1. 你好'));
    await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(body(grokCalls()[0]!).model).toBe('grok-4.3');
  });

  test('命中的术语写进请求', async () => {
    domains = [
      {
        id: 'd1',
        name: 'K8s',
        targetLang: 'zh-CN',
        sites: [],
        origin: 'user',
        terms: [
          { source: 'Pod', target: '容器组' },
          { source: 'kubectl', noTranslate: true },
        ],
      },
    ];
    stubFetch(() => chatResp('1. 用 kubectl 删除容器组'));
    await route({ texts: ['Delete the Pod with kubectl'], from: 'en', to: 'zh-CN', domainId: 'd1' });

    const prompt = body(grokCalls()[0]!).messages[0]!.content;
    expect(prompt).toContain('Pod → 容器组');
    expect(prompt).toContain('kubectl → “不翻译”');
  });
});

describe('Grok 失败分类（#613）', () => {
  test('401、403 → key 无效，原因带上到 xAI 控制台授权的提示', async () => {
    settings.enginePriority = ['grok', 'openai'];
    for (const status of [401, 403]) {
      stubFetch(() => new Response('{"error":"unauthorized"}', { status }));
      const err = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' }).catch((e) => e);
      expect(err).toMatchObject({ engineId: 'grok', category: 'invalid-key', retryable: false });
      // 测试环境的 getMessage 返回键名：原因取自 xAI 授权提示这条文案
      expect(err.message).toBe('grokKeyInvalid');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('429 → 配额，不重试，也不切到下一个引擎', async () => {
    settings.enginePriority = ['grok', 'openai'];
    stubFetch(() => new Response('rate limited', { status: 429 }));
    await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      engineId: 'grok',
      category: 'quota',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('5xx → 瞬时，按优先级切到下一个引擎', async () => {
    settings.enginePriority = ['grok', 'openai'];
    stubFetch(() => new Response('busy', { status: 503 }));
    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['[O]']);
    expect(grokCalls()).toHaveLength(1);
  });

  test('缺 api.x.ai 的访问权限 → 不发请求，切到下一个引擎', async () => {
    settings.enginePriority = ['grok', 'openai'];
    contains.mockResolvedValue(false);
    stubFetch(() => chatResp('1. [G]'));
    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['[O]']);
    expect(grokCalls()).toHaveLength(0);
  });
});
