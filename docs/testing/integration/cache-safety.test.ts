/**
 * integration/cache-safety.test.ts — 缓存并发安全
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { cacheSet, cacheGet, cacheClear, cacheKey } from '~/src/storage/cache';

describe('缓存并发安全', () => {
  beforeEach(() => {
    resetStorage();
  });

  test('并发写入多条 → 所有条目可读回', async () => {
    const entries: { key: string; value: string }[] = [];

    for (let i = 0; i < 20; i++) {
      const key = await cacheKey('test', 'en', 'zh', `Text-${i}`);
      entries.push({ key, value: `译-${i}` });
    }

    // 并发写入
    await Promise.all(entries.map((e) => cacheSet(e.key, e.value)));

    // 等待链完成 → 读回验证
    for (const { key, value } of entries) {
      const stored = await cacheGet(key);
      expect(stored).toBe(value);
    }
  });

  test('cacheClear 和 cacheSet 并发 → 不产生异常状态', async () => {
    const key = await cacheKey('test', 'en', 'zh', 'Race');
    await Promise.all([cacheClear(), cacheSet(key, '值')]);

    // 最终状态一致
    const result = await cacheGet(key);
    // 要么清空前写入的值、要么清空后被覆盖——两者都是合法终态
    expect(result === null || result === '值').toBe(true);
  });
});
