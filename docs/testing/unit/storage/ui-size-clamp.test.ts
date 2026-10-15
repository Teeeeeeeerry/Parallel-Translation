/**
 * 悬浮 UI 尺寸的钳制（#966，父 #964）
 *
 * 钳制定义在 schema 一处，生效点是 settings.ts 的写入口（导入、跨上下文
 * 写入走 patchSettings，恢复默认走 replaceSettings）。设置页滑块的范围只是
 * 第二道防线：导出的 JSON 手改后再导入可以绕过界面。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import {
  DEFAULT_SETTINGS,
  BALL_SIZE_MIN,
  BALL_SIZE_MAX,
  clampBallSize,
  PARA_BTN_SIZE_MIN,
  PARA_BTN_SIZE_MAX,
  clampParaBtnSize,
} from '~/src/storage/schema';

describe('clampBallSize（#966）', () => {
  test('默认值就是原来的 44px，且在合法范围内', () => {
    expect(DEFAULT_SETTINGS.floatingBallSize).toBe(44);
    expect(clampBallSize(44)).toBe(44);
  });

  test('超上限钳到上限，低于下限钳到下限，小数取整', () => {
    expect(clampBallSize(BALL_SIZE_MAX + 100)).toBe(BALL_SIZE_MAX);
    expect(clampBallSize(0)).toBe(BALL_SIZE_MIN);
    expect(clampBallSize(-20)).toBe(BALL_SIZE_MIN);
    expect(clampBallSize(50.6)).toBe(51);
  });

  test('非数字、NaN、Infinity 回落默认值，而不是钳到某一端', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '60', null, undefined, {}]) {
      expect(clampBallSize(bad)).toBe(44);
    }
  });
});

describe('写入口单点钳制（#966）', () => {
  beforeEach(() => {
    resetStorage();
    vi.resetModules();
  });

  test('patchSettings（导入 / 跨上下文写入路径）：越界与非法值写进存储前已钳制', async () => {
    const { settingsReady, getSettings, patchSettings } = await import('~/src/storage/settings');
    await settingsReady();

    await patchSettings({ floatingBallSize: 999 });
    expect(getSettings().floatingBallSize).toBe(BALL_SIZE_MAX);
    const stored = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as { floatingBallSize: number };
    expect(stored.floatingBallSize).toBe(BALL_SIZE_MAX);

    await patchSettings({ floatingBallSize: Number.NaN });
    expect(getSettings().floatingBallSize).toBe(44);

    await patchSettings({ floatingBallSize: 56 });
    expect(getSettings().floatingBallSize).toBe(56);
  });

  test('patch 不带尺寸时保留原值', async () => {
    const { settingsReady, getSettings, patchSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await patchSettings({ floatingBallSize: 60 });
    await patchSettings({ style: 'bold' });
    expect(getSettings().floatingBallSize).toBe(60);
  });

  test('replaceSettings（恢复默认路径）同样钳制', async () => {
    const { settingsReady, getSettings, replaceSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await replaceSettings({ ...DEFAULT_SETTINGS, floatingBallSize: 1 });
    expect(getSettings().floatingBallSize).toBe(BALL_SIZE_MIN);
  });
});

describe('clampParaBtnSize（#970）', () => {
  test('默认值就是原来的 24px 点击下限', () => {
    expect(DEFAULT_SETTINGS.paraBtnSize).toBe(24);
  });

  test('下限不低于 24px —— 8px 字号那版实测约 20×15px，指针要瞄准才点得中', () => {
    expect(PARA_BTN_SIZE_MIN).toBeGreaterThanOrEqual(24);
    for (const v of [0, 1, 16, 23, -10]) {
      expect(clampParaBtnSize(v)).toBeGreaterThanOrEqual(24);
    }
  });

  test('超上限钳到上限，非数字与 NaN 回落默认', () => {
    expect(clampParaBtnSize(PARA_BTN_SIZE_MAX + 50)).toBe(PARA_BTN_SIZE_MAX);
    expect(clampParaBtnSize(31.4)).toBe(31);
    for (const bad of [Number.NaN, '32', null, undefined]) {
      expect(clampParaBtnSize(bad)).toBe(24);
    }
  });

  test('写入口钳制：导入手改成 8px 的配置写进存储时已是 24px', async () => {
    resetStorage();
    vi.resetModules();
    const { settingsReady, getSettings, patchSettings, replaceSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await patchSettings({ paraBtnSize: 8 });
    expect(getSettings().paraBtnSize).toBe(PARA_BTN_SIZE_MIN);
    await replaceSettings({ ...DEFAULT_SETTINGS, paraBtnSize: 999 });
    expect(getSettings().paraBtnSize).toBe(PARA_BTN_SIZE_MAX);
  });
});


describe('clampParaBtnHideDelay（#972）', () => {
  test('默认 1500ms，与原来的固定延迟相同', async () => {
    const { DEFAULT_SETTINGS: d } = await import('~/src/storage/schema');
    expect(d.paraBtnHideDelay).toBe(1500);
  });

  test('范围 500–3000ms：越界钳到两端，取整到毫秒，脏值回落默认', async () => {
    const { clampParaBtnHideDelay, PARA_BTN_HIDE_DELAY_MIN, PARA_BTN_HIDE_DELAY_MAX } = await import('~/src/storage/schema');
    expect(PARA_BTN_HIDE_DELAY_MIN).toBe(500);
    expect(PARA_BTN_HIDE_DELAY_MAX).toBe(3000);
    expect(clampParaBtnHideDelay(0)).toBe(500);
    expect(clampParaBtnHideDelay(99999)).toBe(3000);
    expect(clampParaBtnHideDelay(1234.6)).toBe(1235);
    for (const bad of [Number.NaN, '800', null, undefined]) {
      expect(clampParaBtnHideDelay(bad)).toBe(1500);
    }
  });

  test('写入口钳制：patchSettings 与 replaceSettings', async () => {
    resetStorage();
    vi.resetModules();
    const { settingsReady, getSettings, patchSettings, replaceSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await patchSettings({ paraBtnHideDelay: 50 });
    expect(getSettings().paraBtnHideDelay).toBe(500);
    await patchSettings({ style: 'bold' });
    expect(getSettings().paraBtnHideDelay).toBe(500);
    await replaceSettings({ ...DEFAULT_SETTINGS, paraBtnHideDelay: 10_000 });
    expect(getSettings().paraBtnHideDelay).toBe(3000);
  });
});

describe('clampInputDotSize（#987）', () => {
  test('默认 14px，与原来的硬编码相同', async () => {
    const { DEFAULT_SETTINGS: d } = await import('~/src/storage/schema');
    expect(d.inputDotSize).toBe(14);
  });

  test('范围 12–24px：越界钳到两端，取整，脏值回落默认', async () => {
    const { clampInputDotSize, INPUT_DOT_SIZE_MIN, INPUT_DOT_SIZE_MAX } = await import('~/src/storage/schema');
    expect(INPUT_DOT_SIZE_MIN).toBe(12);
    expect(INPUT_DOT_SIZE_MAX).toBe(24);
    expect(clampInputDotSize(0)).toBe(12);
    expect(clampInputDotSize(99)).toBe(24);
    expect(clampInputDotSize(17.6)).toBe(18);
    for (const bad of [Number.NaN, '20', null, undefined, Number.POSITIVE_INFINITY]) {
      expect(clampInputDotSize(bad)).toBe(14);
    }
  });

  test('写入口钳制：patchSettings 与 replaceSettings', async () => {
    resetStorage();
    vi.resetModules();
    const { settingsReady, getSettings, patchSettings, replaceSettings } = await import('~/src/storage/settings');
    await settingsReady();
    await patchSettings({ inputDotSize: 2 });
    expect(getSettings().inputDotSize).toBe(12);
    await replaceSettings({ ...DEFAULT_SETTINGS, inputDotSize: 100 });
    expect(getSettings().inputDotSize).toBe(24);
  });
});
