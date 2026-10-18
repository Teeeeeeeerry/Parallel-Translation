/**
 * 翻译运行（#1072，#1066 的第一张）
 *
 * 放弃这件事由一个模块持有：页面根随还原中止并立即换新根，输入根不随还原；
 * 每次运行从根派生一个信号，可再叠加调用方自己的信号，任一来源中止即中止。
 */
import { describe, test, expect } from 'vitest';
import { createTranslationRuns } from '~/src/orchestration/translation-run';

describe('翻译运行（#1072）', () => {
  test('还原整页：页面根派生的运行中止，输入根派生的不受影响', () => {
    const runs = createTranslationRuns();
    const page = runs.begin('page');
    const input = runs.begin('input');
    runs.restorePage();
    expect(page.signal.aborted).toBe(true);
    expect(input.signal.aborted).toBe(false);
  });

  test('还原之后换了新根：之后派生的运行不是已中止的', () => {
    const runs = createTranslationRuns();
    runs.restorePage();
    const next = runs.begin('page');
    expect(next.signal.aborted).toBe(false);
    runs.restorePage();
    expect(next.signal.aborted).toBe(true);
  });

  test('叠加调用方信号：调用方中止，这一次运行中止；根与别的运行不受影响', () => {
    const runs = createTranslationRuns();
    const caller = new AbortController();
    const run = runs.begin('page', caller.signal);
    const other = runs.begin('page');
    caller.abort();
    expect(run.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(runs.begin('page').signal.aborted).toBe(false);
  });

  test('叠加的调用方信号在派生前已中止：派生出的运行立即是已中止的', () => {
    const runs = createTranslationRuns();
    const caller = new AbortController();
    caller.abort();
    expect(runs.begin('input', caller.signal).signal.aborted).toBe(true);
  });

  test('运行结束之后再还原：已结束的运行不再收到中止', () => {
    const runs = createTranslationRuns();
    const run = runs.begin('page');
    run.end();
    runs.restorePage();
    expect(run.signal.aborted).toBe(false);
  });

  test('运行结束之后调用方再中止：已结束的运行不再收到中止', () => {
    const runs = createTranslationRuns();
    const caller = new AbortController();
    const run = runs.begin('page', caller.signal);
    run.end();
    caller.abort();
    expect(run.signal.aborted).toBe(false);
  });
});
