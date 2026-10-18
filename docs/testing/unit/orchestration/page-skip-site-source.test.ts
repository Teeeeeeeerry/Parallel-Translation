/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * GitHub 页面整页翻译不因内置规则的排除弹跳过提示（#922，父 #727）
 *
 * 内置规则排除的文件名列、代码行不计入跳过，仓库首页与代码文件页整页翻译
 * 从头到尾不出现跳过提示（#761 的验收：正常页面上不许因为这个功能多出一条
 * 提示）。用户自己写的排除照常计入，提示照常出现、数字对得上。
 *
 * 切入点与 #761 相同：采集入口 collect、整页翻译的编排入口 togglePage（真实
 * 渲染器）与汇总 pageNotice，提示经真实的提示组件弹出；从整页翻译开始就记下
 * 出现过的每一条提示（#832），不只看最终状态。
 *
 * 端到端的夹具由 localhost 提供，命中不了 github.com 的内置规则；页面 URL 在
 * jsdom 里是文件级选项，所以这几条单独成文件。
 */
import { describe, test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
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

/** 仓库首页：文件列表的文件名列、侧栏贡献者网格被内置规则排除。 */
const REPO_HOME = `
  <table><tbody>
    ${['docs', 'src', 'tests', 'scripts', 'README.md', 'LICENSE', 'package.json', 'CHANGELOG.md']
      .map(
        (f, i) =>
          `<tr><td class="react-directory-filename-column"><a href="/a/b/blob/main/${f}">${f}</a></td>` +
          `<td class="react-directory-commit-message"><a href="/a/b/commit/${i}">Update the ${f} entry for the release</a></td></tr>`,
      )
      .join('')}
  </tbody></table>
  <div class="BorderGrid"><div class="BorderGrid-cell"><p>Claude Code is an agentic coding tool.</p></div></div>
  <article class="markdown-body"><h2>Installation</h2><p>Run the installer and follow the prompts on screen.</p></article>`;

/** 代码文件页：每行代码被内置规则排除。 */
const BLOB = `
  <table>${Array.from({ length: 30 }, (_, i) => `<tr><td class="blob-num">${i + 1}</td><td class="blob-code blob-code-inner">const value${i} = compute(${i});</td></tr>`).join('')}</table>
  <p>This file is part of the public API.</p>`;

/** 用户自己写的排除命中的三段。 */
const SPONSORED = [1, 2, 3].map((i) => `<p class="sponsor">Sponsored paragraph number ${i} from partners.</p>`).join('');

/** 跳过提示的几条文案键。 */
const SKIP_KEYS = ['toastSkipped', 'toastSkippedTooLong', 'toastSkippedTooComplex', 'toastSkippedSiteRule'];
const isSkipNotice = (text: string) => SKIP_KEYS.includes(text.split(':')[0]!);

let restore: () => void;
beforeEach(async () => {
  // 文案取值带上替换参数：看得见是哪一条、数量是多少
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
  resetStorage();
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  // 提示的宿主挂在 body 下，要在清空 body 之前清掉（#761）
  document.getElementById('pt-host-toast')?.shadowRoot?.querySelectorAll('.pt-toast').forEach((el) => el.remove());
  restore();
  document.body.innerHTML = '';
});
afterAll(() => unmountIsolated('toast'));

/** 放入页面，与 content script 同一口径整页翻译一遍，返回期间出现过的每一条提示。 */
async function translatePage(html: string): Promise<string[]> {
  document.body.innerHTML = html;

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

describe('内置规则的排除不弹跳过提示（#922）', () => {
  test('仓库首页：整页翻译从头到尾，跳过提示一次都没出现过', async () => {
    expect((await translatePage(REPO_HOME)).filter(isSkipNotice)).toEqual([]);
  });

  test('代码文件页：整页翻译从头到尾，跳过提示一次都没出现过', async () => {
    expect((await translatePage(BLOB)).filter(isSkipNotice)).toEqual([]);
  });
});

describe('用户规则的排除照常弹（#922 反向）', () => {
  test('用户排除了三段：弹“被站点规则排除”那一条，数字是 3', async () => {
    await saveUserSiteRules('github.com', { exclude: ['.sponsor'] });
    await siteRulesReady();
    expect((await translatePage(REPO_HOME + SPONSORED)).filter(isSkipNotice)).toEqual(['toastSkippedSiteRule:3']);
  });
});
