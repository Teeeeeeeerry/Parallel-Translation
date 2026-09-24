/**
 * engines/gemini.ts — 术语注入 HTTP 用例（#382）
 *
 * 切入点是 route()：真实 router + 真实 gemini 引擎，只 stub fetch。
 * 术语格式沿用 #381：断言发给 Gemini 的请求体里的术语段。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain } from '~/src/storage/domains';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['gemini'],
    useCache: false,
    maxConcurrency: 6,
    models: { gemini: 'gemini-2.5-flash' },
  })),
}));

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(async () => 'k-test'),
}));

let domains: Domain[] = [];
vi.mock('~/src/storage/domains', () => ({
  getEffectiveDomains: vi.fn(async () => structuredClone(domains)),
}));

import { route } from '~/src/engines/router';

const okResp = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

/** 第 call 次请求的提示词（默认最近一次）。 */
function promptText(call = -1): string {
  const init = fetchMock.mock.calls.at(call)![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  expect(body.contents).toHaveLength(1);
  expect(body.contents[0]!.parts).toHaveLength(1);
  return body.contents[0]!.parts[0]!.text;
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

describe('Gemini 术语注入（#382）', () => {
  test('请求只包含本批命中的术语，追加在编号文本之后', async () => {
    await route({
      texts: ['Open an issue', 'Clone the repository', 'Hello'],
      from: 'en',
      to: 'zh-CN',
      domainId: 'dev',
    });

    const text = promptText();
    const numbered = text.indexOf('1. Open an issue');
    expect(numbered).toBeGreaterThan(-1);
    expect(text.indexOf('issue →')).toBeGreaterThan(numbered);
    expect(text).toContain('3. Hello');
    expect(text).toContain('必须使用以下译法');

    const termLines = text.split('\n').filter((l) => l.includes(' → '));
    expect(termLines).toEqual(['issue → “不翻译”', 'repository → 仓库']);
    // 未命中的术语不发送
    expect(text).not.toMatch(/\bPR\b|maintainer/);
  });

  test('本批没有命中术语：请求与不带领域时逐字节相同', async () => {
    fetchMock.mockImplementation(async () => okResp('1. 你好\n2. 世界'));
    const texts = ['Hello', 'World'];
    await route({ texts, from: 'en', to: 'zh-CN' });
    await route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });

    const bodyOf = (i: number) => String((fetchMock.mock.calls[i]![1] as RequestInit).body);
    expect(bodyOf(1)).toBe(bodyOf(0));
    expect(promptText(1)).not.toContain('→');
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
});
