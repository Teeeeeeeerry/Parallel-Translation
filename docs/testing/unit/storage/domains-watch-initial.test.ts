/**
 * storage/domains.ts — 生效领域列表订阅的初始交付 单元测试（#486）
 *
 * 只断言外部可观察的行为：订阅时要求立即交付初始列表，订阅者先拿到
 * 当前的生效领域列表；初始读取还没返回时发生领域变更、且初始读取晚于
 * 变更后的读取返回时，订阅者最终拿到的是变更后的列表；取消订阅后，
 * 尚未返回的初始读取也不交付。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { watchEffectiveDomains } from '~/src/storage/domains';
import { resetStorage, fireStorageChange, localStoreSnapshot } from '~/docs/testing/setup';
import type { Domain } from '~/src/storage/domains';

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * 让下一次 storage.local 读取停住，直到调用返回的函数，并以调用时刻之前的
 * 数据返回。用例里订阅之前不再有别的读取，下一次读取就是初始读取。
 */
function holdNextRead(): () => void {
  const snapshot = structuredClone(localStoreSnapshot());
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  vi.mocked(chrome.storage.local.get).mockImplementationOnce(async (key) => {
    await gate;
    return { [key as string]: snapshot[key as string] };
  });
  return release;
}

function names(fn: ReturnType<typeof vi.fn>): string[] {
  return (fn.mock.lastCall![0] as Domain[]).map((d) => d.name);
}

function userDomain(name: string): Domain {
  return { id: `user:${name}`, name, targetLang: 'zh-CN', sites: [], terms: [], origin: 'user' };
}

/** 模拟设置页写入领域数据（直接写存储，不经模块的读取）。 */
async function storeDomains(...list: string[]): Promise<void> {
  await chrome.storage.local.set({ 'pt-domains': { user: list.map(userDomain), builtin: {} } });
}

beforeEach(async () => {
  resetStorage();
  await storeDomains('法律');
});

describe('生效领域列表订阅的初始交付（#486）', () => {
  test('要求立即交付时，先交付一次当前的生效领域列表', async () => {
    const fn = vi.fn();
    watchEffectiveDomains(fn, { initial: true });
    await flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(names(fn)).toContain('法律');
  });

  test('不要求立即交付时，领域变更前不交付（行为同 #417）', async () => {
    const fn = vi.fn();
    watchEffectiveDomains(fn);
    await flush();

    expect(fn).not.toHaveBeenCalled();
  });

  test('初始读取晚于变更后的读取返回 → 最终交付变更后的列表', async () => {
    const release = holdNextRead();
    const fn = vi.fn();
    watchEffectiveDomains(fn, { initial: true });

    // 初始读取停住期间，设置页新建了领域
    await storeDomains('法律', '医学');
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    await flush();
    expect(names(fn)).toContain('医学');

    // 较早发起的初始读取这时才返回旧列表
    release();
    await flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(names(fn)).toContain('医学');
  });

  test('取消订阅后，尚未返回的初始读取不交付；未取消的照常交付', async () => {
    const releaseKept = holdNextRead();
    const releaseOff = holdNextRead();
    const kept = vi.fn();
    const cancelled = vi.fn();
    watchEffectiveDomains(kept, { initial: true });
    const off = watchEffectiveDomains(cancelled, { initial: true });
    off();
    releaseKept();
    releaseOff();
    await flush();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
