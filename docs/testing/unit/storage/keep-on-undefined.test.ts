/**
 * storage/settings.ts — 显式 undefined 回落原值的标量键声明表（#989、#992）
 *
 * `{...base, ...patch}` 会让 patch 里显式为 undefined 的键冲掉原值：数值键接着被
 * 写入口钳制变成默认值，布尔与字符串键在写入的上下文里留成 undefined —— 静默重置。
 * KEEP_ON_UNDEFINED_KEYS 是挡这件事的唯一声明处，覆盖全部非嵌套键。
 *
 * 期望键表在这里独立写死，不从声明表导入：从声明表里去掉一个键，
 * 对应的那条用例必须变红；照声明表循环的用例做不到这一点。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { DEFAULT_SETTINGS, type Settings } from '~/src/storage/schema';

/** 每个键取一个合法且不等于默认值的值 */
const NON_DEFAULT: Record<string, unknown> = {
  enabled: false,
  enginePriority: ['bing-edge'],
  from: 'en',
  to: 'ja',
  displayMode: 'translation-only',
  paraDisplayMode: 'bilingual',
  style: 'dim',
  customCss: '.x{color:red}',
  showFloatingBall: false,
  showParagraphBtn: false,
  useCache: false,
  mtApplyTermTargets: true,
  inputTranslate: false,
  maxConcurrency: 3,
  floatingBallSize: 60,
  paraBtnSize: 34,
  paraBtnHideDelay: 2500,
  inputDotSize: 20,
  uiLocale: 'en',
};

/** 嵌套键另走 NESTED_KEYS，合并语义不在本表 */
const NESTED = ['hotkeys', 'models', 'siteList'];

describe('显式 undefined 的标量键保留原值（#989、#992）', () => {
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
      // 顺带携带一个别的键：style 自己在表里，测 style 时改带 to
      const other: [string, unknown] = key === 'style' ? ['to', 'ko'] : ['style', 'bold'];
      await patchSettings({ [key]: undefined, [other[0]]: other[1] } as never);

      expect(getSettings()[key as keyof Settings]).toEqual(value);
      const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as
        | Record<string, unknown>
        | undefined;
      expect(stored?.[key]).toEqual(value);
      // 同一个 patch 里的其它键照常生效
      expect(getSettings()[other[0] as keyof Settings]).toBe(other[1]);
    });
  }

  test('全部标量键同时显式 undefined → 全部保留', async () => {
    const { settingsReady, patchSettings, getSettings } = await import(
      '~/src/storage/settings'
    );
    await settingsReady();
    await patchSettings(NON_DEFAULT as never);
    await patchSettings(
      Object.fromEntries(Object.keys(NON_DEFAULT).map((k) => [k, undefined])) as never,
    );
    for (const [key, value] of Object.entries(NON_DEFAULT)) {
      expect(getSettings()[key as keyof Settings]).toEqual(value);
    }
  });

  test('声明表登记了全部非嵌套设置项：新加标量项漏登记时这里红', async () => {
    const { KEEP_ON_UNDEFINED_KEYS, NESTED_KEYS } = await import('~/src/storage/settings');
    expect(Object.keys(NESTED_KEYS).sort()).toEqual(NESTED);
    const scalarKeys = Object.keys(DEFAULT_SETTINGS)
      .filter((k) => !NESTED.includes(k))
      .sort();
    expect([...KEEP_ON_UNDEFINED_KEYS].sort()).toEqual(scalarKeys);
    // 与上面写死的期望表一致：声明表多登或少登都不会悄悄通过
    expect(scalarKeys).toEqual(Object.keys(NON_DEFAULT).sort());
  });

  test('嵌套键的显式 undefined 照旧由 NESTED_KEYS 处理：保持原值，兄弟键不丢', async () => {
    const { settingsReady, patchSettings, getSettings } = await import(
      '~/src/storage/settings'
    );
    await settingsReady();
    await patchSettings({ siteList: { mode: 'whitelist', list: ['a.com'] } } as never);
    await patchSettings({ siteList: undefined, enabled: false } as never);
    expect(getSettings().siteList).toEqual({ mode: 'whitelist', list: ['a.com'] });
    expect(getSettings().enabled).toBe(false);
  });
});
