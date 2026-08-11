/**
 * integration/settings-sync.test.ts — 设置跨上下文同步
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage, fireStorageChange } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

describe('设置跨上下文同步', () => {
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
  });

  test('settingsReady 缓存复用 — 多次调用返回同一个 Promise', async () => {
    const { settingsReady } = await import('~/src/storage/settings');
    const p1 = settingsReady();
    const p2 = settingsReady();
    expect(p1).toBe(p2);
  });

  test('onSettingsChanged 接收 patchSettings 触发的变更', async () => {
    const { settingsReady, patchSettings, onSettingsChanged } =
      await import('~/src/storage/settings');

    await settingsReady();

    const fn = vi.fn();
    onSettingsChanged(fn);

    // 模拟另一个上下文修改了设置
    fireStorageChange({
      'pt-settings': {
        oldValue: DEFAULT_SETTINGS,
        newValue: { ...DEFAULT_SETTINGS, style: 'bold' },
      },
    });

    expect(fn).toHaveBeenCalledTimes(1);
    const updated = fn.mock.calls[0]![0];
    expect(updated.style).toBe('bold');
  });
});
