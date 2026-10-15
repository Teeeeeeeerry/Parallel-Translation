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
