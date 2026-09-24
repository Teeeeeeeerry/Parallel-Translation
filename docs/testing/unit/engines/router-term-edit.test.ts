/**
 * engines/router.ts — 设置页改了术语后立即生效（#393）
 *
 * 切入点是 route()：真实领域存储与缓存模块，mock 引擎记录收到的术语。
 * 断言保存术语后下一次翻译带上新术语、不命中改之前的缓存。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['openai'],
    useCache: true,
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
    translate: (req: Req) => openaiTranslate(req),
  },
}));

import { route } from '~/src/engines/router';
import { createDomain, setDomainTerms } from '~/src/storage/domains';

beforeEach(() => {
  resetStorage();
  openaiTranslate.mockClear();
});

describe('术语修改立即生效（#393）', () => {
  test('改了译法：下一次翻译带新术语，不命中旧缓存', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    const req = { texts: ['a tort claim'], from: 'en', to: 'zh-CN', domainId: law.id };

    await route(req);
    await route(req);
    expect(openaiTranslate).toHaveBeenCalledTimes(1);
    expect(openaiTranslate.mock.calls[0]![0].terms).toEqual([{ source: 'tort', target: '侵权' }]);

    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权行为' }]);
    await route(req);
    expect(openaiTranslate).toHaveBeenCalledTimes(2);
    expect(openaiTranslate.mock.calls[1]![0].terms).toEqual([{ source: 'tort', target: '侵权行为' }]);
  });

  test('删掉术语：下一次翻译不再带术语', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', noTranslate: true }]);
    const req = { texts: ['a tort claim'], from: 'en', to: 'zh-CN', domainId: law.id };
    await route(req);

    await setDomainTerms(law.id, []);
    await route(req);
    expect(openaiTranslate).toHaveBeenCalledTimes(2);
    expect(openaiTranslate.mock.calls[1]![0].terms).toBeUndefined();
  });
});
