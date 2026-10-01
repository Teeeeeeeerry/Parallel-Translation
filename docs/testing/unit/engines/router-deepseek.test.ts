/**
 * DeepSeek 引擎（#609）—— 切入点是 route()：真实 router + 真实引擎，
 * 只 stub fetch。断言请求（端点、Bearer key、模型名、术语段）、编号译文
 * 回填、失败类别（401 → key 无效；402 / 429 → 配额且不重试；5xx → 瞬时并
 * 切到下一个引擎）与缓存的模型维度。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';

const settings = vi.hoisted(() => ({
  enginePriority: ['deepseek'] as string[],
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

const DEEPSEEK = 'https://api.deepseek.com/chat/completions';

const chatResp = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

/** DeepSeek 端点按 handler 应答；OpenAI 端点（作下一个引擎）回显“[O]”译文。 */
function stubFetch(deepseek: (init: RequestInit) => Response): void {
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url === DEEPSEEK) return deepseek(init);
    if (url.startsWith('https://api.openai.com/')) return chatResp('1. [O]');
    throw new Error(`unexpected fetch ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const deepseekCalls = () => fetchMock.mock.calls.filter(([url]) => url === DEEPSEEK);

function body(call: unknown[]): { model: string; messages: Array<{ content: string }> } {
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  resetStorage();
  settings.enginePriority = ['deepseek'];
  settings.useCache = false;
  settings.models = {};
  domains = [];
});

// 只还原 fetch —— vi.unstubAllGlobals 会连 setup 里 stub 的 chrome 一起撤掉
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('DeepSeek 翻译请求（#609）', () => {
  test('请求发到 DeepSeek 端点，带 Bearer key 与默认模型，编号译文回填', async () => {
    stubFetch(() => chatResp('1. 你好\n2. 世界'));
    const resp = await route({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['你好', '世界']);
    const [call] = deepseekCalls();
    const init = call![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-deepseek');
    expect(body(call!).model).toBe('deepseek-flash');
    expect(body(call!).messages[0]!.content).toContain('1. Hello\n2. World');
  });

  test('设置里改了模型名 → 请求用自定义模型', async () => {
    settings.models = { deepseek: 'deepseek-pro' };
    stubFetch(() => chatResp('1. 你好'));
    await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(body(deepseekCalls()[0]!).model).toBe('deepseek-pro');
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

    const prompt = body(deepseekCalls()[0]!).messages[0]!.content;
    expect(prompt).toContain('Pod → 容器组');
    expect(prompt).toContain('kubectl → “不翻译”');
  });
});

describe('DeepSeek 失败分类（#609）', () => {
  test('401 → key 无效，不切到下一个引擎', async () => {
    settings.enginePriority = ['deepseek', 'openai'];
    stubFetch(() => new Response('unauthorized', { status: 401 }));
    await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      engineId: 'deepseek',
      category: 'invalid-key',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('402 余额不足、429 → 配额，不重试，也不切到下一个引擎', async () => {
    settings.enginePriority = ['deepseek', 'openai'];
    for (const status of [402, 429]) {
      stubFetch(() => new Response('{"error":{"message":"Insufficient Balance"}}', { status }));
      await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
        engineId: 'deepseek',
        category: 'quota',
        retryable: false,
        invalidated: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('5xx → 瞬时，按优先级切到下一个引擎', async () => {
    settings.enginePriority = ['deepseek', 'openai'];
    stubFetch(() => new Response('busy', { status: 503 }));
    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['[O]']);
    expect(deepseekCalls()).toHaveLength(1);
  });
});

describe('DeepSeek 缓存的模型维度（#609）', () => {
  test('换模型后不命中旧缓存', async () => {
    settings.useCache = true;
    stubFetch(() => chatResp('1. 旧模型译文'));
    await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    // 同一模型再翻一次：命中缓存，不发请求
    await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(deepseekCalls()).toHaveLength(1);

    settings.models = { deepseek: 'deepseek-pro' };
    stubFetch(() => chatResp('1. 新模型译文'));
    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['新模型译文']);
    expect(deepseekCalls()).toHaveLength(1);
  });
});
