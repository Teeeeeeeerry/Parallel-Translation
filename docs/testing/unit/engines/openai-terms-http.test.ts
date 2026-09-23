/**
 * engines/openai.ts — 术语注入 HTTP 用例（#381）
 *
 * 切入点是 route()：真实 router + 真实 openai 引擎，只 stub fetch。
 * 断言发给 OpenAI 的请求体里的术语段，以及术语段落在多段编号下的回填。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['openai'],
    useCache: false,
    maxConcurrency: 6,
    models: { openai: 'gpt-4o' },
  })),
}));

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(async () => 'sk-test'),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';

const okResp = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

/** 最近一次请求的 user 消息。 */
function userMessage(call = -1): string {
  const init = fetchMock.mock.calls.at(call)![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]!.role).toBe('user');
  return body.messages[0]!.content;
}

beforeEach(() => {
  domains = [
    {
      id: 'dev',
      name: 'dev',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'user',
      terms: [
        { source: 'issue', noTranslate: true },
        { source: 'PR', noTranslate: true },
        { source: 'repository', target: '仓库' },
        { source: 'fork', noTranslate: true },
        { source: 'maintainer', target: '维护者' },
      ],
    },
  ];
  fetchMock = vi.fn(async () => okResp('1. 甲\n2. 乙\n3. 丙'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI 术语注入（#381）', () => {
  test('请求只包含本批命中的术语，追加在 user 消息末尾', async () => {
    await route({
      texts: ['Open an issue', 'Clone the repository', 'Hello'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });

    const content = userMessage();
    const numbered = content.indexOf('1. Open an issue');
    const termSection = content.indexOf('issue →');
    expect(numbered).toBeGreaterThan(-1);
    expect(termSection).toBeGreaterThan(numbered);
    expect(content).toContain('3. Hello');

    const termLines = content.split('\n').filter((l) => l.includes(' → '));
    expect(termLines).toEqual(['issue → “不翻译”', 'repository → 仓库']);
    expect(content).toContain('必须使用以下译法');
    // 未命中的术语不发送
    expect(content).not.toMatch(/\bPR\b|fork|maintainer/);
  });

  test('本批没有命中术语：请求与不带领域时逐字节相同', async () => {
    fetchMock.mockImplementation(async () => okResp('1. 你好\n2. 世界'));
    const texts = ['Hello', 'World'];
    await route({ texts, from: 'en', to: 'zh-CN' });
    await route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });

    const bodyOf = (i: number) => String((fetchMock.mock.calls[i]![1] as RequestInit).body);
    expect(bodyOf(1)).toBe(bodyOf(0));
    expect(userMessage(1)).not.toContain('→');
  });

  test('没有译法也没标“不翻译”的术语不发送', async () => {
    domains[0]!.terms.push({ source: 'draft' });
    fetchMock.mockImplementation(async () => okResp('1. 草稿'));
    await route({ texts: ['a draft'], from: 'en', to: 'zh-CN', domainId: 'dev' });
    expect(userMessage()).not.toContain('→');
  });

  test('同一术语在多段里命中只发送一次', async () => {
    await route({
      texts: ['issue one', 'issue two', 'ISSUE three'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    const termLines = userMessage().split('\n').filter((l) => l.includes(' → '));
    expect(termLines).toEqual(['issue → “不翻译”']);
  });

  test('术语段落 + 多段编号：译文按编号回填到对应段落', async () => {
    fetchMock.mockImplementation(async () =>
      okResp('1. 打开一个 issue\n2. 克隆仓库\n3. 你好'),
    );
    const resp = await route({
      texts: ['Open an issue', 'Clone the repository', 'Hello'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    expect(resp.translations).toEqual(['打开一个 issue', '克隆仓库', '你好']);
  });

  test('模型乱序输出编号时仍按编号回填', async () => {
    fetchMock.mockImplementation(async () =>
      okResp('2. 克隆仓库\n1. 打开一个 issue\n3. 你好'),
    );
    const resp = await route({
      texts: ['Open an issue', 'Clone the repository', 'Hello'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });
    expect(resp.translations).toEqual(['打开一个 issue', '克隆仓库', '你好']);
  });
});
