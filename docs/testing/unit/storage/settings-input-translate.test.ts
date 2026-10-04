/**
 * 输入翻译开关 inputTranslate —— 设置项本身（#635）
 *
 * 本票只做设置项，不做圆点：断言默认值、老用户升级、读写、
 * 导入（含旧版本导出文件）与恢复默认。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

beforeEach(() => {
  resetStorage();
  vi.resetModules();
});

describe('输入翻译开关（#635）', () => {
  test('空存储 → 默认开', async () => {
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).inputTranslate).toBe(true);
  });

  test('老用户升级：存储里没有这一项 → 取到默认值，其余设置不变', async () => {
    await chrome.storage.sync.set({ 'pt-settings': { showFloatingBall: false } });
    const { settingsReady } = await import('~/src/storage/settings');
    const s = await settingsReady();
    expect(s.inputTranslate).toBe(true);
    expect(s.showFloatingBall).toBe(false);
  });

  test('关掉后写入存储，另一个上下文重新读取也是关', async () => {
    const settings = await import('~/src/storage/settings');
    await settings.settingsReady();
    await settings.patchSettings({ inputTranslate: false });
    expect(settings.getSettings().inputTranslate).toBe(false);

    vi.resetModules();
    const again = await import('~/src/storage/settings');
    expect((await again.settingsReady()).inputTranslate).toBe(false);
  });

  test('导入关掉这一项的配置 → 关；导入旧版本文件（没有这一项）→ 回到默认开', async () => {
    const settings = await import('~/src/storage/settings');
    await settings.settingsReady();
    const { importSettings } = await import('~/src/storage/settings-import');

    expect((await importSettings(JSON.stringify({ inputTranslate: false }))).ok).toBe(true);
    expect(settings.getSettings().inputTranslate).toBe(false);

    expect((await importSettings(JSON.stringify({ displayMode: 'bilingual' }))).ok).toBe(true);
    expect(settings.getSettings().inputTranslate).toBe(true);
  });

  test('导出的设置带着这一项，导入回来值不变', async () => {
    const settings = await import('~/src/storage/settings');
    await settings.settingsReady();
    await settings.patchSettings({ inputTranslate: false });
    const exported = JSON.stringify(settings.getSettings());
    expect(JSON.parse(exported)).toHaveProperty('inputTranslate', false);

    await settings.patchSettings({ inputTranslate: true });
    const { importSettings } = await import('~/src/storage/settings-import');
    await importSettings(exported);
    expect(settings.getSettings().inputTranslate).toBe(false);
  });

  test('恢复默认 → 回到开', async () => {
    const settings = await import('~/src/storage/settings');
    await settings.settingsReady();
    await settings.patchSettings({ inputTranslate: false });
    const { resetSettings } = await import('~/src/storage/settings-reset');
    await resetSettings();
    expect(settings.getSettings().inputTranslate).toBe(true);
  });
});
