/**
 * engines/router.ts × google-web — “不翻译”术语占位符替换 HTTP 用例（#386）
 *
 * 切入点是 route()：真实 router + 真实 google-web 引擎，只 stub fetch。
 * 断言发给 Google 的查询文本（占位符）与回填后的译文（原词）。
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
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';

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
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
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

describe('Google “不翻译”术语替换（#386）', () => {
  test('发给 Google 的文本里是占位符，不含原词', async () => {
    await translate(['Open an issue here']);
    expect(queries()).toHaveLength(1);
    expect(queries()[0]).not.toMatch(/issue/i);
    expect(queries()[0]).toMatch(/^Open an ⟦TM\d+⟧ here$/);
  });

  test('回填后译文该位置是原词，大小写与原文一致', async () => {
    const resp = await translate(['Open an Issue here']);
    expect(resp.translations).toEqual(['译:Open an Issue here']);
  });

  test('多处命中、多条术语各自换回', async () => {
    rewrite = (q) => `【${q.split(' ').reverse().join(' ')}】`;
    const resp = await translate(['issue and pull request and ISSUE']);
    expect(queries()[0]).not.toMatch(/issue|pull request/i);
    expect(resp.translations).toEqual(['【ISSUE and pull request and issue】']);
  });

  test('与保留原文占位符同段出现时互不干扰', async () => {
    const resp = await translate(['⟦PT0⟧ opened an issue']);
    expect(queries()[0]).toContain('⟦PT0⟧');
    expect(queries()[0]).not.toMatch(/issue/i);
    expect(resp.translations).toEqual(['译:⟦PT0⟧ opened an issue']);
  });

  test('指定了译法的术语不参与替换', async () => {
    await translate(['Clone the repository']);
    expect(queries()[0]).toBe('Clone the repository');
  });

  test('没有命中术语：发送文本与原文一致', async () => {
    await translate(['Hello world']);
    expect(queries()[0]).toBe('Hello world');
  });

  test('占位符被引擎弄丢 → 不采用这份译文，改用原文重译（#389）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      rewrite = (q) => (q.includes('⟦TM') ? '译文丢了占位符' : `译:${q}`);
      const resp = await translate(['Open an issue']);
      expect(queries()).toEqual(['Open an ⟦TM0⟧', 'Open an issue']);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('原文里本来就有占位符样式的文字：不替换，照常翻译', async () => {
    const resp = await translate(['literal ⟦TM0⟧ and an issue']);
    expect(queries()[0]).toBe('literal ⟦TM0⟧ and an issue');
    expect(resp.translations).toEqual(['译:literal ⟦TM0⟧ and an issue']);
  });
});
