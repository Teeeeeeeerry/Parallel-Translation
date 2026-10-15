/**
 * 悬浮 UI 三个设置项的导入、恢复默认与跨上下文写入（#974，父 #964）
 *
 * 悬浮球尺寸（#966）、逐段翻译按钮尺寸（#970）、按钮显示时长（#972）都
 * 走既有通路：导入是整体替换（#324），白名单取自 DEFAULT_SETTINGS 的键；
 * 恢复默认走 replaceSettings；两条都经写入口钳制（clampWriteEntry）。
 * 跨上下文写入先读存储再合并（#167），设置页拖滑块不回滚 popup 刚改的设置。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import {
  DEFAULT_SETTINGS,
  BALL_SIZE_MAX,
  PARA_BTN_SIZE_MIN,
  PARA_BTN_HIDE_DELAY_MIN,
} from '~/src/storage/schema';

const SIZE_KEYS = ['floatingBallSize', 'paraBtnSize', 'paraBtnHideDelay'] as const;

beforeEach(() => {
  resetStorage();
  vi.resetModules();
});

async function context() {
  const settings = await import('~/src/storage/settings');
  await settings.settingsReady();
  return settings;
}

/** 已经调过三项的本机：导入、恢复默认之前的起点 */
async function customized() {
  const settings = await context();
  await settings.patchSettings({ floatingBallSize: 60, paraBtnSize: 36, paraBtnHideDelay: 2500 });
  return settings;
}

describe('导入（#974）', () => {
  test('导入不含这三个字段的旧配置：回落默认值，不是 0、空或保留本机旧值', async () => {
    const settings = await customized();
    const { importSettings } = await import('~/src/storage/settings-import');
    const old = { ...DEFAULT_SETTINGS, style: 'bold' } as Record<string, unknown>;
    for (const k of SIZE_KEYS) delete old[k];
    expect(await importSettings(JSON.stringify(old))).toEqual({ ok: true });

    const s = settings.getSettings();
    expect(s.style).toBe('bold');
    expect(s.floatingBallSize).toBe(44);
    expect(s.paraBtnSize).toBe(24);
    expect(s.paraBtnHideDelay).toBe(1500);
  });

  test('三个字段为 null 时同样回落默认', async () => {
    const settings = await customized();
    const { importSettings } = await import('~/src/storage/settings-import');
    await importSettings(JSON.stringify({ floatingBallSize: null, paraBtnSize: null, paraBtnHideDelay: null }));
    const s = settings.getSettings();
    expect([s.floatingBallSize, s.paraBtnSize, s.paraBtnHideDelay]).toEqual([44, 24, 1500]);
  });

  test('导入手改过的超范围值：写进存储前已钳制，按钮仍点得中', async () => {
    const settings = await context();
    const { importSettings } = await import('~/src/storage/settings-import');
    await importSettings(JSON.stringify({ floatingBallSize: 999, paraBtnSize: 2, paraBtnHideDelay: 50 }));
    const s = settings.getSettings();
    expect(s.floatingBallSize).toBe(BALL_SIZE_MAX);
    expect(s.paraBtnSize).toBe(PARA_BTN_SIZE_MIN);
    expect(s.paraBtnSize).toBeGreaterThanOrEqual(24);
    expect(s.paraBtnHideDelay).toBe(PARA_BTN_HIDE_DELAY_MIN);
    const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as Record<string, number>;
    expect(stored.paraBtnSize).toBe(PARA_BTN_SIZE_MIN);
  });

  test('导入合法值原样生效（换机器时手感一致）', async () => {
    const settings = await context();
    const { importSettings } = await import('~/src/storage/settings-import');
    await importSettings(JSON.stringify({ floatingBallSize: 56, paraBtnSize: 32, paraBtnHideDelay: 2200 }));
    const s = settings.getSettings();
    expect([s.floatingBallSize, s.paraBtnSize, s.paraBtnHideDelay]).toEqual([56, 32, 2200]);
  });

  test('白名单取自默认设置的键：默认设置里的每个字段（含三个新字段）带值导入都不被丢弃', async () => {
    const { parseImport } = await import('~/src/storage/settings-import');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const r = parseImport(JSON.stringify({ [key]: (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key] }));
      expect(r.ok, key).toBe(true);
      if (r.ok) expect(key in r.settings, key).toBe(true);
    }
    for (const key of SIZE_KEYS) {
      const r = parseImport(JSON.stringify({ [key]: 33 }));
      expect(r.ok && (r.settings as unknown as Record<string, unknown>)[key], key).toBe(33);
    }
  });
});

describe('恢复默认（#974）', () => {
  test('三个值一起回到默认', async () => {
    const settings = await customized();
    const { resetSettings } = await import('~/src/storage/settings-reset');
    await resetSettings();
    const s = settings.getSettings();
    expect([s.floatingBallSize, s.paraBtnSize, s.paraBtnHideDelay]).toEqual([44, 24, 1500]);
    const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as Record<string, number>;
    expect([stored.floatingBallSize, stored.paraBtnSize, stored.paraBtnHideDelay]).toEqual([44, 24, 1500]);
  });
});

describe('跨上下文写入（#974）', () => {
  test('设置页的内存副本是旧的，popup 刚改了显示模式：设置页改尺寸不把它回滚', async () => {
    // 设置页：先加载，内存副本停在默认值
    const options = await context();
    // popup：另一个上下文（另一份模块实例）改显示模式与样式
    vi.resetModules();
    const popup = await context();
    await popup.patchSettings({ displayMode: 'translation-only', style: 'underline' });

    // 设置页拖滑块写尺寸 —— 只带自己的键
    await options.patchSettings({ floatingBallSize: 60 });
    await options.patchSettings({ paraBtnHideDelay: 900 });

    const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as Record<string, unknown>;
    expect(stored.displayMode).toBe('translation-only');
    expect(stored.style).toBe('underline');
    expect(stored.floatingBallSize).toBe(60);
    expect(stored.paraBtnHideDelay).toBe(900);
  });
});
