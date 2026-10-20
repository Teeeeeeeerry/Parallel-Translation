/**
 * 扩展语言设置项 uiLocale（#1100，父 #1098）
 *
 * 默认“跟随浏览器”；写入口校验，非法值回落默认。导入、恢复默认、跨上下文
 * 写入与其他设置项同一口径 —— 先例见悬浮 UI 三个设置项（ui-size-import-reset）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage, fireStorageChange } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS, normalizeUiLocale } from '~/src/storage/schema';

beforeEach(() => {
  resetStorage();
  vi.resetModules();
});

async function context() {
  const settings = await import('~/src/storage/settings');
  await settings.settingsReady();
  return settings;
}

async function stored(): Promise<Record<string, unknown>> {
  return (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as Record<string, unknown>;
}

describe('取值', () => {
  test('默认跟随浏览器', async () => {
    expect(DEFAULT_SETTINGS.uiLocale).toBe('browser');
    const s = await context();
    expect(s.getSettings().uiLocale).toBe('browser');
  });

  test('三种界面语言与跟随浏览器原样保留，其余一律回落跟随浏览器', () => {
    for (const ok of ['browser', 'en', 'zh_CN', 'zh_TW']) expect(normalizeUiLocale(ok)).toBe(ok);
    for (const bad of ['ja', 'zh-CN', 'EN', '', null, undefined, 1, {}]) {
      expect(normalizeUiLocale(bad)).toBe('browser');
    }
  });
});

describe('写入口校验', () => {
  test('patchSettings：合法值写入，非法值写进存储前回落默认', async () => {
    const s = await context();
    await s.patchSettings({ uiLocale: 'zh_TW' });
    expect(s.getSettings().uiLocale).toBe('zh_TW');
    expect((await stored()).uiLocale).toBe('zh_TW');

    await s.patchSettings({ uiLocale: 'ja' as never });
    expect(s.getSettings().uiLocale).toBe('browser');
    expect((await stored()).uiLocale).toBe('browser');
  });

  test('存储里留着脏值：读出来就是跟随浏览器', async () => {
    await chrome.storage.sync.set({ 'pt-settings': { uiLocale: 'fr' } });
    const s = await context();
    expect(s.getSettings().uiLocale).toBe('browser');
  });

  test('patch 不带扩展语言时保留原值', async () => {
    const s = await context();
    await s.patchSettings({ uiLocale: 'en' });
    await s.patchSettings({ style: 'bold' });
    await s.patchSettings({ uiLocale: undefined, to: 'ja' });
    expect(s.getSettings().uiLocale).toBe('en');
  });
});

describe('导入', () => {
  test('带扩展语言的配置导入后生效', async () => {
    const s = await context();
    const { importSettings } = await import('~/src/storage/settings-import');
    expect(await importSettings(JSON.stringify({ uiLocale: 'en' }))).toEqual({ ok: true });
    expect(s.getSettings().uiLocale).toBe('en');
  });

  test('缺这一项、为 null 或值无效：回落跟随浏览器', async () => {
    const s = await context();
    const { importSettings } = await import('~/src/storage/settings-import');
    for (const json of [{ style: 'bold' }, { uiLocale: null }, { uiLocale: 'de' }]) {
      await s.patchSettings({ uiLocale: 'zh_TW' });
      await importSettings(JSON.stringify(json));
      expect(s.getSettings().uiLocale, JSON.stringify(json)).toBe('browser');
      expect((await stored()).uiLocale).toBe('browser');
    }
  });
});

describe('恢复默认', () => {
  test('回到跟随浏览器', async () => {
    const s = await context();
    await s.patchSettings({ uiLocale: 'en' });
    const { resetSettings } = await import('~/src/storage/settings-reset');
    await resetSettings();
    expect(s.getSettings().uiLocale).toBe('browser');
    expect((await stored()).uiLocale).toBe('browser');
  });
});

describe('跨上下文写入', () => {
  test('设置页改扩展语言，popup 刚改的显示模式不被回滚；另一上下文收到新值', async () => {
    const options = await context();
    vi.resetModules();
    const popup = await context();
    await popup.patchSettings({ displayMode: 'translation-only' });

    await options.patchSettings({ uiLocale: 'zh_CN' });
    const after = await stored();
    expect(after.uiLocale).toBe('zh_CN');
    expect(after.displayMode).toBe('translation-only');

    const seen: string[] = [];
    popup.onSettingsChanged((s) => seen.push(s.uiLocale));
    fireStorageChange({ 'pt-settings': { newValue: after } });
    expect(seen).toEqual(['zh_CN']);
    expect(popup.getSettings().uiLocale).toBe('zh_CN');
  });
});
