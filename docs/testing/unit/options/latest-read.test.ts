/**
 * 设置页“只用最后一次读取”的刷新逻辑（#1153）
 *
 * 领域分区与站点页面规则分区共用 watchLatestRead。假的读取由用例手动决定
 * 先后返回，只看外部行为：较早的读取晚到时被丢弃；加载完成前不渲染；读取
 * 失败只在它仍是最后一次读取时报出，带上失败前列表有没有显示过；存储变更
 * 触发重读，取消订阅后不再重读。
 */
import { describe, test, expect, vi } from 'vitest';
import { watchLatestRead } from '~/entrypoints/options/latest-read';

/** 一个手动决定何时返回的读取。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 每次 read() 拿到下一个手动读取，按发起顺序记下来。 */
function setup() {
  const reads: ReturnType<typeof deferred<string>>[] = [];
  const read = vi.fn(() => {
    const d = deferred<string>();
    reads.push(d);
    return d.promise;
  });
  const render = vi.fn();
  const onError = vi.fn();
  let changed: (() => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((fn: () => void) => {
    changed = fn;
    return unsubscribe;
  });
  const list = watchLatestRead({ read, render, onError, subscribe });
  return { list, reads, read, render, onError, fireChange: () => changed!(), unsubscribe };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('watchLatestRead（#1153）', () => {
  test('立即读一次；加载完成前不渲染，读到之后渲染并记为已显示', async () => {
    const { list, reads, render } = setup();
    expect(reads).toHaveLength(1);
    await flush();
    expect(render).not.toHaveBeenCalled();
    expect(list.loaded()).toBe(false);
    reads[0]!.resolve('v1');
    await flush();
    expect(render).toHaveBeenCalledWith('v1');
    expect(list.loaded()).toBe(true);
  });

  test('较早的读取晚到时被丢弃，只渲染最后一次；被取代的刷新返回最后一次的结果', async () => {
    const { list, reads, render } = setup();
    const second = list.refresh();
    reads[1]!.resolve('new');
    await flush();
    reads[0]!.resolve('old');
    await flush();
    expect(render.mock.calls).toEqual([['new']]);
    expect(await second).toBe(true);
  });

  test('读取失败只在它仍是最后一次时报出，带上失败前有没有显示过', async () => {
    const { list, reads, onError } = setup();
    reads[0]!.reject(new Error('first load'));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), false);

    // 显示过之后：旧读取失败、新读取成功 → 不提示
    const ok = list.refresh();
    reads[1]!.resolve('v');
    await ok;
    const stale = list.refresh();
    const fresh = list.refresh();
    reads[3]!.resolve('newest');
    reads[2]!.reject(new Error('stale'));
    expect(await fresh).toBe(true);
    expect(await stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    // 最后一次失败 → 提示，loaded 为 true，返回 false
    const failing = list.refresh();
    reads[4]!.reject(new Error('later'));
    expect(await failing).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), true);
  });

  test('渲染抛错与读取失败一样处理', async () => {
    const { list, reads, render, onError } = setup();
    render.mockImplementationOnce(() => {
      throw new Error('render');
    });
    reads[0]!.resolve('bad');
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'render' }), false);
    expect(list.loaded()).toBe(false);
  });

  test('存储变更触发重读；stop 之后不再订阅，在飞的读取也不再渲染', async () => {
    const { list, reads, render, fireChange, unsubscribe } = setup();
    reads[0]!.resolve('a');
    await flush();
    fireChange();
    expect(reads).toHaveLength(2);
    list.stop();
    expect(unsubscribe).toHaveBeenCalled();
    reads[1]!.resolve('b');
    await flush();
    expect(render.mock.calls).toEqual([['a']]);
  });
});
