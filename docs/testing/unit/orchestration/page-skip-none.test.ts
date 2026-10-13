/**
 * 零跳过时不弹跳过提示（#761，规格 #727）
 *
 * 正常页面上不许因为这个功能多出一条提示。反过来，跳过一段也照常弹，不设
 * 最小阈值。
 *
 * 切入点：采集入口 collect、整页翻译的编排入口 togglePage（真实渲染器）与
 * 汇总 pageNotice，提示经真实的提示组件弹出。页面用端到端的全部夹具：其中
 * 只有两张（维基形态、标记密集）有真正超长的段落。
 *
 * 不用“结束时页面上没有提示”这种只看最终状态的断言 —— 它抓不住“弹了一下
 * 又被顶掉”的那一条（#832）。这里从整页翻译开始就记下出现过的每一条提示。
 */
import { describe, test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import {
  allRenderBlocked,
  countRender,
  countSkip,
  emptyRenderStats,
  emptySkipStats,
  pageNotice,
} from '~/src/orchestration/page-summary';
import { render } from '~/src/dom/renderer';
import { toast } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const FIXTURES = 'docs/testing/e2e/fixtures';
/** 有真正超长段落的两张夹具（#735 的维基形态与 #733 的标记密集页）。 */
const WITH_SKIPS = ['wiki-article.html', 'markup-dense.html'];
const NORMAL = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.html') && !WITH_SKIPS.includes(f));

/** 跳过提示的几条文案键。 */
const SKIP_KEYS = ['toastSkipped', 'toastSkippedTooLong', 'toastSkippedTooComplex', 'toastSkippedSiteRule'];

let restore: () => void;
beforeEach(async () => {
  // 文案取值带上替换参数：看得见是哪一条、数量是多少
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
  resetStorage();
  await saveUserSiteRules('localhost', {});
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});
afterAll(() => unmountIsolated('toast'));

/** 载入夹具，与 content script 同一口径整页翻译一遍，返回期间出现过的每一条提示。 */
async function translateFixture(file: string): Promise<string[]> {
  const html = fs.readFileSync(`${FIXTURES}/${file}`, 'utf-8');
  document.body.innerHTML = html.slice(html.search(/<body[^>]*>/i)).replace(/<\/?body[^>]*>/gi, '');

  const seen: string[] = [];
  const record = () => {
    const root = document.getElementById('pt-host-toast')?.shadowRoot;
    for (const el of root?.querySelectorAll('.pt-toast') ?? []) {
      const text = el.textContent ?? '';
      if (seen[seen.length - 1] !== text) seen.push(text);
    }
  };
  const mo = new MutationObserver(record);
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const hostRoot = document.getElementById('pt-host-toast')?.shadowRoot;
  if (hostRoot) mo.observe(hostRoot, { childList: true, subtree: true, characterData: true });

  const stats = emptyRenderStats();
  const skips = emptySkipStats();
  const orch = createOrchestrator({
    send: vi.fn(async (req: { texts: string[] }) => ({
      ok: true,
      data: { translations: req.texts.map((t) => `[译] ${t}`) },
    })),
    hasTranslated: () => document.querySelector('[data-pt="done"]') !== null,
    allRenderRejected: () => allRenderBlocked(stats),
    onBatchResult: (_i, batch, res) => {
      if (!res.ok || !res.data) return;
      batch.forEach((item, j) => {
        countRender(stats, render(item.ctx as Element, res.data!.translations[j]!, 'page', item.text));
      });
    },
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  const result = await orch.togglePage(
    () =>
      collect(document.body, undefined, { onSkip: (_el, c) => countSkip(skips, c) }).map((el) => ({
        text: el.textContent!,
        ctx: el,
      })),
    'auto',
    'zh-CN',
  );
  orch.stop();
  const notice = pageNotice(result, stats, skips);
  if (notice) toast(notice.message, { purpose: 'status', kind: notice.kind });
  record();
  mo.takeRecords();
  mo.disconnect();
  return seen;
}

const isSkipNotice = (text: string) => SKIP_KEYS.includes(text.split(':')[0]!);

describe('零跳过时不弹跳过提示（#761）', () => {
  test.each(NORMAL)('正常页面 %s：整页翻译从头到尾，跳过提示一次都没出现过', async (file) => {
    const seen = await translateFixture(file);
    expect(seen.filter(isSkipNotice)).toEqual([]);
  });
});

describe('跳过一段也照常弹，不设最小阈值（#761 反向）', () => {
  test.each(WITH_SKIPS)('%s：只有一段真正超长，照样弹一条，数量是 1', async (file) => {
    const seen = await translateFixture(file);
    expect(seen.filter(isSkipNotice)).toEqual(['toastSkippedTooLong:1']);
  });
});
