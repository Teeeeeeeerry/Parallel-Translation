/**
 * storage/domains.ts — 生效领域列表订阅的初始交付 单元测试（#486）
 *
 * 只断言外部可观察的行为：订阅时要求立即交付初始列表，订阅者先拿到
 * 当前的生效领域列表；初始读取还没返回时发生领域变更、且初始读取晚于
 * 变更后的读取返回时，订阅者最终拿到的是变更后的列表；取消订阅后，
 * 尚未返回的初始读取也不交付。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createDomain, watchEffectiveDomains } from '~/src/storage/domains';
import { resetStorage, fireStorageChange, localStoreSnapshot } from '~/docs/testing/setup';
import type { Domain } from '~/src/storage/domains';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 让下一次 storage.local 读取停住，直到调用返回的函数，并以调用时刻之前的数据返回。 */
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

beforeEach(async () => {
  resetStorage();
  await createDomain({ name: '法律', targetLang: 'zh-CN' });
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
    await createDomain({ name: '医学', targetLang: 'zh-CN' });
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    await flush();
    expect(names(fn)).toContain('医学');

    // 较早发起的初始读取这时才返回旧列表
    release();
    await flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(names(fn)).toContain('医学');
  });

  test('取消订阅后，尚未返回的初始读取不交付', async () => {
    const release = holdNextRead();
    const fn = vi.fn();
    const off = watchEffectiveDomains(fn, { initial: true });
    off();
    release();
    await flush();

    expect(fn).not.toHaveBeenCalled();
  });
});
