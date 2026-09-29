/**
 * storage/cache.ts — 翻译缓存按字节数限额（#510）
 *
 * 只断言外部可观察的行为：哪些条目还在存储里、能否读到。缓存条目的
 * 总字节数（键名加存入值的 UTF-8 字节数）超过 CACHE_MAX_BYTES 时从最旧的
 * 淘汰；写入遇到配额错误时先淘汰最旧的一批再重试一次；升级前已有的
 * 缓存保留，并计入字节数。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';
import { cacheGet, cacheSet, cacheKey, cacheClear, CACHE_MAX_BYTES } from '~/src/storage/cache';

/** 约占 fraction 份上限字节数的译文：中文每字 3 字节。 */
const zh = (fraction: number) => '译'.repeat(Math.floor((CACHE_MAX_BYTES * fraction) / 3));

const keyOf = (i: number) => cacheKey('google-web', 'en', 'zh-CN', `段落 ${i}`);
const stored = () => Object.keys(localStoreSnapshot()).filter((k) => k.startsWith('pt-c:'));

beforeEach(() => {
  resetStorage();
});

describe('缓存按字节数限额（#510）', () => {
  test('总字节数超过上限时从最旧的淘汰，按 UTF-8 字节计', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4].map(keyOf));
    // 每条约 0.24 份：4 条在上限内，第 5 条写入后超出
    for (const k of keys) await cacheSet(k, zh(0.24));

    expect(stored()).toEqual(keys.slice(1));
    expect(await cacheGet(keys[0]!)).toBeNull();
    expect(await cacheGet(keys[4]!)).toBe(zh(0.24));
  });

  test('命中会刷新位置：最近读过的不先被淘汰', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4].map(keyOf));
    for (const k of keys.slice(0, 4)) await cacheSet(k, zh(0.24));
    await cacheGet(keys[0]!);
    await cacheSet(keys[4]!, zh(0.24));

    expect(stored().sort()).toEqual([keys[0], keys[2], keys[3], keys[4]].sort());
  });

  test('覆盖写同一条：只按新值计，不重复累计', async () => {
    const [k0, k1] = await Promise.all([keyOf(0), keyOf(1)]);
    await cacheSet(k0, zh(0.4));
    for (let i = 0; i < 5; i++) await cacheSet(k1, zh(0.4));
    expect(stored().sort()).toEqual([k0, k1].sort());
  });

  test('清空缓存后重新计数', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(keyOf));
    for (const k of keys.slice(0, 4)) await cacheSet(k, zh(0.24));
    await cacheClear();
    for (const k of keys.slice(4)) await cacheSet(k, zh(0.24));
    expect(stored()).toEqual(keys.slice(4));
  });

  test('升级前已有的缓存保留，并计入字节数', async () => {
    const [a, b, c] = await Promise.all([keyOf(0), keyOf(1), keyOf(2)]);
    const entry = (v: string) => JSON.stringify({ v, t: Date.now() });
    // #510 之前的存储：只有条目与 index，没有字节数记录
    await chrome.storage.local.set({
      [a]: entry(zh(0.45)),
      [b]: entry(zh(0.45)),
      'pt-cache-index': [a, b],
    });

    expect(await cacheGet(b)).toBe(zh(0.45));
    await cacheSet(c, zh(0.45));

    expect(stored().sort()).toEqual([b, c].sort());
    expect(await cacheGet(a)).toBeNull();
  });
});

describe('缓存写入遇到配额错误（#510）', () => {
  test('先淘汰最旧的一批再重试一次，新条目写入成功', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4].map(keyOf));
    for (const k of keys.slice(0, 4)) await cacheSet(k, `值 ${k}`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    try {
      await cacheSet(keys[4]!, '新值');
    } finally {
      warn.mockRestore();
    }

    expect(await cacheGet(keys[4]!)).toBe('新值');
    expect(await cacheGet(keys[0]!)).toBeNull();
    expect(stored().sort()).toEqual(keys.slice(1).sort());
  });

  test('不是配额错误：不淘汰也不重试，已有条目不动', async () => {
    const keys = await Promise.all([0, 1, 2].map(keyOf));
    for (const k of keys.slice(0, 2)) await cacheSet(k, `值 ${k}`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('storage broken'));
    try {
      await cacheSet(keys[2]!, '新值');
    } finally {
      warn.mockRestore();
    }

    expect(stored().sort()).toEqual(keys.slice(0, 2).sort());
  });
});
