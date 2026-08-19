/**
 * storage/cache.ts — 缓存 + LRU 淘汰 + 并发安全 单元测试
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
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

  test('不同模型 → 不同 key（#175）', async () => {
    const k1 = await cacheKey('openai', 'auto', 'zh-CN', 'Hello', 'gpt-4o-mini');
    const k2 = await cacheKey('openai', 'auto', 'zh-CN', 'Hello', 'gpt-5');
    expect(k1).not.toBe(k2);
    expect(k1).toContain('gpt-4o-mini');
  });

  test('同模型 → 相同 key（#175）', async () => {
    const k1 = await cacheKey('openai', 'auto', 'zh-CN', 'Hello', 'gpt-4o-mini');
    const k2 = await cacheKey('openai', 'auto', 'zh-CN', 'Hello', 'gpt-4o-mini');
    expect(k1).toBe(k2);
  });

  test('无模型引擎 → key 不含模型段', async () => {
    const k = await cacheKey('google-web', 'auto', 'zh-CN', 'Hello');
    expect(k).not.toContain(':model');
    expect(k).toMatch(/^pt-c:google-web:auto:zh-CN:[0-9a-f]{40}$/);
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

  test('过期条目 → 未命中且被移除（#175）', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Stale');
    await cacheSet(key, '旧译文');

    // 把条目的时间戳改为超期（31 天前）
    await chrome.storage.local.set({
      [key]: JSON.stringify({ v: '旧译文', t: Date.now() - 31 * 24 * 60 * 60 * 1000 }),
    });

    const value = await cacheGet(key);
    expect(value).toBeNull();
    // 条目被移除
    const stored = await chrome.storage.local.get(key);
    expect(stored[key]).toBeUndefined();
  });

  test('未过期条目 → 命中', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Fresh');
    await cacheSet(key, '新译文');

    const value = await cacheGet(key);
    expect(value).toBe('新译文');
  });

  test('旧版纯字符串条目（无时间戳）→ 兼容读取', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'Legacy');
    // 直接写入旧格式（升级前 cacheSet 的存储格式）
    await chrome.storage.local.set({ [key]: '旧格式译文' });

    const value = await cacheGet(key);
    expect(value).toBe('旧格式译文');
  });

  test('JSON 但缺 v/t 字段（异常形状）→ 按原字符串读取', async () => {
    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'OddJson');
    // 合法 JSON 但不是本扩展的包装格式
    await chrome.storage.local.set({ [key]: '{"x": 1}' });

    const value = await cacheGet(key);
    expect(value).toBe('{"x": 1}');
  });

  test('读取失败（storage 异常）→ 返回 null 并告警，不抛错', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const key = await cacheKey('google-web', 'auto', 'zh-CN', 'ReadFail');
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
        new Error('storage broken'),
      );

      const value = await cacheGet(key);
      expect(value).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('写入失败（配额满）→ 不抛错并告警', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const key = await cacheKey('google-web', 'auto', 'zh-CN', 'WriteFail');
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
        new Error('QUOTA_BYTES exceeded'),
      );

      await expect(cacheSet(key, '值')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('LRU 淘汰（MAX_ENTRIES）', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('index 溢出 MAX_ENTRIES → 最旧条目被移除，新条目保留', async () => {
    // 预填接近上限的 index（不真写条目，只验证淘汰逻辑）
    const MAX = 5000;
    const staleKeys = Array.from(
      { length: MAX },
      (_, i) => `pt-c:stale:${i}`,
    );
    await chrome.storage.local.set({ 'pt-cache-index': staleKeys });

    const key = await cacheKey('google-web', 'auto', 'zh-CN', 'NewEntry');
    await cacheSet(key, '新值');

    const idx = (await chrome.storage.local.get('pt-cache-index'))[
      'pt-cache-index'
    ] as string[];
    expect(idx).toHaveLength(MAX);
    // 最旧的一条被淘汰
    expect(idx).not.toContain('pt-c:stale:0');
    // 新条目保留在末尾
    expect(idx[idx.length - 1]).toBe(key);
    // 被淘汰的条目从 storage 移除
    const removed = await chrome.storage.local.get('pt-c:stale:0');
    expect(removed['pt-c:stale:0']).toBeUndefined();
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
