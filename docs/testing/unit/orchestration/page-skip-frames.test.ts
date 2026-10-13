/**
 * 跳过提示只在主文档弹一次，计数不跨 frame 汇总（#762，规格 #727）
 *
 * popup 的整页翻译不带 frameId，广播到标签页的全部 frame，每个 frame 各自
 * 采集、各自翻译、各自汇总。与既有四条汇总同一个口径（#327）：只有主文档
 * 弹提示，子框架不弹 —— 带很多 iframe 的页面不会各弹一条。
 *
 * 计数不跨 frame 汇总：主文档报的是主文档自己的数。既有四条汇总（渲染被拒、
 * 翻译失败、同语言兜底、没采到单元）都只算主文档，跳过这一条跟它们一致；
 * 文案说“另有 N 段”，不说“本页共有”，不暗示是全页总数。
 *
 * 切入点：采集入口 collect 计入跳过，整页翻译的汇总给出这个 frame 要弹的
 * 那一条。真实浏览器里多个 iframe 只弹一条的断言在 TC-E2E-182（#764）。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import type { PageToggleResult } from '~/src/orchestration/orchestrator';
import {
  countSkip,
  emptyRenderStats,
  emptySkipStats,
  framePageNotice,
  type SkipStats,
} from '~/src/orchestration/page-summary';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const tooLong = (id: string) => `<p id="${id}">${'This sentence keeps going on and on. '.repeat(100)}</p>`;
const NORMAL = '<p id="a">A normal paragraph with some words.</p>';
const translated = { status: 'translated', admission: 'allowed', summary: {} } as PageToggleResult;
const noElements = { status: 'no-elements', admission: 'allowed' } as PageToggleResult;

let restore: () => void;
beforeEach(async () => {
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

/** 一个 frame 自己的文档：采一遍，得到它自己的跳过计数。 */
function frameSkips(html: string): SkipStats {
  document.body.innerHTML = html;
  const skips = emptySkipStats();
  collect(document.body, undefined, { onSkip: (_el, c) => countSkip(skips, c) });
  return skips;
}

describe('只在主文档弹，计数不跨 frame 汇总（#762）', () => {
  test('主文档一段、三个子框架各两段被跳过：只有主文档给出一条，数量是主文档自己的 1', () => {
    const main = frameSkips(NORMAL + tooLong('m'));
    const children = [0, 1, 2].map((i) => frameSkips(NORMAL + tooLong(`c${i}a`) + tooLong(`c${i}b`)));

    const shown = [
      framePageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, main, true),
      ...children.map((s) => framePageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, s, false)),
    ].filter((n) => n !== null);

    expect(shown).toEqual([{ message: 'toastSkippedTooLong:1', kind: 'info' }]);
  });

  test('只有子框架有跳过：子框架不弹，主文档也不替它说', () => {
    const main = frameSkips(NORMAL);
    const child = frameSkips(NORMAL + tooLong('c'));
    expect(framePageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, main, true)).toBeNull();
    expect(framePageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, child, false)).toBeNull();
  });

  test('子框架整篇正文被跳过（没采到单元）：子框架同样不弹', () => {
    expect(framePageNotice(noElements, emptyRenderStats(), frameSkips(tooLong('c')), false)).toBeNull();
  });
});

describe('既有汇总在子框架同样不弹（#327，#762 反向）', () => {
  test('翻译失败、含图片/按钮、已经是目标语言：主文档照弹，子框架都不弹', () => {
    for (const stats of [
      { ...emptyRenderStats(), succeeded: 1, failed: 1 },
      { ...emptyRenderStats(), succeeded: 1, rejected: 1 },
      { ...emptyRenderStats(), succeeded: 1, sameAsSource: 1 },
    ]) {
      expect(framePageNotice(translated, stats, emptySkipStats(), true)).not.toBeNull();
      expect(framePageNotice(translated, stats, emptySkipStats(), false)).toBeNull();
    }
  });
});
