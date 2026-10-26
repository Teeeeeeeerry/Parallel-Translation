/**
 * 带锁的 local 存储记录（#1151）
 *
 * 在假的 storage（全局 setup 的 chrome 替身）与假的 Web Locks 上，只看外部
 * 行为：读失败、配额满、两个调用者（两个互不共享内存的页面）同时读改写时，
 * 最终存进去的是什么、调用方拿到什么错误。领域与站点页面规则两个存储模块
 * 各自的配额、读取失败、跨页写入用例保留，确认接线。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetStorage, localStoreSnapshot, fireStorageChange } from '~/docs/testing/setup';

type Mod = typeof import('~/src/storage/locked-record');

/** Web Locks 替身：同名锁按请求顺序一次只让一个回调执行，回调出错照样放锁。 */
function fakeLocks(): Pick<LockManager, 'request'> {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: ((name: string, cb: (lock: Lock | null) => Promise<unknown>) => {
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(() => cb({ name, mode: 'exclusive' } as Lock));
      tails.set(name, run.catch(() => {}));
      return run;
    }) as LockManager['request'],
  };
}

/** 模拟一个页面：重新加载模块，得到一份独立的写入链；记录是一个字符串列表。 */
async function openPage(onWrite?: (v: string[]) => void) {
  vi.resetModules();
  const mod: Mod = await import('~/src/storage/locked-record');
  const { StorageQuotaError } = await import('~/src/storage/quota');
  const { StorageReadError } = await import('~/src/storage/read-error');
  const record = mod.lockedRecord<string[]>({
    key: 'pt-test',
    parse: (raw) => (Array.isArray((raw as { list?: unknown })?.list) ? (raw as { list: string[] }).list : []),
    serialize: (list) => ({ list }),
    lock: 'pt-test-write',
    fallback: () => ['builtin'],
    readFailedMessage: '[PT] 读取测试数据失败',
    onWrite,
  });
  return { record, StorageQuotaError, StorageReadError };
}

const append = (item: string) => (list: string[]) => ({ value: [...list, item], result: list.length });

beforeEach(() => {
  resetStorage();
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });
});
afterEach(() => {
  // 只卸下锁替身；chrome 替身由全局 setup 提供，不能一并清掉
  delete (navigator as { locks?: unknown }).locks;
});

describe('读', () => {
  test('首次使用没有数据：严格读与宽松读都得到解析的默认值', async () => {
    const { record } = await openPage();
    expect(await record.read()).toEqual([]);
    expect(await record.readOrFallback()).toEqual([]);
  });

  test('读取失败：严格读抛 StorageReadError，宽松读退回 fallback 并记日志', async () => {
    const { record, StorageReadError } = await openPage();
    const get = vi.mocked(chrome.storage.local.get);
    get.mockRejectedValueOnce(new Error('IO'));
    await expect(record.read()).rejects.toBeInstanceOf(StorageReadError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    get.mockRejectedValueOnce(new Error('IO'));
    expect(await record.readOrFallback()).toEqual(['builtin']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('读-改-写', () => {
  test('写入序列化后的值，返回修改函数带出的值，写入后调 onWrite', async () => {
    const onWrite = vi.fn();
    const { record } = await openPage(onWrite);
    expect(await record.update(append('a'))).toBe(0);
    expect(localStoreSnapshot()['pt-test']).toEqual({ list: ['a'] });
    expect(onWrite).toHaveBeenCalledWith(['a']);
  });

  test('修改函数返回 null：不写入、不调 onWrite', async () => {
    const onWrite = vi.fn();
    const { record } = await openPage(onWrite);
    expect(await record.update(() => ({ value: null, result: 'same' }))).toBe('same');
    expect(localStoreSnapshot()['pt-test']).toBeUndefined();
    expect(onWrite).not.toHaveBeenCalled();
  });

  test('读取失败：抛“未作改动”、不调用修改函数、原有数据不变；之后的写入照常', async () => {
    const { record } = await openPage();
    await record.update(append('a'));
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('IO'));
    const change = vi.fn(append('b'));
    await expect(record.update(change)).rejects.toThrow('[PT] 读取测试数据失败，未作改动');
    expect(change).not.toHaveBeenCalled();
    expect(localStoreSnapshot()['pt-test']).toEqual({ list: ['a'] });
    await record.update(append('c'));
    expect(await record.read()).toEqual(['a', 'c']);
  });

  test('配额满：抛 StorageQuotaError，原有数据不变；别的写入错误原样抛出', async () => {
    const { record, StorageQuotaError } = await openPage();
    await record.update(append('a'));
    const set = vi.mocked(chrome.storage.local.set);
    set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await expect(record.update(append('b'))).rejects.toBeInstanceOf(StorageQuotaError);
    const other = new Error('boom');
    set.mockRejectedValueOnce(other);
    await expect(record.update(append('b'))).rejects.toBe(other);
    expect(localStoreSnapshot()['pt-test']).toEqual({ list: ['a'] });
  });

  test('两个页面同时读改写：后一次基于前一次写入之后的数据，改动都在', async () => {
    const a = (await openPage()).record;
    const b = (await openPage()).record;
    await Promise.all([a.update(append('a1')), b.update(append('b1')), a.update(append('a2')), b.update(append('b2'))]);
    expect((await a.read()).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
});

describe('订阅', () => {
  test('这个键在 local 里变了才回调，收到解析后的新值；取消订阅后不再收到', async () => {
    const { record } = await openPage();
    const seen: string[][] = [];
    const stop = record.subscribe((v) => seen.push(v));
    fireStorageChange({ 'pt-test': { newValue: { list: ['x'] } } }, 'local');
    fireStorageChange({ 'pt-test': { newValue: { list: ['sync'] } } }, 'sync');
    fireStorageChange({ 'pt-other': { newValue: { list: ['other'] } } }, 'local');
    fireStorageChange({ 'pt-test': { newValue: undefined } }, 'local');
    expect(seen).toEqual([['x'], []]);
    stop();
    fireStorageChange({ 'pt-test': { newValue: { list: ['y'] } } }, 'local');
    expect(seen).toEqual([['x'], []]);
  });
});
