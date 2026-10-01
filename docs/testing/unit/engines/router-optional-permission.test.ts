/**
 * 走可选权限的引擎缺权限（#610）—— 切入点是 route()：真实 router + 真实
 * 引擎，stub fetch 与权限查询。用户在浏览器扩展管理里撤销了
 * api.deepseek.com 的访问权限后：
 * - 翻译前检查权限，没有就不发请求；
 * - 按不可重试的配置问题失败，原因写明缺权限，按优先级切到下一个引擎；
 * - 没有下一个引擎时，失败结果带上这个原因；
 * - 重新授权后恢复正常；
 * - 端点是必需权限的现有引擎不做检查。
 */
import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

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

vi.mock('~/src/storage/domains', () => ({
  getCachedEffectiveDomains: vi.fn(async () => []),
}));

import { route } from '~/src/engines/router';
import { resetStorage } from '~/docs/testing/setup';

const DEEPSEEK = 'https://api.deepseek.com/chat/completions';
const ORIGIN = 'https://api.deepseek.com/*';

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
const getMessage = vi.mocked(chrome.i18n.getMessage);

beforeEach(() => {
  resetStorage();
  settings.enginePriority = ['deepseek'];
  fetchMock = vi.fn(async (url: string) => {
    if (url === DEEPSEEK) return chatResp('1. [DS]');
    if (url.startsWith('https://api.openai.com/')) return chatResp('1. [O]');
    throw new Error(`unexpected fetch ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  contains.mockClear();
  contains.mockResolvedValue(true);
  // 缺权限的原因按界面语言取文案；这里让文案带上占位符的值，便于断言
  getMessage.mockImplementation(((key: string, subs?: string | string[]) =>
    key === 'enginePermissionMissing'
      ? `no access to ${[subs].flat()[0]}, save the key again in settings`
      : key) as typeof chrome.i18n.getMessage);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  contains.mockResolvedValue(true);
  getMessage.mockImplementation(((key: string) => key) as typeof chrome.i18n.getMessage);
});

const deepseekCalls = () => fetchMock.mock.calls.filter(([url]) => url === DEEPSEEK);

describe('DeepSeek 缺权限（#610）', () => {
  test('权限查询返回未授权 → 不发请求，切到下一个引擎', async () => {
    settings.enginePriority = ['deepseek', 'openai'];
    contains.mockResolvedValue(false);

    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['[O]']);
    expect(deepseekCalls()).toHaveLength(0);
    expect(contains).toHaveBeenCalledWith({ origins: [ORIGIN] });
  });

  test('没有下一个引擎 → 失败结果带上缺权限的原因，不可重试', async () => {
    contains.mockResolvedValue(false);

    await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      engineId: 'deepseek',
      retryable: false,
      category: 'invalid-key',
      message: 'no access to api.deepseek.com, save the key again in settings',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('下一个引擎也失败（瞬时）→ 仍按所有引擎失败处理，可重试', async () => {
    settings.enginePriority = ['deepseek', 'openai'];
    contains.mockResolvedValue(false);
    fetchMock.mockImplementation(async () => new Response('busy', { status: 503 }));

    await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      name: 'AllEnginesFailedError',
      retryable: true,
    });
    expect(deepseekCalls()).toHaveLength(0);
  });

  test('重新授权后恢复正常翻译', async () => {
    contains.mockResolvedValueOnce(false);
    await expect(route({ texts: ['Hello'], from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      category: 'invalid-key',
    });

    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });
    expect(resp.translations).toEqual(['[DS]']);
    expect(deepseekCalls()).toHaveLength(1);
  });

  test('端点是必需权限的现有引擎不查权限', async () => {
    settings.enginePriority = ['openai'];
    contains.mockResolvedValue(false);

    const resp = await route({ texts: ['Hello'], from: 'en', to: 'zh-CN' });

    expect(resp.translations).toEqual(['[O]']);
    expect(contains).not.toHaveBeenCalled();
  });
});
