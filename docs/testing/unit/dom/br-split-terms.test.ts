/**
 * 以 br 分行的超长段落：术语与当前领域在每一行里照常生效（#715，规格 #694）
 *
 * 术语替换按送翻的文本做（#524：机翻引擎换成占位符、回填为领域给的译法或
 * 原词）。切成行之后每一行各自是一条送翻文本，所以要确认：
 * - 每一行送翻时都带上当前领域；
 * - 命中的术语按领域给的译法出现在该行译文里；
 * - 标为“不翻译”的术语在该行译文里保持原词；
 * - 原词正好横跨两行（中间隔着 br）时现在会怎样 —— 结论见最后一组用例。
 *
 * 切入点从采集一直走到渲染：采集入口 collect、整页翻译的编排入口（带上
 * 领域列表与站点，与 content script 同一口径选出当前领域）、真实的 router
 * 与 google-web 引擎（只替身 fetch，回显查询文本）、真实渲染器，以及还原。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Domain, Term } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

vi.mock('~/src/storage/settings', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/src/storage/settings')>();
  return {
    ...real,
    getSettings: vi.fn(() => ({
      ...real.getSettings(),
      enginePriority: ['google-web'],
      useCache: false,
      mtApplyTermTargets: true,
    })),
  };
});

let terms: Term[] = [];
const domain = (): Domain => ({
  id: 'user:dev', name: 'dev', targetLang: 'zh-CN', sites: ['forum.example'], origin: 'user', terms,
});
vi.mock('~/src/storage/domains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/storage/domains')>()),
  getCachedEffectiveDomains: vi.fn(async (): Promise<Domain[]> => [domain()]),
}));

import { route } from '~/src/engines/router';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { render } from '~/src/dom/renderer';
import { restorePreserves } from '~/src/dom/text';
import type { TranslateRequest } from '~/src/engines/types';
import { brLines, collectUnits, isOverLimit, line, restorePage } from './br-split-harness';
import { translateItems } from '../orchestration/page-harness';

const N = 60;

let fetchMock: ReturnType<typeof vi.fn>;
/** 发给 Google 的全部查询文本（一条送翻文本一个请求）。 */
const queries = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('q') ?? '');

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetStorage();
  terms = [
    { source: 'pull request', target: '拉取请求' },
    { source: 'monorepo', noTranslate: true },
  ];
  fetchMock = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    return new Response(JSON.stringify([[[`译:${q}`]]]), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = '';
});

/**
 * 整页翻译一遍：采集、编排入口带着领域列表与站点送翻（经真实 router）、
 * 回填占位符后渲染。返回每个请求带的领域。
 */
async function translatePage(): Promise<{ domainIds: (string | undefined)[] }> {
  const { units, texts, preserves } = collectUnits();
  const domainIds: (string | undefined)[] = [];
  const orch = createOrchestrator({
    send: vi.fn(async (req: TranslateRequest) => {
      domainIds.push(req.domainId);
      return { ok: true, data: await route(req) };
    }),
    getDomains: () => [domain()],
    getHostname: () => 'forum.example',
  });
  orch.start();
  await translateItems(orch, units.map((el, i) => ({ text: texts[i]!, ctx: el })),
    'auto',
    'zh-CN',
    {
      onBatch: (batch, res) => {
        if (!res.ok || !res.data) return;
        batch.forEach((item, j) => {
          const map = preserves[units.indexOf(item.ctx as Element)]!;
          render(
            item.ctx as Element,
            restorePreserves(res.data!.translations[j]!, map, item.text),
            'page',
            restorePreserves(item.text, map, item.text),
          );
        });
      },
    },
  );
  orch.stop();
  return { domainIds };
}

/** 每一行（切块）的译文。 */
const lineTranslations = () =>
  [...document.querySelectorAll('#post > .pt-chunk[data-pt="done"]')].map((c) =>
    (c.querySelector(':scope > .pt-trans')!.textContent ?? '').trim(),
  );

/** 第 k 行换成 special[k]，其余是普通对话。 */
const post = (special: Record<number, string>) =>
  `<p id="post">${brLines(N, '<br>\n', (i) => special[i] ?? line(i))}</p>`;

