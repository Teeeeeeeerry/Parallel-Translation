/**
 * storage/settings.ts — 并发钳制写入口契约测试（#254）
 *
 * 钳制只留 schema.clampConcurrency 一处定义；合并函数不再钳制、
 * 并发闸门只保留结构性防御。本契约钉死所有写入口（导入 / 跨上下文
 * 写入走 patchSettings、恢复默认走 replaceSettings）产出的并发数
 * 恒在合法范围 [1, 10]，#172 不回归。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS, CONCURRENCY_MIN, CONCURRENCY_MAX } from '~/src/storage/schema';

describe('并发钳制写入口契约（#254）', () => {
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
  });

  function assertInRange(v: number): void {
    expect(v).toBeGreaterThanOrEqual(CONCURRENCY_MIN);
    expect(v).toBeLessThanOrEqual(CONCURRENCY_MAX);
  }

  test('patchSettings（导入 / 跨上下文写入路径）：非法值一律钳制', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');
    await settingsReady();

    for (const bad of [0, -5, 999, 2.7, Number.NaN]) {
      await patchSettings({ maxConcurrency: bad as never });
      assertInRange(getSettings().maxConcurrency);
    }
    // 合法值原样保留
    await patchSettings({ maxConcurrency: 3 });
    expect(getSettings().maxConcurrency).toBe(3);
  });

  test('replaceSettings（恢复默认路径）：越界值同样钳制', async () => {
    const { replaceSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');
    await settingsReady();

    await replaceSettings({ ...DEFAULT_SETTINGS, maxConcurrency: 0 });
    expect(getSettings().maxConcurrency).toBe(1);
    await replaceSettings({ ...DEFAULT_SETTINGS, maxConcurrency: 999 });
    expect(getSettings().maxConcurrency).toBe(10);
    // 恢复默认本身在合法范围
    await replaceSettings(DEFAULT_SETTINGS);
    assertInRange(getSettings().maxConcurrency);
  });

  test('patch 未携带 maxConcurrency（含显式 undefined）→ 保持原值', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await patchSettings({ maxConcurrency: 4 });
    await patchSettings({ style: 'bold' });
    expect(getSettings().maxConcurrency).toBe(4);
    await patchSettings({ maxConcurrency: undefined });
    expect(getSettings().maxConcurrency).toBe(4);
  });
});
