/**
 * engines/router.ts — 机翻引擎“指定译法”开关（#390）与术语哈希（#419）
 *
 * 切入点是 route()：真实 router + 真实 google-web 引擎，只 stub fetch；
 * AI 引擎用 mock（只关心它的缓存 key）。断言发给 Google 的查询文本、
 * 回填后的译文，以及写入 storage.local 的缓存 key。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain, Term } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let enginePriority = ['google-web'];
let mtApplyTermTargets = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority,
    useCache: true,
    maxConcurrency: 6,
    models: {},
    mtApplyTermTargets,
  })),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

const openaiTranslate = vi.fn(async (req: { texts: string[] }) => ({
  translations: req.texts.map((t) => `AI:${t}`),
}));
vi.mock('~/src/engines/openai', () => ({
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    requiresKey: true,
    supportedLangs: 'all' as const,
    injectsTerms: true,
    translate: (req: { texts: string[] }) => openaiTranslate(req),
  },
}));

import { route } from '~/src/engines/router';
import { cacheKey } from '~/src/storage/cache';

const ISSUE: Term = { source: 'issue', noTranslate: true };
const REPOSITORY: Term = { source: 'repository', target: '仓库' };

/** 假 Google：把查询文本原样包上“译:”返回，可按需改写。 */
let rewrite: (q: string) => string = (q) => `译:${q}`;
let fetchMock: ReturnType<typeof vi.fn>;

/** 发给 Google 的全部查询文本。 */
function queries(): string[] {
  return fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q') ?? '');
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
}

async function storedKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('pt-c:'));
}

/** 翻译一段原文，返回本次新写入的缓存 key。 */
async function keyWritten(text: string): Promise<string> {
  const before = new Set(await storedKeys());
  await translate([text]);
  const added = (await storedKeys()).filter((k) => !before.has(k));
  expect(added).toHaveLength(1);
  return added[0]!;
}

beforeEach(() => {
  resetStorage();
  enginePriority = ['google-web'];
  mtApplyTermTargets = false;
  rewrite = (q) => `译:${q}`;
  openaiTranslate.mockClear();
  domains = [
    {
      id: 'dev',
      name: 'dev',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'user',
      terms: [ISSUE, { source: 'pull request', noTranslate: true }, REPOSITORY],
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

describe('开关关闭（默认）', () => {
  test('只有“不翻译”术语参与替换，指定了译法的术语原样发送', async () => {
    const resp = await translate(['Open an issue in the repository']);
    expect(queries()).toEqual(['Open an ⟦TM0⟧ in the repository']);
    expect(resp.translations).toEqual(['译:Open an issue in the repository']);
  });

  test('术语哈希与开关引入前逐字节相同 —— 已有缓存继续有效', async () => {
    const text = 'Open an issue in the repository';
    expect(await keyWritten(text)).toBe(
      await cacheKey('google-web', 'en', 'zh-CN', text, '', [ISSUE]),
    );
  });
});

describe('开关打开', () => {
  beforeEach(() => {
    mtApplyTermTargets = true;
  });

  test('指定了译法的术语也换成占位符，回填为指定译法', async () => {
    const resp = await translate(['Clone the Repository']);
    expect(queries()).toEqual(['Clone the ⟦TM0⟧']);
    expect(resp.translations).toEqual(['译:Clone the 仓库']);
  });

  test('“不翻译”术语仍回填为原词', async () => {
    rewrite = (q) => `【${q.split(' ').reverse().join(' ')}】`;
    const resp = await translate(['Open an Issue in the repository']);
    expect(queries()[0]).not.toMatch(/issue|repository/i);
    expect(resp.translations).toEqual(['【仓库 the in Issue an Open】']);
  });

  test('占位符被引擎改坏 → 改用原文重译（#389），译文里不出现指定译法', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      rewrite = (q) => (q.includes('⟦TM') ? '译文丢了占位符' : `译:${q}`);
      const resp = await translate(['Clone the repository']);
      expect(queries()).toEqual(['Clone the ⟦TM0⟧', 'Clone the repository']);
      expect(resp.translations).toEqual(['译:Clone the repository']);
    } finally {
      warn.mockRestore();
    }
  });

  test('修改指定译法后不命中旧缓存', async () => {
    await translate(['Clone the repository']);
    domains[0]!.terms = [ISSUE, { source: 'repository', target: '代码库' }];
    const resp = await translate(['Clone the repository']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resp.translations).toEqual(['译:Clone the 代码库']);
  });
});

describe('开关状态参与术语哈希（#419）', () => {
  test('机翻引擎：切换开关后不命中另一状态下写入的缓存', async () => {
    const off = await keyWritten('Clone the repository');
    mtApplyTermTargets = true;
    const on = await keyWritten('Clone the repository');
    expect(on).not.toBe(off);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('机翻引擎：只命中“不翻译”术语时，开关状态同样进哈希', async () => {
    const off = await keyWritten('Open an issue');
    mtApplyTermTargets = true;
    expect(await keyWritten('Open an issue')).not.toBe(off);
  });

  test('本段没有命中术语：开关切换前后 key 相同，仍命中缓存', async () => {
    await translate(['Hello world']);
    mtApplyTermTargets = true;
    const resp = await translate(['Hello world']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resp.translations).toEqual(['译:Hello world']);
  });

  test('AI 引擎：术语哈希包含全部命中术语，与开关无关', async () => {
    enginePriority = ['openai'];
    const text = 'Open an issue in the repository';
    const off = await keyWritten(text);
    expect(off).toBe(
      await cacheKey('openai', 'en', 'zh-CN', text, 'gpt-4o-mini', [ISSUE, REPOSITORY]),
    );
    mtApplyTermTargets = true;
    await translate([text]);
    expect(openaiTranslate).toHaveBeenCalledTimes(1);
  });
});
