/**
 * 跳过提示带上最主要的原因（#759，规格 #727）
 *
 * 只给数量，用户仍然不知道是内容太长、标记太复杂，还是被站点规则挡下。
 * 提示里带上占比最大的那一类；一条提示只说一件事，不把几类都堆进一句话，
 * 详细分组在控制台里（#763）。数量相同时按确定的顺序取舍，不随机。
 *
 * 切入点：采集入口 collect 报出跳过，整页翻译的汇总 pageNotice 给出提示。
 * 文案取值带上替换参数，看得见用的是哪一条文案、数量是多少。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import type { PageToggleResult } from '~/src/orchestration/orchestrator';
import { countSkip, emptyRenderStats, emptySkipStats, pageNotice, type SkipStats } from '~/src/orchestration/page-summary';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const para = (id: string, inner: string) => `<p id="${id}">${inner}</p>`;
const tooLong = (id: string) => para(id, 'This sentence keeps going on and on. '.repeat(100));
const tooComplex = (id: string) => para(id, '<b>w</b> '.repeat(400));
const excluded = (id: string) => `<p class="ad" id="${id}">Sponsored content from our partners.</p>`;
const NORMAL = para('a', 'A normal paragraph with some words.');

const translated = { status: 'translated', admission: 'allowed', summary: {} } as PageToggleResult;

let restore: () => void;
beforeEach(async () => {
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
  resetStorage();
  await saveUserSiteRules('localhost', { exclude: ['.ad'] });
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 采一遍，返回整页翻译结束后那条提示的文字。 */
function noticeFor(html: string): string | undefined {
  document.body.innerHTML = html;
  const skips = emptySkipStats();
  collect(document.body, undefined, { onSkip: (_el, c) => countSkip(skips, c) });
  return pageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, skips)?.message;
}

function stats(over: Partial<SkipStats>): SkipStats {
  return { ...emptySkipStats(), ...over };
}

describe('提示里给出占比最大的原因（#759）', () => {
  test('文字超长占多数：说文字超长，数量是全部跳过的总数', () => {
    expect(noticeFor(NORMAL + tooLong('l1') + tooLong('l2') + tooComplex('c1'))).toBe('toastSkippedTooLong:3');
  });

  test('标记过密占多数：说标记过密', () => {
    expect(noticeFor(NORMAL + tooComplex('c1') + tooComplex('c2') + tooLong('l1'))).toBe('toastSkippedTooComplex:3');
  });

  test('站点页面规则占多数：说被站点页面规则排除', () => {
    expect(noticeFor(NORMAL + excluded('x1') + excluded('x2') + tooLong('l1'))).toBe('toastSkippedSiteRule:3');
  });

  test('其他占多数：只说数量，不编原因', () => {
    const notice = pageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, stats({ other: 2, 'too-long': 1 }));
    expect(notice?.message).toBe('toastSkipped:3');
  });

  test('一条提示只说一件事：几类并存也只用一条文案，不把几类堆进一句', () => {
    const msg = noticeFor(NORMAL + tooLong('l1') + tooLong('l2') + tooComplex('c1') + excluded('x1'))!;
    expect(msg.split(':')).toHaveLength(2);
  });
});

describe('数量相同时的取舍有确定规则（#759）', () => {
  const notice = (s: Partial<SkipStats>) =>
    pageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, stats(s))?.message;

  test('依次是文字超长、标记过密、站点页面规则、其他：并列时取排在前面的', () => {
    expect(notice({ 'too-long': 2, 'too-complex': 2 })).toBe('toastSkippedTooLong:4');
    expect(notice({ 'too-complex': 2, 'site-rule': 2 })).toBe('toastSkippedTooComplex:4');
    expect(notice({ 'site-rule': 1, other: 1 })).toBe('toastSkippedSiteRule:2');
    expect(notice({ 'too-long': 1, 'too-complex': 1, 'site-rule': 1, other: 1 })).toBe('toastSkippedTooLong:4');
  });

  test('同样的计数无论按什么顺序累计出来，结论都一样', () => {
    const a = stats({});
    const b = stats({});
    for (const c of ['site-rule', 'too-complex', 'site-rule', 'too-complex'] as const) countSkip(a, c);
    for (const c of ['too-complex', 'site-rule', 'too-complex', 'site-rule'] as const) countSkip(b, c);
    const run = (s: SkipStats) => pageNotice(translated, { ...emptyRenderStats(), succeeded: 1 }, s)?.message;
    expect(run(a)).toBe(run(b));
  });
});

describe('文案按分类各有一条（#759）', () => {
  test('三种语言都有四条跳过文案，都带数量占位', () => {
    for (const locale of ['en', 'zh_CN', 'zh_TW']) {
      const messages = JSON.parse(fs.readFileSync(`public/_locales/${locale}/messages.json`, 'utf-8'));
      for (const key of ['toastSkipped', 'toastSkippedTooLong', 'toastSkippedTooComplex', 'toastSkippedSiteRule']) {
        expect(messages[key]?.message, `${locale} ${key}`).toContain('$count$');
        expect(messages[key]?.placeholders?.count?.content).toBe('$1');
      }
    }
  });
});
