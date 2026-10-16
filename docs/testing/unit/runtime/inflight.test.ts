/**
 * 后台的在飞表（#1001）：批次身份 → 引擎调用的中止信号。
 *
 * MV3 的 service worker 会被回收，表随实例清空。查不到就当没有可中止的：
 * 不报错、不抛出，content 那边回到原来的行为。
 */
import { describe, test, expect } from 'vitest';
import { createInFlightTable, inFlightKey } from '~/src/runtime/inflight';

describe('在飞表（#1001）', () => {
  test('中止登记过的批次：它的信号触发，并从表里移除', () => {
    const t = createInFlightTable();
    const key = inFlightKey(7, 0, 'abc-1');
    const signal = t.start(key);
    expect(signal.aborted).toBe(false);
    expect(t.cancel(key)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(t.size()).toBe(0);
  });

  test('实例被回收后的新表：查不到就当没有可中止的，不报错', () => {
    const fresh = createInFlightTable();
    expect(() => fresh.cancel(inFlightKey(7, 0, 'abc-1'))).not.toThrow();
    expect(fresh.cancel(inFlightKey(7, 0, 'abc-1'))).toBe(false);
  });

  test('已结束的批次再中止：什么也不做', () => {
    const t = createInFlightTable();
    const key = inFlightKey(7, 0, 'abc-1');
    const signal = t.start(key);
    t.finish(key);
    expect(t.cancel(key)).toBe(false);
    expect(signal.aborted).toBe(false);
  });

  test('同一个批次身份在别的标签页、别的 frame 里互不相干', () => {
    const t = createInFlightTable();
    const a = t.start(inFlightKey(7, 0, 'abc-1'));
    const b = t.start(inFlightKey(8, 0, 'abc-1'));
    const c = t.start(inFlightKey(7, 3, 'abc-1'));
    t.cancel(inFlightKey(7, 0, 'abc-1'));
    expect([a.aborted, b.aborted, c.aborted]).toEqual([true, false, false]);
  });
});
