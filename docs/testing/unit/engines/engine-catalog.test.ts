/**
 * 引擎清单（#608）—— 设置页引擎列表、popup 引擎下拉框、恢复默认清 key
 * 都从同一份清单派生：清单里删掉一个引擎，这三处同时不再出现它。
 *
 * 用 mock 把 DeepL 从清单里删掉，再分别驱动三处。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resetStorage } from '~/docs/testing/setup';

vi.mock('~/src/storage/schema', async (importOriginal) => {
  const m = await importOriginal<typeof import('~/src/storage/schema')>();
  return { ...m, ENGINE_CATALOG: m.ENGINE_CATALOG.filter((e) => e.id !== 'deepl') };
});

const settings = vi.hoisted(() => ({
  enabled: true,
  enginePriority: ['google-web'],
  from: 'auto',
  to: 'zh-CN',
  displayMode: 'bilingual',
  style: 'default',
  models: {},
}));

vi.mock('~/src/storage/settings', () => ({
  settingsReady: vi.fn(async () => settings),
  getSettings: vi.fn(() => settings),
  patchSettings: vi.fn(async () => {}),
  onSettingsChanged: vi.fn(() => () => {}),
}));

// 设置页入口会初始化全部分区；这里只要它的提示函数
vi.mock('~/entrypoints/options/main', () => ({ showToast: vi.fn() }));

beforeEach(() => {
  resetStorage();
  document.body.innerHTML = '';
});

const engineIds = (root: ParentNode, sel: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)].map((el) => el.dataset.engine);

describe('引擎清单删掉 DeepL（#608）', () => {
  test('设置页“引擎”分区：未启用列表与 BYOK 卡片都不再有 DeepL', async () => {
    document.body.innerHTML =
      '<ul id="pt-engine-list"></ul><ul id="pt-engine-disabled"></ul><div id="pt-byok-keys"></div>';
    const { initEngines } = await import('~/entrypoints/options/sections/engines');
    initEngines();

    expect(engineIds(document, '#pt-engine-list .pt-engine-item')).toEqual(['google-web']);
    expect(engineIds(document, '#pt-engine-disabled .pt-engine-item')).toEqual([
      'bing-edge',
      'openai',
      'gemini',
      'deepseek',
    ]);
    expect(document.getElementById('pt-key-openai')).not.toBeNull();
    expect(document.getElementById('pt-key-gemini')).not.toBeNull();
    expect(document.getElementById('pt-key-deepl')).toBeNull();
    // 模型名占位取引擎自己的默认模型
    expect(document.getElementById('pt-model-openai')?.getAttribute('placeholder')).toBe('gpt-4o-mini');
    expect(document.getElementById('pt-model-gemini')?.getAttribute('placeholder')).toBe('gemini-2.0-flash');
  });

  test('popup 引擎下拉框不再有 DeepL', async () => {
    const html = readFileSync('entrypoints/popup/index.html', 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/^<body[^>]*>/, '');
    const c = chrome as unknown as Record<string, any>;
    c.runtime.getManifest = vi.fn(() => ({ version: '0.0.0' }));
    c.runtime.openOptionsPage = vi.fn();
    c.tabs = { query: vi.fn(async () => []), sendMessage: vi.fn(), create: vi.fn() };

    await import('~/entrypoints/popup/main');
    // popup 入口在 DOMContentLoaded 时初始化
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#pt-engine-select option').length).toBeGreaterThan(0);
    });

    const values = [...document.querySelectorAll<HTMLOptionElement>('#pt-engine-select option')].map(
      (o) => o.value,
    );
    expect(values).toEqual(['google-web', 'bing-edge', 'openai', 'gemini', 'deepseek']);
  });

  test('恢复默认清 key 的范围不再有 DeepL', async () => {
    const { setKey, getKey, removeByokKeys } = await import('~/src/storage/keys');
    await setKey('openai', 'sk-1');
    await setKey('deepl', 'dk-1');
    await setKey('gemini', 'gk-1');

    await removeByokKeys();

    expect(await getKey('openai')).toBeUndefined();
    expect(await getKey('gemini')).toBeUndefined();
    expect(await getKey('deepl')).toBe('dk-1');
  });
});
