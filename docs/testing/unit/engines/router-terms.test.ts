/**
 * engines/router.ts — 术语匹配与缓存 key 单元测试（#380）
 *
 * 切入点是 route()：用真实缓存模块，断言写入 storage.local 的缓存 key
 * 与缓存命中行为（引擎是否被调用）。领域数据经 mock 的存储模块提供，
 * 以便构造不同站点、不同译法的领域。
 *
 * #419：术语哈希只算该引擎实际生效的术语 —— Google 只替换“不翻译”术语，
 * AI 引擎注入全部命中术语，不处理术语的引擎一个都不算。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { Domain, Term } from '~/src/storage/domains';

let enginePriority = ['google-web'];
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority,
    useCache: true,
    models: {},
  })),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

const googleTranslate = vi.fn(async (req: { texts: string[] }) => ({
  translations: req.texts.map((t) => `译:${t}`),
}));
vi.mock('~/src/engines/google-web', () => ({
  googleWeb: {
    id: 'google-web',
    displayName: 'Google 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    masksNoTranslate: true,
    translate: (req: { texts: string[] }) => googleTranslate(req),
  },
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
const bingTranslate = vi.fn(async (req: { texts: string[] }) => ({
  translations: req.texts.map((t) => `必应:${t}`),
}));
vi.mock('~/src/engines/bing-edge', () => ({
  bingEdge: {
    id: 'bing-edge',
    displayName: 'Bing 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    translate: (req: { texts: string[] }) => bingTranslate(req),
  },
}));

import { route } from '~/src/engines/router';
import { cacheKey, cacheSet } from '~/src/storage/cache';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import type { EngineId } from '~/src/storage/schema';

function domain(id: string, sites: string[], terms: Term[]): Domain {
  return { id, name: id, targetLang: 'zh-CN', sites, terms, origin: 'user' };
}

/** 缓存里现存的全部译文 key。 */
async function storedKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('pt-c:'));
}

/** 翻译一段原文，返回本次新写入的缓存 key。 */
async function keyWritten(text: string, domainId?: string): Promise<string> {
  const before = new Set(await storedKeys());
  await route({ texts: [text], from: 'en', to: 'zh-CN', ...(domainId && { domainId }) });
  const added = (await storedKeys()).filter((k) => !before.has(k));
  expect(added).toHaveLength(1);
  return added[0]!;
}

/** 与现状一致的 key（不带术语段）；BYOK 引擎带默认模型名。 */
function legacyKey(text: string, engine = 'google-web'): Promise<string> {
  return cacheKey(engine, 'en', 'zh-CN', text, DEFAULT_MODELS[engine as EngineId] ?? '');
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  enginePriority = ['google-web'];
  googleTranslate.mockClear();
  openaiTranslate.mockClear();
  bingTranslate.mockClear();
  domains = [
    domain('dev', ['github.com'], [
      { source: 'PR', noTranslate: true },
      { source: 'issue', noTranslate: true },
      { source: 'repository', target: '仓库' },
    ]),
  ];
});

describe('术语匹配（拉丁字母整词、不区分大小写）', () => {
  test('PR 命中 “open a PR”：key 带术语段', async () => {
    const k = await keyWritten('open a PR', 'dev');
    expect(k).not.toBe(await legacyKey('open a PR'));
    expect(k.startsWith(`${await legacyKey('open a PR')}:`)).toBe(true);
  });

  test('PR 不命中 “price”：key 与现状一致', async () => {
    expect(await keyWritten('the price is right', 'dev')).toBe(
      await legacyKey('the price is right'),
    );
  });

  test('Issue、ISSUE、issue 都命中同一条术语', async () => {
    const suffix = async (text: string) =>
      (await keyWritten(text, 'dev')).slice((await legacyKey(text)).length);
    const s1 = await suffix('Issue closed');
    expect(s1).not.toBe('');
    expect(await suffix('ISSUE closed')).toBe(s1);
    expect(await suffix('issue closed')).toBe(s1);
  });

  test('术语出现在标点旁、句首句尾都算整词', async () => {
    const k = await keyWritten('PR: fixes the issue.', 'dev');
    expect(k).not.toBe(await legacyKey('PR: fixes the issue.'));
  });

  test('拉丁字母术语紧挨中日韩文字也算整词', async () => {
    expect(await keyWritten('打开PR页面', 'dev')).not.toBe(await legacyKey('打开PR页面'));
    expect(await keyWritten('PRを開く', 'dev')).not.toBe(await legacyKey('PRを開く'));
  });

  test('多词术语按整词命中，不命中词的一部分', async () => {
    domains[0]!.terms = [{ source: 'pull request', noTranslate: true }];
    expect(await keyWritten('open a pull request', 'dev')).not.toBe(
      await legacyKey('open a pull request'),
    );
    expect(await keyWritten('pull requests pile up', 'dev')).toBe(
      await legacyKey('pull requests pile up'),
    );
  });
});

