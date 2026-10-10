/**
 * 输入翻译不走翻译缓存（#642）—— 编排模块的单文本入口接上真实的引擎路由
 * 与真实的缓存模块，数缓存条数。
 *
 * 阅读侧三条入口（整页、逐段、划词）照常先查后写；输入翻译声明 noCache，
 * 既不查也不写。发出去的句子几乎不会重复，缓存只会挤占阅读侧的额度。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import { route } from '~/src/engines/router';
import type { TranslateRequest } from '~/src/engines/types';

vi.mock('~/src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/settings')>()),
  getSettings: vi.fn(() => ({
    enginePriority: ['google-web'],
    useCache: true,
    mtApplyTermTargets: false,
  })),
}));

const engineCalls: string[][] = [];
vi.mock('~/src/engines/google-web', () => ({
  googleWeb: {
    id: 'google-web',
    displayName: 'Google 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    translate: async (req: TranslateRequest) => {
      engineCalls.push(req.texts);
      return { translations: req.texts.map((t) => `译:${t}`) };
    },
  },
}));

/** 缓存里的译文条数。 */
function cacheEntries(): number {
  return Object.keys(localStoreSnapshot()).filter((k) => k.startsWith('pt-c:')).length;
}

/** 引擎实际收到的段数（缓存命中的段不到引擎）。 */
function engineTexts(): number {
  return engineCalls.flat().length;
}

function setup() {
  const orch = createOrchestrator({
    send: async (req) => ({ ok: true, data: await route(req) }),
  });
  orch.start();
  return orch;
}

const items = (texts: string[]): TranslateItem<number>[] => texts.map((text, i) => ({ text, ctx: i }));

beforeEach(() => {
  resetStorage();
  engineCalls.length = 0;
});

describe('阅读侧三条入口的缓存行为不变', () => {
  test('整页翻译：每段写一条，再翻一次全部命中缓存、引擎一段也收不到', async () => {
    const orch = setup();
    await orch.translatePage(items(['First paragraph', 'Second paragraph']), 'en', 'zh-CN');
    expect(cacheEntries()).toBe(2);
    expect(engineTexts()).toBe(2);

    await orch.translatePage(items(['First paragraph', 'Second paragraph']), 'en', 'zh-CN');
    expect(cacheEntries()).toBe(2);
    expect(engineTexts()).toBe(2);
  });

  test('逐段翻译：写一条，同一段再翻命中缓存', async () => {
    const orch = setup();
    const first = await orch.translateText('A paragraph', 'en', 'zh-CN', { recordDetectedLang: true });
    expect(first).toMatchObject({ ok: true, translation: '译:A paragraph' });
    expect(cacheEntries()).toBe(1);

    const again = await orch.translateText('A paragraph', 'en', 'zh-CN', { recordDetectedLang: true });
    expect(again).toMatchObject({ ok: true, translation: '译:A paragraph' });
    expect(cacheEntries()).toBe(1);
    expect(engineTexts()).toBe(1);
  });

  test('划词翻译：写一条，同一段再翻命中缓存', async () => {
    const orch = setup();
    await orch.translateText('A selection', 'en', 'zh-CN');
    expect(cacheEntries()).toBe(1);

    await orch.translateText('A selection', 'en', 'zh-CN');
    expect(cacheEntries()).toBe(1);
    expect(engineTexts()).toBe(1);
  });
});

describe('输入翻译既不写缓存也不读缓存', () => {
  test('一次输入翻译之后缓存条数不增加', async () => {
    const orch = setup();
    await orch.translatePage(items(['Already cached']), 'en', 'zh-CN');
    expect(cacheEntries()).toBe(1);

    const r = await orch.translateText('我写的一段话', 'auto', 'en', { noCache: true });
    expect(r).toMatchObject({ ok: true, translation: '译:我写的一段话' });
    expect(cacheEntries()).toBe(1);
  });

  test('缓存里已有同一段同一语言对的译文，输入翻译也不读它，照常发给引擎', async () => {
    const orch = setup();
    await orch.translateText('Same words', 'auto', 'en');
    expect(engineTexts()).toBe(1);

    await orch.translateText('Same words', 'auto', 'en', { noCache: true });
    expect(engineTexts()).toBe(2);
    expect(cacheEntries()).toBe(1);
  });

  test('同一段文字先走输入翻译再走划词翻译，划词那次照常写缓存', async () => {
    const orch = setup();
    await orch.translateText('Shared text', 'auto', 'zh-CN', { noCache: true });
    expect(cacheEntries()).toBe(0);

    await orch.translateText('Shared text', 'auto', 'zh-CN');
    expect(cacheEntries()).toBe(1);
    expect(engineTexts()).toBe(2);
  });
});
