/**
 * engines/router.ts — 机翻引擎的术语占位符替换（#524）
 *
 * 切入点是 route()：真实 router + 真实 google-web 引擎，只 stub fetch。
 * 断言发给 Google 的查询文本（占位符位置与编号）和回填后的译文：重叠
 * 术语长的优先、先开始的术语优先、同一术语多次出现、中日韩边缘、大小写
 * 不同的出现（含按大小写折叠命中的）、原文自带占位符样式时不替换；每段
 * 命中上百条术语时在限定时间内完成。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain, Term } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['google-web'],
    useCache: false,
    maxConcurrency: 6,
    models: {},
    mtApplyTermTargets: true,
  })),
}));

let terms: Term[] = [];
vi.mock('~/src/storage/domains', () => ({
  getCachedEffectiveDomains: vi.fn(async (): Promise<Domain[]> => [
    { id: 'dev', name: 'dev', targetLang: 'zh-CN', sites: [], origin: 'user', terms },
  ]),
}));

import { route } from '~/src/engines/router';

let fetchMock: ReturnType<typeof vi.fn>;

/** 发给 Google 的全部查询文本。 */
function queries(): string[] {
  return fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q') ?? '');
}

function translate(texts: string[]) {
  return route({ texts, from: 'en', to: 'zh-CN', domainId: 'dev' });
}

beforeEach(() => {
  resetStorage();
  terms = [];
  fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    return new Response(JSON.stringify([[[`译:${q}`]]]), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('占位符的位置与编号', () => {
  test('重叠的术语长的优先，与术语在领域里的顺序无关', async () => {
    terms = [
      { source: 'request', noTranslate: true },
      { source: 'pull request', target: '拉取请求' },
    ];
    const resp = await translate(['Open a pull request, then answer the request']);
    expect(queries()).toEqual(['Open a ⟦TM0⟧, then answer the ⟦TM1⟧']);
    expect(resp.translations).toEqual(['译:Open a 拉取请求, then answer the request']);
  });

  test('先开始的术语优先，与它重叠的后一条不替换', async () => {
    terms = [
      { source: 'pull request', noTranslate: true },
      { source: 'open pull', noTranslate: true },
    ];
    await translate(['open pull request']);
    expect(queries()).toEqual(['⟦TM0⟧ request']);
  });

  test('同一术语多次出现、大小写不同：从左到右编号，各自回填为原文', async () => {
    terms = [{ source: 'issue', noTranslate: true }];
    const resp = await translate(['Issue, ISSUE and issue']);
    expect(queries()).toEqual(['⟦TM0⟧, ⟦TM1⟧ and ⟦TM2⟧']);
    expect(resp.translations).toEqual(['译:Issue, ISSUE and issue']);
  });

  test('同一术语的出现位置互相重叠：只替换靠前的一处', async () => {
    terms = [{ source: 'a-a', noTranslate: true }];
    await translate(['x a-a-a']);
    expect(queries()).toEqual(['x ⟦TM0⟧-a']);
  });

  test('拉丁字母原词只替换整词的出现，词内的不替换', async () => {
    terms = [{ source: 'PR', target: '拉取请求' }];
    const resp = await translate(['prices of a PR']);
    expect(queries()).toEqual(['prices of a ⟦TM0⟧']);
    expect(resp.translations).toEqual(['译:prices of a 拉取请求']);
  });

  test('紧挨代理对字母（𝐀）的拉丁字母原词不算整词，不替换', async () => {
    terms = [{ source: 'PR', noTranslate: true }];
    await translate(['𝐀PR and a PR']);
    expect(queries()).toEqual(['𝐀PR and a ⟦TM0⟧']);
  });

  test('中日韩边缘：中文一侧按子串，拉丁字母一侧按整词', async () => {
    terms = [
      { source: '集群', noTranslate: true },
      { source: 'PR', noTranslate: true },
      { source: 'K8s 节点', noTranslate: true },
    ];
    await translate(['K8s集群化，打开PR页面；EK8s 节点、K8s 节点池']);
    expect(queries()).toEqual(['K8s⟦TM0⟧化，打开⟦TM1⟧页面；EK8s 节点、⟦TM2⟧池']);
  });

  test('按大小写折叠命中的出现（长 s 写法“ſ”）也回填指定译法，不退回原文', async () => {
    terms = [{ source: 'Congress', target: '国会' }];
    const resp = await translate(['the Congreſs of 1787']);
    expect(queries()).toEqual(['the ⟦TM0⟧ of 1787']);
    expect(resp.translations).toEqual(['译:the 国会 of 1787']);
  });

  test('原文里本来就有占位符样式的文字：不替换', async () => {
    terms = [{ source: 'issue', noTranslate: true }];
    await translate(['literal ⟦TM0⟧ next to an issue']);
    expect(queries()).toEqual(['literal ⟦TM0⟧ next to an issue']);
  });
});

describe('大量命中', () => {
  test('一批 15 段、每段命中 300 条术语：限定时间内完成，占位符编号与回填正确', async () => {
    const N = 1000;
    const HITS = 300;
    terms = Array.from({ length: N }, (_, i) =>
      i % 2 ? { source: `term-${i}`, target: `译法${i}` } : { source: `term-${i}`, noTranslate: true },
    );
    // 各段命中的术语各不相同，与真实页面一样（命中相同时 V8 会复用编译好的正则）
    const termOf = (p: number, k: number) => (p * 61 + k) % N;
    const texts = Array.from({ length: 15 }, (_, p) =>
      Array.from({ length: HITS }, (_, k) => `see term-${termOf(p, k)} here`).join('. '),
    );

    const start = performance.now();
    const resp = await translate(texts);
    const elapsed = performance.now() - start;

    const sent = queries().join('\n');
    for (let k = 0; k < HITS; k++) expect(sent).toContain(`see ⟦TM${k}⟧ here`);
    expect(sent).not.toMatch(/term-\d/);
    const filled = Array.from({ length: HITS }, (_, k) => {
      const i = termOf(14, k);
      return `see ${i % 2 ? `译法${i}` : `term-${i}`} here`;
    });
    expect(resp.translations[14]).toBe(`译:${filled.join('. ')}`);
    // 旧实现每段现编合并正则，本机约 3 秒（新实现约 120 毫秒）；留出覆盖率插桩与 CI 共享机器的余量
    expect(elapsed).toBeLessThan(2000);
  });
});