describe('缓存 key 与术语', () => {
  test('AI 引擎：修改术语译法后 key 变化，不命中旧译文', async () => {
    enginePriority = ['openai'];
    const before = await keyWritten('Clone the repository', 'dev');
    domains[0]!.terms[2] = { source: 'repository', target: '代码库' };
    const after = await keyWritten('Clone the repository', 'dev');
    expect(after).not.toBe(before);
    expect(openaiTranslate).toHaveBeenCalledTimes(2);
  });

  test('“不翻译”标记参与 key', async () => {
    const before = await keyWritten('Clone the repository', 'dev');
    domains[0]!.terms[2] = { source: 'repository', target: '仓库', noTranslate: true };
    expect(await keyWritten('Clone the repository', 'dev')).not.toBe(before);
  });

  test('未命中术语的段落继续命中现有缓存', async () => {
    await cacheSet(await legacyKey('Hello world'), '旧译文');
    const resp = await route({
      texts: ['Hello world'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    expect(resp.translations).toEqual(['旧译文']);
    expect(googleTranslate).not.toHaveBeenCalled();
  });

  test('请求不带领域 ID：key 与现状一致', async () => {
    expect(await keyWritten('open a PR')).toBe(await legacyKey('open a PR'));
  });

  test('领域 ID 找不到对应领域：key 与现状一致', async () => {
    expect(await keyWritten('open a PR', 'missing')).toBe(
      await legacyKey('open a PR'),
    );
  });

  test('两个站点对同一段原文命中相同术语时共用缓存', async () => {
    domains.push(
      domain('dev-gitlab', ['gitlab.com'], [
        { source: 'repository', target: '仓库' },
        { source: 'fork', noTranslate: true },
      ]),
    );
    await route({ texts: ['Clone the repository'], from: 'en', to: 'zh-CN', domainId: 'dev' });
    const resp = await route({
      texts: ['Clone the repository'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev-gitlab',
    });
    expect(resp.translations).toEqual(['译:Clone the repository']);
    expect(googleTranslate).toHaveBeenCalledTimes(1);
  });

  test('原词首尾空格不影响共用缓存', async () => {
    domains.push(domain('dev-spaced', ['gitlab.com'], [{ source: ' repository ', target: '仓库' }]));
    await route({ texts: ['Clone the repository'], from: 'en', to: 'zh-CN', domainId: 'dev' });
    await route({ texts: ['Clone the repository'], from: 'en', to: 'zh-CN', domainId: 'dev-spaced' });
    expect(googleTranslate).toHaveBeenCalledTimes(1);
  });

  test('同一批里命中与未命中的段落各用各的 key', async () => {
    await route({
      texts: ['open a PR', 'Hello world'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    const keys = await storedKeys();
    expect(keys).toContain(await legacyKey('Hello world'));
    expect(keys).not.toContain(await legacyKey('open a PR'));
    expect(keys).toHaveLength(2);
  });
});

describe('术语哈希只算实际生效的术语（#419）', () => {
  test('Google：只命中指定译法的术语 → key 与引入术语前逐字节相同', async () => {
    expect(await keyWritten('Clone the repository', 'dev')).toBe(
      await legacyKey('Clone the repository'),
    );
  });

  test('Google：修改指定译法不影响 key，继续命中缓存', async () => {
    await route({ texts: ['Clone the repository'], from: 'en', to: 'zh-CN', domainId: 'dev' });
    domains[0]!.terms[2] = { source: 'repository', target: '代码库' };
    const resp = await route({
      texts: ['Clone the repository'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    expect(resp.translations).toEqual(['译:Clone the repository']);
    expect(googleTranslate).toHaveBeenCalledTimes(1);
  });

  test('Google：同时命中两类术语时，只有“不翻译”术语进哈希', async () => {
    const text = 'Open a PR in the repository';
    const both = await keyWritten(text, 'dev');
    await chrome.storage.local.clear();
    domains = [domain('dev', ['github.com'], [{ source: 'PR', noTranslate: true }])];
    expect(await keyWritten(text, 'dev')).toBe(both);
    expect(both).not.toBe(await legacyKey(text));
  });

  test('AI 引擎：指定译法与“不翻译”术语都进哈希', async () => {
    enginePriority = ['openai'];
    const text = 'Open a PR in the repository';
    const both = await keyWritten(text, 'dev');
    await chrome.storage.local.clear();
    domains = [domain('dev', ['github.com'], [{ source: 'PR', noTranslate: true }])];
    const onlyNoTranslate = await keyWritten(text, 'dev');
    expect(both).not.toBe(onlyNoTranslate);
    // 只命中指定译法的术语也带术语段
    domains = [domain('dev', ['github.com'], [{ source: 'repository', target: '仓库' }])];
    const k = await keyWritten('Clone the repository', 'dev');
    expect(k.startsWith(`${await legacyKey('Clone the repository', 'openai')}:`)).toBe(true);
  });

  test('不处理术语的引擎：命中术语也不带术语段', async () => {
    enginePriority = ['bing-edge'];
    expect(await keyWritten('Open a PR in the repository', 'dev')).toBe(
      await legacyKey('Open a PR in the repository', 'bing-edge'),
    );
  });

  test('同一段原文在 Google 失败后交给 AI 引擎：各按自己生效的术语写缓存', async () => {
    enginePriority = ['google-web', 'openai'];
    googleTranslate.mockRejectedValueOnce(new Error('网络错误'));
    const text = 'Clone the repository';
    const k = await keyWritten(text, 'dev');
    expect(k.startsWith(`${await legacyKey(text, 'openai')}:`)).toBe(true);
  });

  test('#380 以来按旧口径写入的带术语条目不再命中', async () => {
    // 旧口径：术语段是命中术语 [原词, 译法, 不翻译] 排序后的 SHA-1，无版本标记
    const text = 'open a PR';
    const canonical = JSON.stringify(['PR', '', true]);
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`[${canonical}]`));
    const oldHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await cacheSet(`${await legacyKey(text)}:${oldHash}`, '没有术语约束的旧译文');

    const resp = await route({ texts: [text], from: 'en', to: 'zh-CN', domainId: 'dev' });
    expect(resp.translations).toEqual(['译:open a PR']);
    expect(googleTranslate).toHaveBeenCalledTimes(1);
  });
});
