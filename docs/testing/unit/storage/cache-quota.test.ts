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
import { cacheGet, cacheSet, cacheKey, cacheClear, CACHE_MAX_BYTES, CACHE_TTL_MS } from '~/src/storage/cache';

/** 约占 fraction 份上限字节数的译文：中文每字 3 字节。 */
const zh = (fraction: number) => '译'.repeat(Math.floor((CACHE_MAX_BYTES * fraction) / 3));

const keyOf = (i: number) => cacheKey('google-web', 'en', 'zh-CN', `段落 ${i}`);
const stored = () => Object.keys(localStoreSnapshot()).filter((k) => k.startsWith('pt-c:'));

/** 写入含 key 的条目时报错 times 次，其余写入照常。 */
async function rejectWritesOf<T>(key: string, err: Error, times: number, run: () => Promise<T>): Promise<T> {
  const set = vi.mocked(chrome.storage.local.set);
  const original = set.getMockImplementation()! as (items: Record<string, unknown>) => Promise<void>;
  let left = times;
  set.mockImplementation((items: Record<string, unknown>) =>
    key in items && left-- > 0 ? Promise.reject(err) : original(items),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return await run();
  } finally {
    set.mockImplementation(original);
    warn.mockRestore();
  }
}

const QUOTA = () => new Error('QUOTA_BYTES quota exceeded');

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

  test('清空缓存与另一个页面的写入交错、旧 index 被写回后，照样能存放多条', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(keyOf));
    for (const k of keys.slice(0, 4)) await cacheSet(k, zh(0.24));
    // 后台读了 index 之后，设置页清空缓存，后台再把读到的 index 写回
    const snapshot = localStoreSnapshot();
    const indexData = Object.fromEntries(
      Object.entries(snapshot).filter(([k]) => k.startsWith('pt-cache-')),
    );
    await cacheClear();
    await chrome.storage.local.set(indexData);

    for (const k of keys.slice(4)) await cacheSet(k, zh(0.24));
    expect(stored()).toEqual(keys.slice(4));
  });

  test('过期移除的条目不再占字节数', async () => {
    const [a, b, c] = await Promise.all([keyOf(0), keyOf(1), keyOf(2)]);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await cacheSet(a, zh(0.45));
      clock.mockReturnValue(now + CACHE_TTL_MS + 1);
      expect(await cacheGet(a)).toBeNull();
      await cacheSet(b, zh(0.45));
      await cacheSet(c, zh(0.45));
    } finally {
      clock.mockRestore();
    }
    expect(stored().sort()).toEqual([b, c].sort());
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
    await rejectWritesOf(keys[4]!, QUOTA(), 1, () => cacheSet(keys[4]!, '新值'));

    expect(await cacheGet(keys[4]!)).toBe('新值');
    expect(await cacheGet(keys[0]!)).toBeNull();
    // 留下的是较新的那些
    const left = keys.slice(0, 4).filter((k) => stored().includes(k));
    expect(left).toEqual(keys.slice(4 - left.length, 4));
  });

  test('重试仍失败：新条目没有写入，之后的写入照常', async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4, 5].map(keyOf));
    for (const k of keys.slice(0, 4)) await cacheSet(k, `值 ${k}`);
    await rejectWritesOf(keys[4]!, QUOTA(), 2, () => cacheSet(keys[4]!, '新值'));
    expect(stored()).not.toContain(keys[4]);

    await cacheSet(keys[5]!, '之后');
    expect(await cacheGet(keys[5]!)).toBe('之后');
    const index = (await chrome.storage.local.get('pt-cache-index'))['pt-cache-index'] as string[];
    expect([...index].sort()).toEqual(stored().sort());
  });

  test('缓存为空时遇到配额错误：没有可淘汰的，不写入', async () => {
    const key = await keyOf(0);
    await rejectWritesOf(key, QUOTA(), 1, () => cacheSet(key, '值'));
    expect(stored()).toEqual([]);
  });

  test('不是配额错误：不淘汰也不重试，已有条目不动', async () => {
    const keys = await Promise.all([0, 1, 2].map(keyOf));
    for (const k of keys.slice(0, 2)) await cacheSet(k, `值 ${k}`);
    await rejectWritesOf(keys[2]!, new Error('storage broken'), 1, () => cacheSet(keys[2]!, '新值'));

    expect(stored().sort()).toEqual(keys.slice(0, 2).sort());
  });
});
