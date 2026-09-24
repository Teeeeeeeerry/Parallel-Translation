/**
 * engines/router.ts — 最后一个引擎部分失败时保留已成功段落（#416）
 *
 * 切入点是 route()：mock 引擎让一批中的部分段落失败，真实缓存模块。
 * 断言已成功段落的译文照常返回、失败段落经 failedIndices 单独标记；
 * 全部段落都失败时仍抛出聚合错误。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let enginePriority = ['google-web'];
let useCache = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority,
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
import { AllEnginesFailedError } from '~/src/engines/types';

/** 引擎把含 fail 的段落报告为失败，其余照常翻译。 */
function failMatching(prefix: string) {
  return async (req: Req) => ({
    translations: req.texts.map((t) => (t.includes('fail') ? '' : `${prefix}${t}`)),
    failedIndices: req.texts.flatMap((t, i) => (t.includes('fail') ? [i] : [])),
  });
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetStorage();
  enginePriority = ['google-web'];
  useCache = false;
  googleTranslate.mockReset();
  googleTranslate.mockImplementation(async (req: Req) => ({
    translations: req.texts.map((t) => `译:${t}`),
  }));
  bingTranslate.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  domains = [
    {
      id: 'dev',
      name: 'dev',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'user',
      terms: [{ source: 'issue', noTranslate: true }],
    },
  ];
});

afterEach(() => {
  warn.mockRestore();
});

describe('最后一个引擎部分失败', () => {
  test('单引擎、一段占位符损坏且重译失败 → 其余段落照常返回，失败段落单独标记', async () => {
    // 首次：含占位符的段落被改坏；重译：该段失败
    googleTranslate
      .mockImplementationOnce(async (req: Req) => ({
        translations: req.texts.map((t) => (/⟦TM\d+⟧/.test(t) ? '打开一个问题' : `译:${t}`)),
      }))
      .mockImplementationOnce(async (req: Req) => ({
        translations: req.texts.map(() => ''),
        failedIndices: req.texts.map((_, i) => i),
      }));

    const resp = await translate(['Hello', 'Open an issue', 'World']);

    expect(resp.translations[0]).toBe('译:Hello');
    expect(resp.translations[2]).toBe('译:World');
    expect(resp.failedIndices).toEqual([1]);
  });

  test('单引擎、引擎报告一段失败 → 其余段落照常返回', async () => {
    googleTranslate.mockImplementation(failMatching('译:'));

    const resp = await translate(['Alpha', 'Bravo fail', 'Charlie']);

    expect(resp.translations).toEqual(['译:Alpha', '', '译:Charlie']);
    expect(resp.failedIndices).toEqual([1]);
  });

  test('多引擎：前一个引擎的失败段落交给后一个，后一个仍失败的段落单独标记', async () => {
    enginePriority = ['google-web', 'bing-edge'];
    googleTranslate.mockImplementation(failMatching('译:'));
    bingTranslate.mockImplementationOnce(failMatching('必应:'));

    const resp = await translate(['Alpha fail', 'Bravo', 'Charlie fail', 'Delta']);

    expect(bingTranslate.mock.calls[0]![0].texts).toEqual(['Alpha fail', 'Charlie fail']);
    expect(resp.translations[1]).toBe('译:Bravo');
    expect(resp.translations[3]).toBe('译:Delta');
    expect(resp.failedIndices).toEqual([0, 2]);
  });

  test('全部成功时不携带 failedIndices', async () => {
    const resp = await translate(['Alpha', 'Bravo']);

    expect(resp.translations).toEqual(['译:Alpha', '译:Bravo']);
    expect(resp.failedIndices).toBeUndefined();
  });

  test('失败段落不写缓存：再次翻译只重发失败段落', async () => {
    useCache = true;
    googleTranslate.mockImplementation(failMatching('译:'));
    await translate(['Alpha', 'Bravo fail']);

    googleTranslate.mockClear();
    const resp = await translate(['Alpha', 'Bravo fail']);

    expect(googleTranslate).toHaveBeenCalledTimes(1);
    expect(googleTranslate.mock.calls[0]![0].texts).toEqual(['Bravo fail']);
    expect(resp.translations[0]).toBe('译:Alpha');
    expect(resp.failedIndices).toEqual([1]);
  });
});

describe('全部段落都失败', () => {
  test('引擎报告全部失败 → 抛出聚合错误', async () => {
    googleTranslate.mockImplementation(failMatching('译:'));

    await expect(translate(['Alpha fail', 'Bravo fail'])).rejects.toBeInstanceOf(
      AllEnginesFailedError,
    );
  });

  test('引擎抛出可重试错误 → 抛出聚合错误', async () => {
    enginePriority = ['google-web', 'bing-edge'];
    googleTranslate.mockRejectedValue(new Error('网络错误'));
    bingTranslate.mockRejectedValueOnce(new Error('网络错误'));

    await expect(translate(['Alpha', 'Bravo'])).rejects.toBeInstanceOf(AllEnginesFailedError);
  });
});
