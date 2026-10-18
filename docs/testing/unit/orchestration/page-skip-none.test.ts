/**
 * 零跳过时不弹跳过提示（#761，规格 #727）
 *
 * 正常页面上不许因为这个功能多出一条提示。反过来，跳过一段也照常弹，不设
 * 最小阈值。
 *
 * 切入点：采集入口 collect、整页翻译的编排入口 togglePage（真实渲染器）与
 * 汇总 pageNotice，提示经真实的提示组件弹出。页面用端到端的全部夹具，有段落
 * 进不了采集的几张登记在 WITH_SKIPS 里。
 *
 * 不用“结束时页面上没有提示”这种只看最终状态的断言 —— 它抓不住“弹了一下
 * 又被顶掉”的那一条（#832）。这里从整页翻译开始就记下出现过的每一条提示。
 */
import { describe, test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { createOrchestrator, domPage } from './page-harness';
import {
  emptyRenderStats,
  emptySkipStats,
  pageNotice,
} from '~/src/orchestration/page-summary';
import { toast } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const FIXTURES = 'docs/testing/e2e/fixtures';
/**
 * 有段落进不了采集的夹具，以及整页翻译后那条提示（文案键与数量）：#735 的
 * 维基形态与 #733 的标记密集页各有一段真正超长的；#764 的三张专为跳过提示
 * 而造（多 iframe 的那张在 jsdom 里不加载子框架，只算主文档）。
 */
const WITH_SKIPS: Record<string, string> = {
  'wiki-article.html': 'toastSkippedTooLong:1',
  'markup-dense.html': 'toastSkippedTooLong:1',
  'skip-summary.html': 'toastSkippedTooLong:5',
  'skip-frames.html': 'toastSkippedTooLong:1',
  'skip-frame-child.html': 'toastSkippedTooLong:1',
};
const NORMAL = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.html') && !(f in WITH_SKIPS));

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
  // 上一张夹具的提示还没到点消失（真实定时器），清掉，免得记到下一张头上。
  // 要在清空 body 之前：提示的宿主挂在 body 下，被清掉后会由守护重新挂回来
  document.getElementById('pt-host-toast')?.shadowRoot?.querySelectorAll('.pt-toast').forEach((el) => el.remove());
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

  const orch = createOrchestrator({
    send: vi.fn(async (req: { texts: string[] }) => ({
      ok: true,
      data: { translations: req.texts.map((t) => `[译] ${t}`) },
    })),
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  // 与 content 同一口径的整页翻译会话（#1077、#1078）：首轮与补采集共用，同一元素只交出一次、跳过只计一次
  const page = domPage();
  const result = await orch.togglePage(
    page,
    'auto',
    'zh-CN',
  );
  orch.stop();
  const notice = pageNotice(result, page.current()?.totals() ?? emptyRenderStats(), page.current()?.skips() ?? emptySkipStats());
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
  test.each(Object.entries(WITH_SKIPS))('%s：照样弹一条，就是 %s', async (file, expected) => {
    const seen = await translateFixture(file);
    expect(seen.filter(isSkipNotice)).toEqual([expected]);
  });
});
