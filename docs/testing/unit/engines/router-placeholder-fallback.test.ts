/**
 * engines/router.ts — “不翻译”术语占位符损坏时回退重试（#389）
 *
 * 切入点是 route()：mock 机翻引擎返回损坏的占位符，真实缓存模块。
 * 断言损坏段落改用原文重译一次、重译结果的缓存 key 不带术语哈希、
 * 每次回退记一条含引擎名的日志。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let useCache = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['google-web', 'bing-edge'],
    useCache,
    maxConcurrency: 6,
    models: {},
  })),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

type Req = { texts: string[]; terms?: unknown };
/** 假机翻引擎：默认把文本原样包上“译:”返回。 */
const googleTranslate = vi.fn(async (req: Req) => ({
  translations: req.texts.map((t) => `译:${t}`),
}));
const bingTranslate = vi.fn(async (req: Req) => ({
  translations: req.texts.map((t) => `必应:${t}`),
}));
vi.mock('~/src/engines/google-web', () => ({
  googleWeb: {
    id: 'google-web',
    displayName: 'Google 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    masksNoTranslate: true,
    translate: (req: Req) => googleTranslate(req),
  },
}));
vi.mock('~/src/engines/bing-edge', () => ({
  bingEdge: {
    id: 'bing-edge',
    displayName: 'Bing 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    translate: (req: Req) => bingTranslate(req),
  },
}));

import { route } from '~/src/engines/router';
import { cacheKey } from '~/src/storage/cache';

/** 第一次调用按 corrupt 改写含占位符的文本，之后照常翻译。 */
function corruptFirstCall(corrupt: (t: string) => string) {
  googleTranslate.mockImplementationOnce(async (req: Req) => ({
    translations: req.texts.map((t) => (/⟦TM\d+⟧/.test(t) ? corrupt(t) : `译:${t}`)),
  }));
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
}

async function storedKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('pt-c:'));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetStorage();
  useCache = false;
  googleTranslate.mockClear();
  bingTranslate.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  domains = [
    {
      id: 'dev',
      name: 'dev',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'user',
      terms: [
        { source: 'issue', noTranslate: true },
        { source: 'fork', noTranslate: true },
      ],
    },
  ];
});

afterEach(() => {
  warn.mockRestore();
});

describe('占位符损坏的判定', () => {
  test.each([
    ['缺失', (_: string) => '打开一个问题'],
    ['重复', (t: string) => `译:${t} ${t}`],
    ['被改写成别的样子', (t: string) => `译:${t.replace('⟦TM0⟧', '[TM0]')}`],
    ['编号被改', (t: string) => `译:${t.replace('⟦TM0⟧', '⟦TM1⟧')}`],
  ])('占位符%s → 该段用原文重译一次', async (_, corrupt) => {
    corruptFirstCall(corrupt);
    const resp = await translate(['Open an issue']);

    expect(googleTranslate).toHaveBeenCalledTimes(2);
    expect(googleTranslate.mock.calls[0]![0].texts).toEqual(['Open an ⟦TM0⟧']);
    // 重译发送未替换术语的原文，也不带术语
    const retry = googleTranslate.mock.calls[1]![0];
    expect(retry.texts).toEqual(['Open an issue']);
    expect(retry.terms).toBeUndefined();
    expect(resp.translations).toEqual(['译:Open an issue']);
    expect(bingTranslate).not.toHaveBeenCalled();
  });
});

describe('回退重试', () => {
  test('只重译损坏的段落，完好段落照常换回原词', async () => {
    googleTranslate.mockImplementationOnce(async () => ({
      translations: ['译:Open an ⟦TM0⟧', '译文把占位符弄丢了', '译:Hello'],
    }));

    const resp = await translate(['Open an issue', 'Make a fork', 'Hello']);

    expect(googleTranslate).toHaveBeenCalledTimes(2);
    expect(googleTranslate.mock.calls[1]![0].texts).toEqual(['Make a fork']);
    expect(resp.translations).toEqual(['译:Open an issue', '译:Make a fork', '译:Hello']);
  });

  test('每次回退记录一条含引擎名的日志', async () => {
    googleTranslate.mockImplementationOnce(async () => ({
      translations: ['丢了', '也丢了', '译:Hello'],
    }));
    await translate(['Open an issue', 'Make a fork', 'Hello']);

    const fallbackLogs = warn.mock.calls.filter((c) => String(c[0]).includes('占位符'));
    expect(fallbackLogs).toHaveLength(2);
    for (const c of fallbackLogs) {
      expect(JSON.stringify(c)).toContain('google-web');
    }
  });

  test('占位符完好：不重译、不记日志', async () => {
    const resp = await translate(['Open an issue']);
    expect(googleTranslate).toHaveBeenCalledTimes(1);
    expect(resp.translations).toEqual(['译:Open an issue']);
    expect(warn).not.toHaveBeenCalled();
  });

  test('重译失败 → 该段交给下一个引擎', async () => {
    googleTranslate
      .mockImplementationOnce(async () => ({ translations: ['丢了'] }))
      .mockImplementationOnce(async () => {
        throw new Error('network');
      });
    const resp = await translate(['Open an issue']);
    expect(googleTranslate).toHaveBeenCalledTimes(2);
    expect(bingTranslate).toHaveBeenCalledTimes(1);
    expect(resp.translations).toEqual(['必应:Open an issue']);
  });
});

describe('重译结果的缓存', () => {
  test('写入缓存时不带术语哈希；完好段落仍带术语哈希', async () => {
    useCache = true;
    googleTranslate.mockImplementationOnce(async () => ({
      translations: ['丢了', '译:Make a ⟦TM0⟧'],
    }));
    await translate(['Open an issue', 'Make a fork']);

    const keys = await storedKeys();
    const issueHits = [{ source: 'issue', noTranslate: true }];
    const forkHits = [{ source: 'fork', noTranslate: true }];
    expect(keys).toContain(await cacheKey('google-web', 'en', 'zh-CN', 'Open an issue'));
    expect(keys).not.toContain(
      await cacheKey('google-web', 'en', 'zh-CN', 'Open an issue', '', issueHits),
    );
    expect(keys).toContain(await cacheKey('google-web', 'en', 'zh-CN', 'Make a fork', '', forkHits));
    expect(keys).toHaveLength(2);

    const all = await chrome.storage.local.get(null);
    const plain = all[await cacheKey('google-web', 'en', 'zh-CN', 'Open an issue')];
    expect(JSON.stringify(plain)).toContain('译:Open an issue');
  });
});
