/**
 * storage/settings-reset.ts — 恢复默认设置（#612）
 *
 * 恢复默认：清翻译缓存、清掉全部自带 key 引擎的 key（范围取自引擎清单，
 * #608）、设置整体替换为默认值（自定义模型名不残留，#169）。
 * 新引擎 DeepSeek 的 key 与自定义模型名也被清掉，默认优先级不变。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

beforeEach(() => {
  resetStorage();
  vi.resetModules();
});

describe('恢复默认设置（#612）', () => {
  test('DeepSeek 的 key 与自定义模型名都被清掉，默认优先级不变', async () => {
    const settings = await import('~/src/storage/settings');
    const keys = await import('~/src/storage/keys');
    await settings.settingsReady();
    await settings.patchSettings({
      enginePriority: ['deepseek', 'google-web'],
      models: { deepseek: 'deepseek-pro', openai: 'gpt-custom' },
    });
    await keys.setKey('deepseek', 'sk-ds');
    await keys.setKey('openai', 'sk-oa');

    const { resetSettings } = await import('~/src/storage/settings-reset');
    await resetSettings();

    expect(await keys.getKey('deepseek')).toBeUndefined();
    expect(await keys.getKey('openai')).toBeUndefined();
    expect(settings.getSettings().models).toEqual({});
    expect(settings.getSettings().enginePriority).toEqual(['google-web', 'bing-edge']);
    expect(settings.getSettings()).toEqual(DEFAULT_SETTINGS);
    // 写进了存储，别的上下文读到的也是默认值
    const stored = (await chrome.storage.sync.get(null)) as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain('deepseek');
  });

  test('翻译缓存被清空', async () => {
    const cache = await import('~/src/storage/cache');
    await cache.cacheSet('pt-c:deepseek:k', '译文');
    expect(await cache.cacheGet('pt-c:deepseek:k')).toBe('译文');

    const { resetSettings } = await import('~/src/storage/settings-reset');
    await resetSettings();

    expect(await cache.cacheGet('pt-c:deepseek:k')).toBeNull();
  });
});
