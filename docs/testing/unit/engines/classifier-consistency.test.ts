/**
 * 引擎的单一错误分类器：翻译与测试连接对同一响应给出一致的类别（#1146）
 *
 * 每个引擎只写一个错误分类器，翻译骨架包成引擎错误、测试连接骨架包成测试
 * 结果。原先 DeepSeek 的 402、Grok 的认证失败在两处各写一遍。
 *
 * 表驱动：OpenAI、DeepSeek、Grok × 401 / 403 / 402 / 429 / 5xx / 超时，同一份
 * 假响应分别驱动真实适配器的翻译与测试连接，类别一致、都符合预期；有特殊文案
 * 的（DeepSeek 余额不足、Grok 授权提示）两边文案也相同。
 */
import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { EngineError } from '~/src/engines/types';

vi.mock('~/src/storage/keys', () => ({ getKey: vi.fn() }));
vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: {} })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

beforeEach(() => {
  // DeepSeek、Grok 的端点走可选权限（#610）：已授予
  (chrome.permissions.contains as unknown as Mock).mockResolvedValue(true);
});
const realFetch = globalThis.fetch;
afterEach(() => {
  // 不用 unstubAllGlobals：setup 里的 chrome 也是 stubGlobal 挂上的
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

type Id = 'openai' | 'deepseek' | 'grok';
type Reply = number | 'timeout';

/** 假的 fetch：按状态码回一个错误响应，或者永不返回（超时）。 */
function stubFetch(reply: Reply): void {
  globalThis.fetch = vi.fn(() =>
    reply === 'timeout' ? new Promise<Response>(() => {}) : Promise.resolve(new Response('err', { status: reply })),
  ) as typeof fetch;
}

/** 超时：假时钟推过引擎的 fetch 超时。 */
async function settle<T>(reply: Reply, run: () => Promise<T>): Promise<T> {
  if (reply !== 'timeout') return run();
  vi.useFakeTimers();
  const p = run();
  const { FETCH_TIMEOUT_MS } = await import('~/src/engines/fetch-timeout');
  await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
  return p;
}

async function viaTranslate(id: Id, reply: Reply): Promise<{ category: string; message: string }> {
  vi.resetModules();
  const { getKey } = await import('~/src/storage/keys');
  vi.mocked(getKey).mockResolvedValue('k');
  stubFetch(reply);
  const engine = (await import(`~/src/engines/${id}`))[id] as import('~/src/engines/types').TranslateEngine;
  return settle(reply, async () => {
    try {
      await engine.translate({ texts: ['a'], from: 'auto', to: 'zh' });
      return { category: 'no-error', message: '' };
    } catch (e) {
      return { category: (e as EngineError).category, message: (e as EngineError).message };
    }
  });
}

async function viaProbe(id: Id, reply: Reply): Promise<{ category: string; message: string }> {
  vi.resetModules();
  stubFetch(reply);
  const { probeConnection } = await import('~/src/engines/shared');
  const spec = (await import(`~/src/engines/${id}`))[`${id}Probe`];
  return settle(reply, async () => {
    const r = await probeConnection(spec, { key: 'k' });
    return r.ok ? { category: 'ok', message: r.message } : { category: r.category, message: r.message };
  });
}

const EXPECTED: Record<Id, Record<string, string>> = {
  openai: { 401: 'invalid-key', 403: 'invalid-key', 402: 'transient', 429: 'quota', 500: 'transient', 503: 'transient', timeout: 'transient' },
  deepseek: { 401: 'invalid-key', 403: 'invalid-key', 402: 'quota', 429: 'quota', 500: 'transient', 503: 'transient', timeout: 'transient' },
  grok: { 401: 'invalid-key', 403: 'invalid-key', 402: 'transient', 429: 'quota', 500: 'transient', 503: 'transient', timeout: 'transient' },
};

const REPLIES: Reply[] = [401, 403, 402, 429, 500, 503, 'timeout'];

describe('翻译与测试连接共用一个分类器（#1146）', () => {
  for (const id of ['openai', 'deepseek', 'grok'] as const) {
    test.each(REPLIES)(`${id}：%s 时翻译与测试连接的类别一致`, async (reply) => {
      const t = await viaTranslate(id, reply);
      const p = await viaProbe(id, reply);
      expect(t.category).toBe(EXPECTED[id][String(reply)]);
      expect(p.category).toBe(t.category);
      // 网络异常时测试连接报异常原文，翻译报引擎错误原文，两边都是同一个超时原因
      expect(p.message).toBe(t.message);
    });
  }

  test('DeepSeek 402：两边都提示余额不足', async () => {
    expect((await viaTranslate('deepseek', 402)).message).toBe('余额不足');
    expect((await viaProbe('deepseek', 402)).message).toBe('余额不足');
  });

  test('Grok 认证失败：两边都是同一条授权提示，不是通用的“API key 无效”', async () => {
    const t = await viaTranslate('grok', 403);
    expect(t.message).not.toBe('API key 无效');
    expect((await viaProbe('grok', 403)).message).toBe(t.message);
  });
});
