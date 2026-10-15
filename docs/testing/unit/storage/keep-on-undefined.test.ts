/**
 * storage/settings.ts — 显式 undefined 回落原值的标量键声明表（#989）
 *
 * `{...base, ...patch}` 会让 patch 里显式为 undefined 的键冲掉原值，接着写入口
 * 钳制把 undefined 变成默认值 —— 静默重置。KEEP_ON_UNDEFINED_KEYS 是挡这件事的
 * 唯一声明处。
 *
 * 期望键表在这里独立写死，不从声明表导入：从声明表里去掉一个键，
 * 对应的那条用例必须变红；照声明表循环的用例做不到这一点。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS, type Settings } from '~/src/storage/schema';

/** 每个键取一个合法且不等于默认值的值 */
const NON_DEFAULT: Record<string, number> = {
  maxConcurrency: 3,
  floatingBallSize: 60,
  paraBtnSize: 34,
  paraBtnHideDelay: 2500,
};

describe('显式 undefined 的标量键保留原值（#989）', () => {
  beforeEach(() => {
    resetStorage();
    vi.resetModules();
  });

  for (const [key, value] of Object.entries(NON_DEFAULT)) {
    test(`${key}：patch 显式带 undefined → 内存与存储都保留原值，不回默认`, async () => {
      const { settingsReady, patchSettings, getSettings } = await import(
        '~/src/storage/settings'
      );
      await settingsReady();
      expect(value).not.toBe(DEFAULT_SETTINGS[key as keyof Settings]);

      await patchSettings({ [key]: value } as never);
      await patchSettings({ [key]: undefined, style: 'bold' } as never);

      expect(getSettings()[key as keyof Settings]).toBe(value);
      const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as
        | Record<string, unknown>
        | undefined;
      expect(stored?.[key]).toBe(value);
      // 同一个 patch 里的其它键照常生效
      expect(getSettings().style).toBe('bold');
    });
  }

  test('四个键同时显式 undefined → 全部保留', async () => {
    const { settingsReady, patchSettings, getSettings } = await import(
      '~/src/storage/settings'
    );
    await settingsReady();
    await patchSettings(NON_DEFAULT as never);
    await patchSettings(
      Object.fromEntries(Object.keys(NON_DEFAULT).map((k) => [k, undefined])) as never,
    );
    for (const [key, value] of Object.entries(NON_DEFAULT)) {
      expect(getSettings()[key as keyof Settings]).toBe(value);
    }
  });

  test('声明表登记了全部数值设置项：新加数值项漏登记时这里红', async () => {
    const { KEEP_ON_UNDEFINED_KEYS } = await import('~/src/storage/settings');
    const numericKeys = Object.entries(DEFAULT_SETTINGS)
      .filter(([, v]) => typeof v === 'number')
      .map(([k]) => k)
      .sort();
    expect([...KEEP_ON_UNDEFINED_KEYS].sort()).toEqual(numericKeys);
    // 与上面写死的期望表一致：声明表多登或少登都不会悄悄通过
    expect(numericKeys).toEqual(Object.keys(NON_DEFAULT).sort());
  });
});
