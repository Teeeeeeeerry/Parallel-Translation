/**
 * engines/router.ts × google-web — 送翻文字里带换行（#840）
 *
 * 整段一个单元的 br 段落送翻时把 br 作为换行带出去。切入点是 route()：
 * 真实 router + 真实 google-web 引擎 + 真实翻译缓存，只 stub fetch。断言
 * 发给 Google 的查询文本、回填后的译文，以及同一段文字第二次翻译时有没有
 * 再发请求 —— 写进缓存的 key 与读缓存的 key 必须是同一个，否则永远不命中。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let useCache = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['google-web'],
    useCache,
    maxConcurrency: 6,
    models: {},
  })),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getCachedEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';
import { ENGINES } from '~/src/engines/registry';

/** 假 Google：把查询文本原样包上“译:”返回，可按需改写。 */
let rewrite: (q: string) => string = (q) => `译:${q}`;
let fetchMock: ReturnType<typeof vi.fn>;

/** 发给 Google 的全部查询文本。 */
function queries(): string[] {
  return fetchMock.mock.calls.map(
    (c) => new URL(String(c[0])).searchParams.get('q') ?? '',
  );
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' }, ENGINES);
}

beforeEach(() => {
  resetStorage();
  useCache = false;
  rewrite = (q) => `译:${q}`;
  domains = [
    {
      id: 'dev',
      name: 'dev',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'user',
      terms: [
        { source: 'issue', noTranslate: true },
        { source: 'pull request', noTranslate: true },
        { source: 'repository', target: '仓库' },
      ],
    },
  ];
  fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    return new Response(JSON.stringify([[[rewrite(q)]]]), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('缓存 key：写入与读取是同一个（#840）', () => {
  test('带换行的文字翻过一次，再翻同一段：命中缓存，不再发请求，译文的换行原样', async () => {
    useCache = true;
    const text = 'Roses are red,\nviolets are blue,\nsugar is sweet,\nand so are you.';

    const first = await translate([text]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const second = await translate([text]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.translations).toEqual(first.translations);
    expect(second.translations[0]).toBe(`译:${text}`);
  });

  test('命中术语的带换行文字：同样命中缓存，换回的原词与换行都在', async () => {
    useCache = true;
    const text = 'Open an issue\nthen a pull request\nin the repository';

    const first = await translate([text]);
    const second = await translate([text]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.translations).toEqual(first.translations);
    expect(second.translations[0]!.split('\n')).toHaveLength(3);
  });

  test('同一段文字改动前（br 是空格）与改动后（br 是换行）key 不同：改动后第一次翻译重新请求一次，是预期的', async () => {
    useCache = true;
    await translate(['Roses are red, violets are blue,']);
    await translate(['Roses are red,\nviolets are blue,']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 各自再翻一次都命中
    await translate(['Roses are red, violets are blue,']);
    await translate(['Roses are red,\nviolets are blue,']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('术语占位符不被换行切坏（#840）', () => {
  test('术语在行首、行尾：照常换成占位符，换行原样送出，回填后是原词', async () => {
    const resp = await translate(['issue opened\nsee the pull request\nissue']);

    expect(queries()[0]).toMatch(/^⟦TM\d+⟧ opened\nsee the ⟦TM\d+⟧\n⟦TM\d+⟧$/);
    expect(resp.translations).toEqual(['译:issue opened\nsee the pull request\nissue']);
  });

  test('多词术语被 br 隔在两行：换行当作空白命中（#952）', async () => {
    await translate(['open a pull\nrequest here']);

    expect(queries()[0]).toBe('open a ⟦TM0⟧ here');
  });
});
