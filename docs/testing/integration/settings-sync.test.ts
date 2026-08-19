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

  test('陈旧内存副本 patch → 写前重读存储，不覆盖其他上下文写入（#167）', async () => {
    const { settingsReady, patchSettings } = await import('~/src/storage/settings');
    await settingsReady();

    // 模拟上下文 A 写入 displayMode（直接写存储；本实例不触发
    // onChanged，内存副本保持陈旧 —— 等价于另一个标签页的修改）
    await chrome.storage.sync.set({
      'pt-settings': { ...DEFAULT_SETTINGS, displayMode: 'translation-only' },
    });

    // 本上下文用陈旧内存副本 patch style —— 修复前整对象覆盖，
    // displayMode 被静默回滚（lost update）；修复后写前重读存储，
    // 基于最新值合并，两个修改都保留
    await patchSettings({ style: 'bold' });

    const stored = ((await chrome.storage.sync.get('pt-settings'))[
      'pt-settings'
    ] ?? {}) as Record<string, unknown>;
    expect(stored.displayMode).toBe('translation-only');
    expect(stored.style).toBe('bold');
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
