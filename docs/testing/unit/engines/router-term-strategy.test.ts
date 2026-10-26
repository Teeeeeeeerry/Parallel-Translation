/**
 * 术语策略（#1155）：引擎只声明处理方式，路由按策略处理术语
 *
 * 切入点是 route()：真实领域存储与缓存模块，三个假引擎分别声明 'mask'、
 * 'inject' 与不声明。断言引擎收到的文字与术语、回填的译文、缓存是否命中：
 * “不翻译”占位符替换与还原、指定译法开关、AI 注入、占位符被改坏后用原文重译、
 * 改了与本引擎无关的术语时缓存照常命中。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import type { TranslateRequest } from '~/src/engines/types';

let enginePriority = ['mt'];
let mtApplyTermTargets = false;
vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({ enginePriority, useCache: true, models: {}, mtApplyTermTargets })),
}));

import { route } from '~/src/engines/router';
import type { EngineTable } from '~/src/engines/registry';
import { createDomain, setDomainTerms } from '~/src/storage/domains';
import { termStrategy } from '~/src/engines/term-strategy';

/** 假引擎：记下收到的请求，按 reply 改写每段文字。 */
function fakeEngine(id: string, termHandling?: 'mask' | 'inject') {
  const calls: TranslateRequest[] = [];
  let reply = (t: string) => `译:${t}`;
  const engine = {
    id,
    displayName: id,
    requiresKey: false,
    supportedLangs: 'all' as const,
    ...(termHandling && { termHandling }),
    translate: async (req: TranslateRequest) => {
      calls.push(req);
      return { translations: req.texts.map((t) => reply(t)) };
    },
  };
  return { engine, calls, setReply: (f: (t: string) => string) => (reply = f) };
}

let mt: ReturnType<typeof fakeEngine>;
let ai: ReturnType<typeof fakeEngine>;
let plain: ReturnType<typeof fakeEngine>;
let engines: EngineTable;
let domainId: string;

beforeEach(async () => {
  resetStorage();
  enginePriority = ['mt'];
  mtApplyTermTargets = false;
  mt = fakeEngine('mt', 'mask');
  ai = fakeEngine('ai', 'inject');
  plain = fakeEngine('plain');
  engines = { mt: mt.engine, ai: ai.engine, plain: plain.engine } as unknown as EngineTable;
  domainId = (await createDomain({ name: 'dev', targetLang: 'zh-CN' })).id;
  await setDomainTerms(domainId, [
    { source: 'Kubernetes', noTranslate: true },
    { source: 'repository', target: '仓库' },
  ]);
});

const req = (text: string) => ({ texts: [text], from: 'en', to: 'zh-CN', domainId });

describe('占位符落实（mask）', () => {
  test('“不翻译”术语换成占位符发送，回来换回原词；指定译法的术语默认原样发送', async () => {
    const r = await route(req('Kubernetes repository'), engines);
    expect(mt.calls[0]!.texts).toEqual(['⟦TM0⟧ repository']);
    expect(mt.calls[0]!.terms).toBeUndefined();
    expect(r.translations).toEqual(['译:Kubernetes repository']);
  });

  test('“指定译法”开关打开：指定了译法的术语也换成占位符，回填为指定译法', async () => {
    mtApplyTermTargets = true;
    const r = await route(req('Kubernetes repository'), engines);
    expect(mt.calls[0]!.texts).toEqual(['⟦TM0⟧ ⟦TM1⟧']);
    expect(r.translations).toEqual(['译:Kubernetes 仓库']);
  });

  test('占位符被改坏：这一段改用原文、不带术语重译一次', async () => {
    mt.setReply((t) => (t.includes('⟦') ? t.replace('⟦TM0⟧', 'TM0') : `重译:${t}`));
    const r = await route(req('Kubernetes cluster'), engines);
    expect(mt.calls).toHaveLength(2);
    expect(mt.calls[1]!.texts).toEqual(['Kubernetes cluster']);
    expect(mt.calls[1]!.terms).toBeUndefined();
    expect(r.translations).toEqual(['重译:Kubernetes cluster']);
  });

  test('改了只影响指定译法的术语（开关关闭时不生效）：缓存照常命中', async () => {
    await route(req('Kubernetes repository'), engines);
    await setDomainTerms(domainId, [
      { source: 'Kubernetes', noTranslate: true },
      { source: 'repository', target: '代码库' },
    ]);
    await route(req('Kubernetes repository'), engines);
    expect(mt.calls).toHaveLength(1);
  });
});

describe('注入提示词（inject）', () => {
  test('本批命中的术语随请求带给引擎，文字原样；改任一命中术语都不再命中缓存', async () => {
    enginePriority = ['ai'];
    await route(req('Kubernetes repository'), engines);
    expect(ai.calls[0]!.texts).toEqual(['Kubernetes repository']);
    expect(ai.calls[0]!.terms).toEqual([
      { source: 'Kubernetes', noTranslate: true },
      { source: 'repository', target: '仓库' },
    ]);
    await setDomainTerms(domainId, [
      { source: 'Kubernetes', noTranslate: true },
      { source: 'repository', target: '代码库' },
    ]);
    await route(req('Kubernetes repository'), engines);
    expect(ai.calls).toHaveLength(2);
  });
});

describe('不处理术语（未声明）', () => {
  test('文字原样、不带术语；改术语不影响缓存', async () => {
    enginePriority = ['plain'];
    await route(req('Kubernetes repository'), engines);
    expect(plain.calls[0]!.texts).toEqual(['Kubernetes repository']);
    expect(plain.calls[0]!.terms).toBeUndefined();
    await setDomainTerms(domainId, [{ source: 'Kubernetes', target: 'K8s' }]);
    await route(req('Kubernetes repository'), engines);
    expect(plain.calls).toHaveLength(1);
  });
});

describe('策略本身', () => {
  const hits = [
    { source: 'a', noTranslate: true },
    { source: 'b', target: 'B' },
  ];
  test('参与缓存键的生效术语与开关', () => {
    expect(termStrategy(undefined).effectiveTerms(hits, true)).toEqual([]);
    expect(termStrategy('inject').effectiveTerms(hits, false)).toEqual(hits);
    expect(termStrategy('mask').effectiveTerms(hits, false)).toEqual([hits[0]]);
    expect(termStrategy('mask').effectiveTerms(hits, true)).toEqual(hits);
    expect(termStrategy('mask').keyFlag(true)).toBe(true);
    expect(termStrategy('inject').keyFlag(true)).toBe(false);
  });
});