describe('每一行照常带上当前领域、应用术语（#715）', () => {
  test('每个请求都带上当前领域：网址命中的那个领域', async () => {
    document.body.innerHTML = post({});
    expect(isOverLimit(document.getElementById('post')!)).toBe(true);
    const { domainIds } = await translatePage();
    expect(domainIds.length).toBeGreaterThan(0);
    expect(domainIds.every((id) => id === 'user:dev')).toBe(true);
    // 60 行各自一条查询
    expect(queries()).toHaveLength(N);
  });

  test('命中的术语在那一行送出去时换成占位符，译文里是领域给的译法', async () => {
    document.body.innerHTML = post({ 3: 'Line 3: she opened a pull request before dinner.' });
    await translatePage();
    expect(queries()[3]!.trim()).toBe('Line 3: she opened a ⟦TM0⟧ before dinner.');
    expect(lineTranslations()[3]).toBe('译:Line 3: she opened a 拉取请求 before dinner.');
  });

  test('标为不翻译的术语在那一行译文里保持原词', async () => {
    document.body.innerHTML = post({ 5: 'Line 5: the Monorepo was too large to clone.' });
    await translatePage();
    expect(queries()[5]!.trim()).toBe('Line 5: the ⟦TM0⟧ was too large to clone.');
    expect(lineTranslations()[5]).toBe('译:Line 5: the Monorepo was too large to clone.');
  });

  test('同一个术语出现在好几行：每一行各自编号、各自回填', async () => {
    const special = Object.fromEntries(
      [10, 20, 30].map((k) => [k, `Line ${k}: another pull request and the monorepo again.`]),
    );
    document.body.innerHTML = post(special);
    await translatePage();
    for (const k of [10, 20, 30]) {
      expect(queries()[k]!.trim()).toBe(`Line ${k}: another ⟦TM0⟧ and the ⟦TM1⟧ again.`);
      expect(lineTranslations()[k]).toBe(`译:Line ${k}: another 拉取请求 and the monorepo again.`);
    }
  });
});

describe('原词横跨两行：整段单元把换行当空白，切块仍是已知限制（#715、#952）', () => {
  /**
   * 结论：原词正好被 br 断在两行时，术语不命中 —— 这一行送出去的只有前半个
   * 词，下一行只有后半个词，两条送翻文本里都没有完整的原词。这不是切行带来
   * 的新问题：长度没超上限、整段一个单元的 br 段落里，br 作为换行带出去
   * （#840），原词中间是换行而不是空格，术语匹配把该换行视作空白而命中。
   * 按行切块没有完整原词，仍是已知限制；不能让切块内核依赖领域术语。
   */
  test('超长段落按行切开：前一行以 pull 结尾、后一行以 request 开头，两行都不替换', async () => {
    document.body.innerHTML = post({
      40: 'Line 40: before leaving she opened a pull',
      41: 'request and closed the laptop.',
    });
    await translatePage();
    expect(queries()[40]!.trim()).toBe('Line 40: before leaving she opened a pull');
    expect(queries()[41]!.trim()).toBe('request and closed the laptop.');
    expect(lineTranslations()[40]).not.toContain('拉取请求');
    expect(lineTranslations()[41]).not.toContain('拉取请求');
  });

  test('没超上限、整段一个单元的 br 段落：原词中间换行按空白命中', async () => {
    document.body.innerHTML = '<p id="short">She opened a pull<br>request and closed the laptop.</p>';
    const { texts } = collectUnits();
    expect(texts).toEqual(['She opened a pull\nrequest and closed the laptop.']);
    const resp = await route({ texts, from: 'en', to: 'zh-CN', domainId: 'user:dev' });
    expect(queries()).toEqual(['She opened a ⟦TM0⟧ and closed the laptop.']);
    expect(resp.translations[0]).toContain('拉取请求');
  });

  test('对照：同一句不断行时照常替换（失配只因为 br，不是这句话本身）', async () => {
    document.body.innerHTML = post({ 40: 'Line 40: before leaving she opened a pull request and closed the laptop.' });
    await translatePage();
    expect(queries()[40]!.trim()).toBe('Line 40: before leaving she opened a ⟦TM0⟧ and closed the laptop.');
  });

  test('单词与跨三行的原词保持原有行为', async () => {
    terms = [{ source: 'monorepo', noTranslate: true }];
    const resp = await route({ texts: ['A monorepo.', 'mono\nrepo\nnow'], from: 'en', to: 'zh-CN', domainId: 'user:dev' });
    expect(resp.translations[0]).toContain('monorepo');
    expect(resp.translations[1]).toBe('译:mono\nrepo\nnow');
  });
});

describe('还原之后逐字节回到原样（#715）', () => {
  test('术语命中的几行翻译之后还原：段落 HTML 与翻译前一字不差', async () => {
    document.body.innerHTML = post({
      3: 'Line 3: she opened a pull request before dinner.',
      5: 'Line 5: the <b>monorepo</b> was too large to clone.',
      40: 'Line 40: before leaving she opened a pull',
      41: 'request and closed the laptop.',
    });
    const before = document.body.innerHTML;
    await translatePage();
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(N);
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
