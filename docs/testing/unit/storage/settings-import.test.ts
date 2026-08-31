/**
 * storage/settings-import.ts — 设置导入整体替换语义（#324）
 *
 * 导入此前走逐键合并（patchSettings）：导入不含自定义模型名的配置时
 * 本机模型名残留，用户以为同步了配置实际打到的还是旧模型。
 * 本文件断言导入 = 整体替换：
 * - 不含 models 的配置 → 本机自定义模型名被清除（修复前失败）
 * - 含 models 的配置 → 模型名与文件一致
 * - 其余嵌套项（siteList / hotkeys）与模型名同语义
 * - 既有校验不回归：未知字段丢弃、并发钳制、CSS 校验、密钥剔除
 * - 无效 JSON → 配置保持不变
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

beforeEach(() => {
  resetStorage();
  vi.resetModules();
});

/** 加载模块并返回（每次 resetModules 后重新取）。 */
async function load() {
  return import('~/src/storage/settings-import');
}

describe('导入整体替换语义（#324）', () => {
  test('导入不含 models 的配置后，本机自定义模型名被清除（修复前失败）', async () => {
    const settingsMod = await import('~/src/storage/settings');
    await settingsMod.settingsReady();
    await settingsMod.patchSettings({ models: { openai: 'gpt-custom' } });
    expect(settingsMod.getSettings().models.openai).toBe('gpt-custom');

    const { importSettings } = await load();
    // 配置里没有任何 models 字段
    const result = await importSettings(
      JSON.stringify({ displayMode: 'translation-only' }),
    );
    expect(result.ok).toBe(true);
    expect(settingsMod.getSettings().displayMode).toBe('translation-only');
    // 模型名被清除（整体替换，缺省回落默认 {}）
    expect(settingsMod.getSettings().models).toEqual({});
  });

  test('导入含自定义模型名的配置后，模型名与文件一致', async () => {
    const settingsMod = await import('~/src/storage/settings');
    await settingsMod.settingsReady();
    await settingsMod.patchSettings({ models: { openai: 'old-model' } });

    const { importSettings } = await load();
    const result = await importSettings(
      JSON.stringify({ models: { gemini: 'gemini-new' } }),
    );
    expect(result.ok).toBe(true);
    expect(settingsMod.getSettings().models).toEqual({ gemini: 'gemini-new' });
  });

  test('其余嵌套配置项（siteList / hotkeys）与模型名同语义', async () => {
    const settingsMod = await import('~/src/storage/settings');
    await settingsMod.settingsReady();
    await settingsMod.patchSettings({
      siteList: { mode: 'blacklist', list: ['old.example.com'] },
      hotkeys: { 'toggle-translate': 'Alt+P' },
    });

    const { importSettings } = await load();
    const result = await importSettings(
      JSON.stringify({
        siteList: { mode: 'blacklist', list: ['new.example.com'] },
      }),
    );
    expect(result.ok).toBe(true);
    // siteList 整体覆盖为导入值
    expect(settingsMod.getSettings().siteList.list).toEqual([
      'new.example.com',
    ]);
    // hotkeys 未出现在导入文件 → 回落到默认（不残留本机自定义）
    expect(settingsMod.getSettings().hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys);
  });

  test('未知字段被丢弃、密钥字段被剔除', async () => {
    const { parseImport } = await load();
    const parsed = parseImport(
      JSON.stringify({
        displayMode: 'translation-only',
        unknownField: 'garbage',
        apiKeys: { openai: 'sk-secret' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const s = parsed.settings as unknown as Record<string, unknown>;
      expect(s.displayMode).toBe('translation-only');
      expect('unknownField' in s).toBe(false);
      expect('apiKeys' in s).toBe(false);
    }
  });

  test('并发数被钳制到合法范围（#172）', async () => {
    const { parseImport } = await load();
    const parsed = parseImport(JSON.stringify({ maxConcurrency: 0 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.settings.maxConcurrency).toBe(1);
  });

  test('自定义 CSS 被校验：非法 CSS 导入失败且配置保持不变', async () => {
    const settingsMod = await import('~/src/storage/settings');
    await settingsMod.settingsReady();
    await settingsMod.patchSettings({ displayMode: 'translation-only' });

    const { importSettings } = await load();
    const result = await importSettings(
      JSON.stringify({ customCss: '@import url(http://evil.example/x.css);' }),
    );
    expect(result.ok).toBe(false);
    // 配置未被改动
    expect(settingsMod.getSettings().displayMode).toBe('translation-only');
  });

  test('导入格式无效的 JSON 时配置保持不变', async () => {
    const settingsMod = await import('~/src/storage/settings');
    await settingsMod.settingsReady();
    await settingsMod.patchSettings({ displayMode: 'translation-only' });

    const { importSettings } = await load();
    expect((await importSettings('{not json')).ok).toBe(false);
    expect((await importSettings('[]')).ok).toBe(false);
    expect((await importSettings('"str"')).ok).toBe(false);
    expect(settingsMod.getSettings().displayMode).toBe('translation-only');
  });
});
