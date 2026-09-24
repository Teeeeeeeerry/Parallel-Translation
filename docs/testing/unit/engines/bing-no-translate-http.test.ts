/**
 * engines/router.ts × bing-edge — “不翻译”术语占位符替换 HTTP 用例（#387）
 *
 * 切入点是 route()：真实 router + 真实 bing-edge 引擎，只 stub fetch。
 * 断言发给 Bing 的请求体（占位符）与回填后的译文（原词）。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let useCache = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['bing-edge'],
    useCache,
    maxConcurrency: 6,
    models: {},
  })),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';

const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
const payload = Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
).toString('base64url');
const JWT = `${header}.${payload}.sig`;

/** 假 Bing：把每段文本原样包上“译:”返回，可按需改写。 */
let rewrite: (text: string) => string = (t) => `译:${t}`;
let fetchMock: ReturnType<typeof vi.fn>;

/** 每次翻译请求发给 Bing 的文本，按请求分组。 */
function requests(): string[][] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]) !== AUTH_URL)
    .map((c) => (JSON.parse(String(c[1].body)) as { Text: string }[]).map((r) => r.Text));
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
}

beforeEach(() => {
  resetStorage();
  useCache = false;
  rewrite = (t) => `译:${t}`;
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
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === AUTH_URL) return new Response(JWT, { status: 200 });
    const rows = (JSON.parse(String(init!.body)) as { Text: string }[]).map((r) => ({
      translations: [{ text: rewrite(r.Text) }],
    }));
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Bing “不翻译”术语替换（#387）', () => {
  test('发给 Bing 的文本里是占位符，不含原词', async () => {
    await translate(['Open an issue here']);
    expect(requests()).toEqual([['Open an ⟦TM0⟧ here']]);
  });

  test('占位符往返后回填为原词，大小写与原文一致', async () => {
    const resp = await translate(['Open an Issue here']);
    expect(resp.translations).toEqual(['译:Open an Issue here']);
  });

  test('同一请求里多段、多条术语各自换回', async () => {
    rewrite = (t) => `【${t.split(' ').reverse().join(' ')}】`;
    const resp = await translate(['issue and pull request', 'Merge the Pull Request']);
    expect(requests()[0]!.join('\n')).not.toMatch(/issue|pull request/i);
    expect(resp.translations).toEqual([
      '【pull request and issue】',
      '【Pull Request the Merge】',
    ]);
  });

  test('指定了译法的术语不参与替换', async () => {
    await translate(['Clone the repository']);
    expect(requests()).toEqual([['Clone the repository']]);
  });

  test('占位符被 Bing 改坏 → 不采用这份译文，改用原文重译（#389）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      rewrite = (t) => (t.includes('⟦TM') ? t.replace('⟦TM0⟧', '[TM0]') : `译:${t}`);
      const resp = await translate(['Open an issue']);
      expect(requests()).toEqual([['Open an ⟦TM0⟧'], ['Open an issue']]);
      expect(resp.translations).toEqual(['译:Open an issue']);
    } finally {
      warn.mockRestore();
    }
  });

  test('缓存里存的是换回原词后的译文', async () => {
    useCache = true;
    await translate(['Open an issue']);
    const resp = await translate(['Open an issue']);
    expect(resp.translations).toEqual(['译:Open an issue']);
    expect(requests()).toHaveLength(1);
  });
});
