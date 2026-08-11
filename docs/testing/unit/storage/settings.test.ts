/**
 * storage/settings.ts — 设置合并与跨上下文同步 单元测试
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage, fireStorageChange } from '~/docs/testing/setup';
import {
  settingsReady,
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

// settings.ts 内部有模块级变量（current / ready），需要在每个测试前重置
// 注意：模块只加载一次，所以 settingsReady() 的缓存 Promise 会影响测试

describe('merge / patchSettings', () => {
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
  });

  test('空存储 → 全量默认值', async () => {
    const { settingsReady, getSettings } = await import('~/src/storage/settings');
    const s = await settingsReady();
    expect(s.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(s.enginePriority).toEqual(DEFAULT_SETTINGS.enginePriority);
    expect(s.displayMode).toBe(DEFAULT_SETTINGS.displayMode);
  });

  test('部分覆盖 → 其余保持默认', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({ displayMode: 'translation-only' });

    const s = getSettings();
    expect(s.displayMode).toBe('translation-only');
    // 其余字段保持默认
    expect(s.style).toBe(DEFAULT_SETTINGS.style);
    expect(s.enabled).toBe(DEFAULT_SETTINGS.enabled);
  });

  test('hotkeys 部分覆盖 → 兄弟键不丢失', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({
      hotkeys: { 'toggle-translate': 'Mod+Shift+T' },
    });

    const s = getSettings();
    // 修改的键被覆盖
    expect(s.hotkeys['toggle-translate']).toBe('Mod+Shift+T');
    // 兄弟键不丢
    expect(s.hotkeys['toggle-mode']).toBe(DEFAULT_SETTINGS.hotkeys['toggle-mode']);
    expect(s.hotkeys['translate-paragraph']).toBe(DEFAULT_SETTINGS.hotkeys['translate-paragraph']);
  });

  test('siteList 部分覆盖 → mode 和 list 独立合并', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({
      siteList: { mode: 'whitelist' },
    });

    const s = getSettings();
    expect(s.siteList.mode).toBe('whitelist');
    expect(s.siteList.list).toEqual(DEFAULT_SETTINGS.siteList.list);
  });

  test('models 部分覆盖 → 引擎 key 独立合并', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({
      models: { openai: 'gpt-4o' },
    });

    const s = getSettings();
    expect(s.models.openai).toBe('gpt-4o');
  });

  test('patchSettings 传 {} → 不改变任何值', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    const before = { ...getSettings() };
    await patchSettings({});
    const after = getSettings();
    expect(after).toEqual(before);
  });

  test('连续两次 patchSettings → 第二次基于第一次的结果', async () => {
    const { patchSettings } = await import('~/src/storage/settings');
    const { settingsReady, getSettings } = await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({ displayMode: 'translation-only' });
    await patchSettings({ style: 'underline' });

    const s = getSettings();
    expect(s.displayMode).toBe('translation-only'); // 第一次修改保留
    expect(s.style).toBe('underline'); // 第二次修改生效
  });
});

describe('onSettingsChanged', () => {
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
  });

  test('设置变更 → 回调触发', async () => {
    const { onSettingsChanged, settingsReady } = await import('~/src/storage/settings');
    await settingsReady();

    const fn = vi.fn();
    const unsubscribe = onSettingsChanged(fn);

    fireStorageChange({
      'pt-settings': {
        oldValue: DEFAULT_SETTINGS,
        newValue: { ...DEFAULT_SETTINGS, displayMode: 'translation-only' },
      },
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: 'translation-only' }),
    );

    unsubscribe();
  });

  test('无关 key 变更 → 回调不触发', async () => {
    const { onSettingsChanged, settingsReady } = await import('~/src/storage/settings');
    await settingsReady();

    const fn = vi.fn();
    onSettingsChanged(fn);

    fireStorageChange({
      'some-other-key': { newValue: 'value' },
    });

    expect(fn).not.toHaveBeenCalled();
  });

  test('退订 → 回调不再触发', async () => {
    const { onSettingsChanged, settingsReady } = await import('~/src/storage/settings');
    await settingsReady();

    const fn = vi.fn();
    const unsubscribe = onSettingsChanged(fn);

    unsubscribe();

    fireStorageChange({
      'pt-settings': {
        oldValue: DEFAULT_SETTINGS,
        newValue: { ...DEFAULT_SETTINGS, style: 'bold' },
      },
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
