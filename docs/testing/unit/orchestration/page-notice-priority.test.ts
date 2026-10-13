/**
 * 整页翻译结束时几条汇总的优先级（#760，规格 #727）
 *
 * 票面写的“现有三条”实为四条：渲染被拒（#49）、翻译失败（#416）、一个单元
 * 都没采到、同语言兜底拦下（#785）。#758 加的跳过是第五条。同一时刻只显示
 * 一条，几条同时满足条件时给哪一条要有确定规则，失败类更需要被看到。
 *
 * 规则（翻译完成时）：翻译失败 > 已经是目标语言 > 采集时跳过 > 含图片/按钮。
 * 没有一段插入译文时：全部引擎失败 > 已经是目标语言 > 采集时跳过 > 所有段落
 * 含图片/按钮。一个单元都没采到时：采集时跳过 > 本页没有可翻译的内容。
 *
 * 切入点：整页翻译的汇总 pageNotice。文案取值带上替换参数，看得见是哪一条。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { PageToggleResult } from '~/src/orchestration/orchestrator';
import {
  emptyRenderStats,
  emptySkipStats,
  pageNotice,
  type RenderStats,
  type SkipStats,
} from '~/src/orchestration/page-summary';

beforeEach(() => {
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
});

const translated = { status: 'translated', admission: 'allowed', summary: { display: { showRealReason: false } } } as PageToggleResult;
const nothingRendered = { status: 'error', admission: 'allowed', summary: { allFailed: false } } as PageToggleResult;
const noElements = { status: 'no-elements', admission: 'allowed' } as PageToggleResult;

const render = (over: Partial<RenderStats>): RenderStats => ({ ...emptyRenderStats(), ...over });
const skips = (n: number): SkipStats => ({ ...emptySkipStats(), 'too-long': n });

/** 只给出提示用的是哪一条文案。 */
const which = (result: PageToggleResult, r: Partial<RenderStats>, s = 0) =>
  pageNotice(result, render(r), skips(s))?.message.split(':')[0] ?? null;

describe('翻译完成时：失败 > 已经是目标语言 > 采集时跳过 > 含图片/按钮（#760）', () => {
  test('四条同时满足条件：只给翻译失败那一条', () => {
    expect(which(translated, { succeeded: 3, failed: 1, sameAsSource: 2, rejected: 2 }, 4)).toBe('domainPartialFail');
  });

  test('逐条拿掉排在前面的：依次轮到下一条', () => {
    expect(which(translated, { succeeded: 3, sameAsSource: 2, rejected: 2 }, 4)).toBe('toastSameAsSource');
    expect(which(translated, { succeeded: 3, rejected: 2 }, 4)).toBe('toastSkippedTooLong');
    expect(which(translated, { succeeded: 3, rejected: 2 }, 0)).toBe('toastRenderRejected');
    expect(which(translated, { succeeded: 3 }, 0)).toBeNull();
  });

  test('采集时跳过排在含图片/按钮之上，与两边的数量无关', () => {
    expect(which(translated, { succeeded: 3, rejected: 50 }, 1)).toBe('toastSkippedTooLong');
  });

  test('已经是目标语言排在采集时跳过之上，与两边的数量无关', () => {
    expect(which(translated, { succeeded: 3, sameAsSource: 1 }, 50)).toBe('toastSameAsSource');
  });

  test('同一时刻只给一条：结果是一条提示，不是一串', () => {
    const notice = pageNotice(translated, render({ succeeded: 3, failed: 1, sameAsSource: 2, rejected: 2 }), skips(4));
    expect(notice).toEqual({ message: 'domainPartialFail:1', kind: 'error' });
  });
});

describe('没有一段插入译文时：全部失败 > 已经是目标语言 > 采集时跳过 > 所有段落含图片/按钮（#760）', () => {
  test('全部引擎失败压过其余各条', () => {
    const allFailed = { ...nothingRendered, summary: { allFailed: true, display: { showRealReason: false } } } as PageToggleResult;
    expect(which(allFailed, { failed: 3, sameAsSource: 1, rejected: 1 }, 2)).toBe('toastAllEnginesFail');
  });

  test('已经是目标语言压过采集时跳过与含图片/按钮', () => {
    expect(which(nothingRendered, { sameAsSource: 1, rejected: 1 }, 2)).toBe('toastSameAsSource');
  });

  test('采集时跳过压过“所有段落均含图片/按钮”：有段落根本没进采集，这句话就不对', () => {
    expect(which(nothingRendered, { rejected: 3 }, 1)).toBe('toastSkippedTooLong');
    expect(which(nothingRendered, { rejected: 3 }, 0)).toBe('toastAllRejected');
  });
});

describe('一个单元都没采到时：采集时跳过 > 本页没有可翻译的内容（#760）', () => {
  test('有跳过说跳过，没有才说没有可翻译的内容', () => {
    expect(which(noElements, {}, 1)).toBe('toastSkippedTooLong');
    expect(which(noElements, {}, 0)).toBe('hintNoElements');
  });
});
