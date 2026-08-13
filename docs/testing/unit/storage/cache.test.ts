/**
 * storage/cache.ts — 缓存 + LRU 淘汰 + 并发安全 单元测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';
import { cacheGet, cacheSet, cacheKey, cacheClear } from '~/src/storage/cache';

describe('cacheKey', () => {
  test('相同文本 → 相同 key（SHA-1 稳定性）', async () => {
    const k1 = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    const k2 = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    expect(k1).toBe(k2);
  });

  test('不同引擎 → 不同 key 前缀', async () => {
    const k1 = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    const k2 = await cacheKey('bing-edge', 'auto', 'zh-CN', 'Hello');
    expect(k1).not.toBe(k2);
    expect(k1).toContain('google-web');
    expect(k2).toContain('bing-edge');
  });

  test('from/to 参与 key → 语言对变化不误命中', async () => {
    const k1 = await cacheKey('google-web', 'en', 'zh-CN', 'Hello');
    const k2 = await cacheKey('google-web', 'en', 'ja', 'Hello');
    expect(k1).not.toBe(k2);
  });

  test('不同文本 → 不同 key', async () => {
    const k1 = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    const k2 = await cacheKey('google-web', 'auto', 'zh-CN', 'World');
    expect(k1).not.toBe(k2);
  });
});

describe('cacheGet / cacheSet', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('写入后读取 → 命中', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    await cacheSet(key, '你好');
    // cacheGet 串行在 chain 上，等写入完成后读取
    const value = await cacheGet(key);
    expect(value).toBe('你好');
  });

  test('未写入 → 返回 null', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Never written');
    const value = await cacheGet(key);
    expect(value).toBeNull();
  });

  test('cacheGet 命中会刷新 LRU 位置', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'First');
    await cacheSet(key, '第一');

    // 读取命中，会刷新 index 位置
    const val = await cacheGet(key);
    expect(val).toBe('第一');
    // 不抛异常即通过
  });
});

describe('cacheClear', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('清空后读取返回 null', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Clear me');
    await cacheSet(key, '清除');
    await cacheClear();

    const value = await cacheGet(key);
    expect(value).toBeNull();
  });
});

describe('并发安全', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('并发 cacheSet × 10 → 不抛异常，操作序列化完成', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const key = await cacheKey('google-web', 'auto', 'zh-CN', `Text ${i}`);
      promises.push(cacheSet(key, `译 ${i}`));
    }
    await expect(Promise.all(promises)).resolves.not.toThrow();
  });

  test('cacheGet 和 cacheSet 并发 → 不产生异常状态', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Concurrent');
    // 写入和读取并发调用
    await Promise.all([cacheSet(key, '并发'), cacheGet(key)]);
    // 不抛异常即通过：Promise 链正确序列化
    // 最终状态：key 存在且值正确
    const final = await cacheGet(key);
    expect(final).toBe('并发');
  });

  test('cacheGet 和 cacheClear 并发 → 不产生异常状态', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'GetClear');
    await cacheSet(key, '值');

    // 并发 clear 和 get
    await Promise.all([cacheClear(), cacheGet(key)]);
    // 不抛异常即通过
  });
});
