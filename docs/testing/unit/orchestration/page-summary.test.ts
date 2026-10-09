/**
 * orchestration/page-summary.ts — 整页翻译结束后的提示汇总 单元测试
 *
 * 整页翻译的编排入口（togglePage）配真实的渲染器跑一遍，断言外部可观察
 * 的结果：页面上有没有多出译文、有没有打已翻译标记、悬浮球推了什么状态、
 * 汇总提示说了什么。同一时刻只显示一条提示，所以汇总只给出一条。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { PageToggleResult, TranslateItem } from '~/src/orchestration/orchestrator';
import {
  allRenderBlocked,
  countRender,
  emptyRenderStats,
  pageNotice,
  type RenderStats,
} from '~/src/orchestration/page-summary';
import { render } from '~/src/dom/renderer';

beforeEach(() => {
  // 文案取值带上替换参数，数量看得见
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
});

/**
 * 整页翻译走一遍：引擎按 reply 回文字，渲染回调与 content script 同一口径
 * （渲染结果计入统计，全部渲染被拦下时不点亮完成态）。
 */
async function translatePage(
  html: string,
  reply: (text: string) => string,
): Promise<{ root: HTMLElement; result: PageToggleResult; stats: RenderStats; pushes: string[] }> {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  const stats = emptyRenderStats();
  const pushes: string[] = [];
  const orch = createOrchestrator({
    send: vi.fn(async (req: { texts: string[] }) => ({
      ok: true,
      data: { translations: req.texts.map(reply) },
    })),
    hasTranslated: () => root.querySelector('[data-pt="done"]') !== null,
    pushStatus: (s) => pushes.push(s),
    allRenderRejected: () => allRenderBlocked(stats),
    onBatchResult: (_i, batch, res) => {
      if (!res.ok || !res.data) return;
      batch.forEach((item, j) => {
        countRender(stats, render(item.ctx as Element, res.data!.translations[j]!, 'page', item.text));
      });
    },
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  const items: TranslateItem<Element>[] = [...root.querySelectorAll('p, li')].map((el) => ({
    text: el.textContent!,
    ctx: el,
  }));
  const result = await orch.togglePage(items, 'auto', 'zh-CN');
  orch.stop();
  return { root, result, stats, pushes };
}

describe('整页全部命中兜底（#783）', () => {
  test('同语言页面：页面一个字不变，不点亮完成态，也不说“所有段落均含图片/按钮”', async () => {
    const html = '<p>我的H5 我的图文 我的文档</p><ul><li>用途</li><li>行业</li></ul><p>回收站</p>';
    const { root, result, stats, pushes } = await translatePage(html, (t) => t);

    expect(root.innerHTML).toBe(html);
    expect(root.querySelector('[data-pt]')).toBeNull();
    expect(pushes).not.toContain('done');

    // #785：不说“所有段落均含图片/按钮”，而是一条带数量的说明，状态类
    expect(pageNotice(result, stats)).toEqual({ message: 'toastSameAsSource:4', kind: 'info' });
    root.remove();
  });

  test('混合语言页面：译文确实不同的单元照常插入，其余不动，整页算完成', async () => {
    const html = '<p>我的文档</p><p>Recycle bin</p>';
    const { root, result, pushes } = await translatePage(html, (t) =>
      t === 'Recycle bin' ? '回收站' : t,
    );

    expect(result.status).toBe('translated');
    expect(pushes).toContain('done');
    const [zh, en] = root.querySelectorAll('p');
    expect(zh!.outerHTML).toBe('<p>我的文档</p>');
    expect(en!.getAttribute('data-pt')).toBe('done');
    expect(en!.querySelector('.pt-trans')!.textContent).toBe('回收站');
    root.remove();
  });
});

describe('被兜底拦下的单元计入汇总（#785）', () => {
  const translated = (): PageToggleResult =>
    ({ status: 'translated', admission: 'allowed', summary: { display: { showRealReason: false } } }) as PageToggleResult;

  test('整页翻译结束后按数量汇总一条', async () => {
    const html = '<p>我的文档</p><p>回收站</p><p>Recycle bin</p>';
    const { root, result, stats } = await translatePage(html, (t) =>
      t === 'Recycle bin' ? '回收站' : t,
    );
    expect(pageNotice(result, stats)).toEqual({ message: 'toastSameAsSource:2', kind: 'info' });
    root.remove();
  });

  test('数量为零时不因此多弹提示', () => {
    expect(pageNotice(translated(), { ...emptyRenderStats(), succeeded: 4 })).toBeNull();
  });

  test('与“含图片/按钮”并存：给这一条（排在它之上）', () => {
    const stats = { ...emptyRenderStats(), succeeded: 2, rejected: 1, sameAsSource: 3 };
    expect(pageNotice(translated(), stats)).toEqual({ message: 'toastSameAsSource:3', kind: 'info' });
  });

  test('与翻译失败并存：同一时刻只显示一条，失败那条优先', () => {
    const stats = { ...emptyRenderStats(), succeeded: 2, sameAsSource: 3, failed: 1 };
    expect(pageNotice(translated(), stats)).toEqual({ message: 'domainPartialFail:1', kind: 'error' });
    const all = { ...emptyRenderStats(), succeeded: 2, rejected: 1, sameAsSource: 3, failed: 1 };
    expect(pageNotice(translated(), all)).toEqual({ message: 'domainPartialFail:1', kind: 'error' });
  });

  test('没有一段插入译文、其中既有含图片/按钮也有与原文相同的：给这一条，不说“所有段落均含图片/按钮”', () => {
    const result = { status: 'error', admission: 'allowed', summary: { allFailed: false } } as PageToggleResult;
    const stats = { ...emptyRenderStats(), rejected: 1, sameAsSource: 2 };
    expect(pageNotice(result, stats)).toEqual({ message: 'toastSameAsSource:2', kind: 'info' });
  });
});

describe('pageNotice — 既有汇总不变（#49、#416）', () => {
  const translated = (display = { showRealReason: false }): PageToggleResult =>
    ({ status: 'translated', admission: 'allowed', summary: { display } }) as PageToggleResult;

  test('有段落含图片/按钮被拒：按数量汇总一条', () => {
    const stats = { ...emptyRenderStats(), succeeded: 3, rejected: 2 };
    expect(pageNotice(translated(), stats)).toEqual({
      message: 'toastRenderRejected:2',
      kind: 'info',
    });
  });

  test('被拒与失败并存：只给失败那一条（同一时刻只显示一条，失败更需要被看到）', () => {
    const stats = { ...emptyRenderStats(), succeeded: 3, rejected: 2, failed: 1 };
    expect(pageNotice(translated(), stats)).toEqual({
      message: 'domainPartialFail:1',
      kind: 'error',
    });
  });

  test('部分失败且是 key 无效：展示真实原因（#313）', () => {
    const stats = { ...emptyRenderStats(), succeeded: 3, failed: 1 };
    expect(
      pageNotice(translated({ showRealReason: true, reason: 'API key 无效' } as never), stats),
    ).toEqual({ message: 'API key 无效', kind: 'error' });
  });

  test('全部段落含图片/按钮被拒：错误态提示', () => {
    const stats = { ...emptyRenderStats(), rejected: 4 };
    const result = { status: 'error', admission: 'allowed', summary: { allFailed: false } } as PageToggleResult;
    expect(pageNotice(result, stats)).toEqual({ message: 'toastAllRejected', kind: 'error' });
  });

  test('全部引擎失败：泛化文案', () => {
    const result = {
      status: 'error',
      admission: 'allowed',
      summary: { allFailed: true, display: { showRealReason: false } },
    } as PageToggleResult;
    expect(pageNotice(result, { ...emptyRenderStats(), failed: 3 })).toEqual({
      message: 'toastAllEnginesFail',
      kind: 'error',
    });
  });

  test('一切正常：不弹提示', () => {
    expect(pageNotice(translated(), { ...emptyRenderStats(), succeeded: 5 })).toBeNull();
  });

  test('站点被禁用、没有可翻译内容：沿用原有提示', () => {
    const stats = emptyRenderStats();
    expect(pageNotice({ status: 'blocked', admission: 'blocked' } as PageToggleResult, stats)).toEqual({
      message: 'toastSiteBlocked',
      kind: 'error',
    });
    expect(pageNotice({ status: 'no-elements', admission: 'allowed' } as PageToggleResult, stats)).toEqual({
      message: 'hintNoElements',
      kind: 'info',
    });
  });
});
