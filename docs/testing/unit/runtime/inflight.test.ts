/**
 * 后台的在飞表（#1001）：批次身份 → 引擎调用的中止信号。
 *
 * MV3 的 service worker 会被回收，表随实例清空。查不到就当没有可中止的：
 * 不报错、不抛出，content 那边回到原来的行为。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createInFlightTable, inFlightKey, runEngineCall, ENGINE_PHASE_TIMEOUT_MS } from '~/src/runtime/inflight';
import { EngineError, type TranslateResponse } from '~/src/engines/types';

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

/**
 * 引擎时段的超时（#1071 方案 A）：从这一批第一次拿到引擎许可起计，排在别的批次
 * 后面的时间不算。替身按真实引擎的样子走：先在闸门里排队，拿到许可时报一声，
 * 之后干活；信号中止时像 fetchWithTimeout 那样以“已中止”失败。
 */
describe('引擎时段超时（#1071）', () => {
  const aborted = () => new EngineError('google-web', false, '已中止', 'aborted', false, true);

  /** 排队 queueMs 后拿到许可，再干 workMs；干完返回 result，被中止就抛“已中止” */
  const engine =
    <T,>(queueMs: number, workMs: number, result: T) =>
    ({ signal, onGateStart }: { signal: AbortSignal; onGateStart: () => void }) =>
      new Promise<T>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(aborted()), { once: true });
        setTimeout(() => {
          onGateStart();
          setTimeout(() => resolve(result), workMs);
        }, queueMs);
      });

  afterEach(() => vi.useRealTimers());

  test('后台排队 40 秒、引擎 1 秒返回：照常返回结果', async () => {
    vi.useFakeTimers();
    const ok = { translations: ['好'] };
    const done = runEngineCall(engine(40_000, 1_000, ok));
    await vi.advanceTimersByTimeAsync(41_000);
    await expect(done).resolves.toEqual(ok);
  });

  test('拿到许可后 40 秒不返回：在第 30 秒报可重试的瞬时超时，不报“已中止”', async () => {
    vi.useFakeTimers();
    const done = runEngineCall(engine(5_000, 40_000, { translations: ['迟'] }));
    const settled = vi.fn();
    done.then(settled, settled);
    await vi.advanceTimersByTimeAsync(5_000 + ENGINE_PHASE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).rejects.toMatchObject({ category: 'transient', retryable: true, aborted: false });
    await expect(done).rejects.toThrow('引擎响应超时');
  });

  test('超时到点时已有部分段落译好：返回部分结果，失败段落不带“已中止”原因，交给批次重试补', async () => {
    vi.useFakeTimers();
    // 路由在已有段落成功后遇到中止，会带着“已中止”的原因返回部分结果（#440）
    const partialOnAbort = ({ signal, onGateStart }: { signal: AbortSignal; onGateStart: () => void }) =>
      new Promise<TranslateResponse>((resolve) => {
        onGateStart();
        signal.addEventListener(
          'abort',
          () =>
            resolve({
              translations: ['甲', ''],
              failedIndices: [1],
              failure: { category: 'aborted', error: '已中止' },
            }),
          { once: true },
        );
      });
    const done = runEngineCall(partialOnAbort);
    await vi.advanceTimersByTimeAsync(ENGINE_PHASE_TIMEOUT_MS);
    await expect(done).resolves.toEqual({ translations: ['甲', ''], failedIndices: [1] });
  });

  test('content 放弃这一批（在飞表的信号）：引擎被中止，报“已中止”而不是超时', async () => {
    vi.useFakeTimers();
    const t = createInFlightTable();
    const key = inFlightKey(1, 0, 'b-1');
    const done = runEngineCall(engine(1_000, 10_000, { translations: ['迟'] }), { signal: t.start(key) });
    const settled = vi.fn();
    done.then(settled, settled);
    await vi.advanceTimersByTimeAsync(2_000);
    t.cancel(key);
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).rejects.toMatchObject({ category: 'aborted', aborted: true });
  });
});
