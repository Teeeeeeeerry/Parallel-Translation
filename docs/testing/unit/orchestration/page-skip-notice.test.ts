/**
 * 整页翻译结束后，有被跳过的单元就弹一条带数量的提示（#758，规格 #727）
 *
 * 沿用 #49 定下的风格：结束后一条，给出数量，不逐段刷屏。用户看到之后知道
 * 这一页确实有内容没翻，不是自己的错觉。提示本身不改变翻译行为。
 *
 * 切入点：采集入口 collect 报出跳过，整页翻译的编排入口（togglePage）配
 * 真实的渲染器跑一遍，汇总（pageNotice）给出那一条提示。只看外部可观察的
 * 行为：提示的文字与数量、发了哪些请求、页面上插了哪些译文。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { createPageCollector } from '~/src/dom/page-collect';
import { collect } from '~/src/dom/walker';
import { createOrchestrator, type PageToggleResult } from '~/src/orchestration/orchestrator';
import {
  allRenderBlocked,
  countRender,
  countSkip,
  emptyRenderStats,
  emptySkipStats,
  pageNotice,
} from '~/src/orchestration/page-summary';
import { render } from '~/src/dom/renderer';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const tooLong = (id: string) => `<p id="${id}">${'This sentence keeps going on and on. '.repeat(100)}</p>`;
const NORMAL = '<p id="a">A normal paragraph with some words.</p><p id="b">Another normal paragraph here.</p>';

let restore: () => void;
beforeEach(async () => {
  // 文案取值带上替换参数，数量看得见
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

/**
 * 整页翻译走一遍，与 content script 同一口径：整页那一次采集计入跳过，渲染
 * 结果计入统计。countSkips 为 false 时不接统计（改动前的样子）。
 */
async function translatePage(html: string, { countSkips = true } = {}) {
  document.body.innerHTML = html;
  const stats = emptyRenderStats();
  const skips = emptySkipStats();
  const send = vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: { translations: req.texts.map((t) => `[译] ${t}`) },
  }));
  const orch = createOrchestrator({
    send,
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
  // 与 content 同一个采集器（#1011）：首轮与补采集共用，同一元素只交出一次、跳过只计一次
  const page = createPageCollector(
    (onSkip) => collect(document.body, undefined, { onSkip }),
    countSkips ? (_el, c) => countSkip(skips, c) : undefined,
  );
  const result: PageToggleResult = await orch.togglePage(
    () => page().map((el) => ({ text: el.textContent!, ctx: el })),
    'auto',
    'zh-CN',
  );
  orch.stop();
  return { result, notice: pageNotice(result, stats, skips), send, page: document.body.innerHTML };
}

describe('有被跳过的单元时弹一条带数量的提示（#758）', () => {
  test('两段超长没被采集：整页翻译照常完成，结束后一条“另有 2 段”', async () => {
    const { result, notice } = await translatePage(NORMAL + tooLong('l1') + tooLong('l2'));
    expect(result.status).toBe('translated');
    expect(notice?.message.split(':').slice(-1)[0]).toBe('2');
    expect(notice?.kind).toBe('info');
  });

  test('只弹一条：二十段被跳过也只是一条，数量是 20', async () => {
    const html = NORMAL + Array.from({ length: 20 }, (_, i) => tooLong(`l${i}`)).join('');
    const { notice } = await translatePage(html);
    expect(notice).not.toBeNull();
    expect(notice!.message.split(':').slice(-1)[0]).toBe('20');
  });

  test('整页唯一的正文被跳过（#694 那种整篇一段的长帖）：说跳过了几段，而不是“本页没有可翻译的内容”', async () => {
    const { result, notice } = await translatePage(tooLong('post'));
    expect(result.status).toBe('no-elements');
    expect(notice?.message.split(':').slice(-1)[0]).toBe('1');
    expect(notice?.message).not.toBe('hintNoElements');
  });

  test('提示本身不改变翻译行为：统计与不统计，请求与翻译后的页面逐字节相同', async () => {
    const html = NORMAL + tooLong('l1') + '<nav><p id="n">Navigation text here</p></nav>';
    const plain = await translatePage(html, { countSkips: false });
    const counted = await translatePage(html);
    expect(counted.send.mock.calls).toEqual(plain.send.mock.calls);
    expect(counted.page).toBe(plain.page);
    expect(counted.result.status).toBe(plain.result.status);
  });

  test('文案三种语言都有，带数量占位', async () => {
    const fs = await import('fs');
    for (const locale of ['en', 'zh_CN', 'zh_TW']) {
      const messages = JSON.parse(fs.readFileSync(`public/_locales/${locale}/messages.json`, 'utf-8'));
      const msg = messages.toastSkipped;
      expect(msg?.message).toContain('$count$');
      expect(msg?.placeholders?.count?.content).toBe('$1');
    }
  });
});

describe('状态类与既有汇总不受影响（#758）', () => {
  test('没有跳过：正常页面不弹提示', async () => {
    const { notice } = await translatePage(NORMAL);
    expect(notice).toBeNull();
  });

  test('一个单元都没采到、也没有跳过：仍是“本页没有可翻译的内容”', async () => {
    const { notice } = await translatePage('<p id="n">2026-10-13</p>');
    expect(notice).toEqual({ message: 'hintNoElements', kind: 'info' });
  });

  test('不传跳过统计的调用方：行为与改动前一致', () => {
    const translated = { status: 'translated', admission: 'allowed', summary: {} } as PageToggleResult;
    expect(pageNotice(translated, { ...emptyRenderStats(), succeeded: 3 })).toBeNull();
  });
});
