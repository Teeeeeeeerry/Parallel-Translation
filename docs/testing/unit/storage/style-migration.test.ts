/**
 * storage — 译文样式 id 迁移 单元测试
 *
 * 默认样式改为纯半透明后，原本的 'fade'（纯半透明）与新的 'default'
 * 效果重合，故删除 'fade'；原 default 的黄铜色左边线改名 'border'
 * 挪到列表底部。
 *
 * 已经选过 'fade' 的老用户，存储里躺着一个不再存在的 id。不迁移的话
 * applyStyle 会挂上没有任何 CSS 规则的 .pt-style-fade —— 译文变成完全
 * 不透明，用户会觉得「我明明选了半透明」。迁到 'default' 后观感不变。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

describe('译文样式 id 迁移', () => {
  beforeEach(() => {
    resetStorage();
    vi.resetModules();
  });

  test("旧的 'fade' 迁到 'default' —— 老用户观感不变", async () => {
    await chrome.storage.sync.set({ 'pt-settings': { style: 'fade' } });
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).style).toBe('default');
  });

  test("'border' 是有效 id，原样保留", async () => {
    await chrome.storage.sync.set({ 'pt-settings': { style: 'border' } });
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).style).toBe('border');
  });

  test("'default' 与其余预设不受影响", async () => {
    await chrome.storage.sync.set({ 'pt-settings': { style: 'italic' } });
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).style).toBe('italic');
  });

  test('无法识别的样式回落默认，而不是挂一个没有规则的类名', async () => {
    await chrome.storage.sync.set({ 'pt-settings': { style: 'nonsense' } });
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).style).toBe('default');
  });

  test('空存储 → 默认样式', async () => {
    const { settingsReady } = await import('~/src/storage/settings');
    expect((await settingsReady()).style).toBe('default');
  });
});
