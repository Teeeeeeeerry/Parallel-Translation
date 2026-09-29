/**
 * engines/router.ts — 术语匹配与领域读取的性能（#418）
 *
 * 切入点是 route()：真实领域存储模块，mock 引擎记录收到的术语。断言：
 * 连续翻译不再每次都读领域存储；任一上下文改了领域数据后下一次翻译用
 * 新术语；读取失败不留在缓存里；5000 条术语、一批 15 段在限定时间内
 * 完成且命中的术语正确。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage, fireStorageChange, localStoreSnapshot } from '~/docs/testing/setup';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['openai'],
    useCache: false,
    maxConcurrency: 6,
    models: { openai: 'gpt-4o' },
  })),
}));

type Req = { texts: string[]; terms?: unknown };
const openaiTranslate = vi.fn(async (req: Req) => ({
  translations: req.texts.map((t) => `译:${t}`),
}));
vi.mock('~/src/engines/openai', () => ({
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    requiresKey: true,
    supportedLangs: 'all' as const,
    injectsTerms: true,
    translate: (req: Req) => openaiTranslate(req),
  },
}));

import { route } from '~/src/engines/router';
import { createDomain, setDomainTerms } from '~/src/storage/domains';

/** 读领域数据的次数。 */
function domainReads(): number {
  return vi.mocked(chrome.storage.local.get).mock.calls.filter((c) => c[0] === 'pt-domains').length;
}

const sentTerms = (n: number) => openaiTranslate.mock.calls[n]![0].terms;

beforeEach(() => {
  resetStorage();
  openaiTranslate.mockClear();
});

describe('领域数据缓存在后台内存里（#418）', () => {
  test('连续翻译只读一次领域存储', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    vi.mocked(chrome.storage.local.get).mockClear();

    for (const text of ['a tort claim', 'another tort', 'third tort']) {
      await route({ texts: [text], from: 'en', to: 'zh-CN', domainId: law.id });
    }
    expect(domainReads()).toBe(1);
    expect(sentTerms(2)).toEqual([{ source: 'tort', target: '侵权' }]);
  });

  test('其他页面改了术语：收到变更通知后下一次翻译用新术语', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    const req = { texts: ['a tort claim'], from: 'en', to: 'zh-CN', domainId: law.id };
    await route(req);

    // 设置页直接写存储（不经过本上下文的领域模块），再发出变更通知
    const before = localStoreSnapshot()['pt-domains'] as { user: { terms: unknown[] }[] };
    const after = structuredClone(before);
    after.user[0]!.terms = [{ source: 'tort', target: '侵权行为' }];
    await chrome.storage.local.set({ 'pt-domains': after });
    fireStorageChange({ 'pt-domains': { oldValue: before, newValue: after } }, 'local');

    await route(req);
    expect(sentTerms(1)).toEqual([{ source: 'tort', target: '侵权行为' }]);
  });

  test('读取失败不缓存：这次不带术语，下一次重新读取', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await route({ texts: ['a tort claim'], from: 'en', to: 'zh-CN', domainId: law.id });
    } finally {
      warn.mockRestore();
    }
    expect(sentTerms(0)).toBeUndefined();

    await route({ texts: ['another tort'], from: 'en', to: 'zh-CN', domainId: law.id });
    expect(sentTerms(1)).toEqual([{ source: 'tort', target: '侵权' }]);
  });
});

describe('大量术语的匹配（#418）', () => {
  test('5000 条术语、一批 15 段：限定时间内完成，命中的术语正确', async () => {
    const N = 5000;
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(
      law.id,
      Array.from({ length: N }, (_, i) => ({ source: `term-${i}`, target: `译法 ${i}` })),
    );
    const texts = Array.from(
      { length: 15 },
      (_, i) =>
        `Paragraph ${i} mentions TERM-${i * 300} and term-${i * 300 + 1}x, plus pull requests and ` +
        'other ordinary words to make it look like a paragraph of moderate length on a web page.',
    );

    const start = performance.now();
    await route({ texts, from: 'en', to: 'zh-CN', domainId: law.id });
    const elapsed = performance.now() - start;

    // 大小写不敏感命中 term-0、term-300……；term-1x 这类不在词边界上的不算
    expect(sentTerms(0)).toEqual(
      Array.from({ length: 15 }, (_, i) => ({ source: `term-${i * 300}`, target: `译法 ${i * 300}` })),
    );
    // 旧实现约 5 秒；留出覆盖率插桩与 CI 共享机器的余量
    expect(elapsed).toBeLessThan(2000);
  });
});
