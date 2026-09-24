/**
 * storage/specialization.ts — 领域与规则存储模块：生效站点规则（#366、#367、#369、#370、#374）
 *
 * 来源为内置规则与用户规则（#370）；按当前站点读取，网址匹配沿用
 * 站点黑白名单的裸域名语义（子域归入、主域名归一、IP 精确匹配）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { getSiteRules } from '~/src/storage/specialization';
import { resetStorage, fireStorageChange } from '~/docs/testing/setup';

describe('getSiteRules（生效站点规则）', () => {
  test('youtube.com 返回迁自 compat 的内置排除', () => {
    expect(getSiteRules('www.youtube.com').exclude).toEqual([
      '.ytd-thumbnail-overlay-time-status-renderer',
      '#metadata-line span',
      '.ytd-video-meta-block ytd-badge-supported-renderer',
      '.ytd-channel-name yt-formatted-string',
    ]);
  });

  test('github.com 返回迁自 compat 的内置排除（#367）', () => {
    expect(getSiteRules('github.com').exclude).toEqual([
      '.blob-code',
      '.blob-code-inner',
      '.file-info',
      '.file-header',
      '.commit-tease-sha',
      '.commit-message code',
      '.highlight',
      '.blame-hunk',
      '.text-mono',
      '.file-tree',
      '.js-file-tree',
      '.tree-browser',
      '.BorderGrid',
      '.repository-lang-stats',
    ]);
  });

  test('github.com 返回迁自 compat 的内置保留原文（#369）', () => {
    expect(getSiteRules('github.com').preserve).toEqual([
      'a.user-mention',
      '[data-hovercard-url^="/users/"]',
      '[rel="author"]',
      '[itemprop="author"]',
    ]);
  });

  test('子域归入：m.youtube.com 与 youtube.com 同一份规则', () => {
    expect(getSiteRules('m.youtube.com')).toEqual(getSiteRules('youtube.com'));
  });

  test('没有内置规则的站点返回空规则', () => {
    expect(getSiteRules('example.com')).toEqual({ scope: [], exclude: [], preserve: [] });
  });

  test('仅后缀相同的域名不误命中', () => {
    expect(getSiteRules('notyoutube.com')).toEqual({ scope: [], exclude: [], preserve: [] });
  });
});

/**
 * 用户规则（#370）：设置页的站点卡片，存在 storage.local。生效站点
 * 规则 = 内置规则与用户规则逐字段追加。content script 先 await
 * siteRulesReady() 载入用户规则，之后 getSiteRules() 照旧同步读取。
 *
 * 每个用例重新加载模块，模拟一个新打开的页面（或设置页）。
 */
describe('用户规则（#370）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  /** 新载入一份模块 —— 相当于新打开一个页面 */
  async function load(): Promise<Spec> {
    vi.resetModules();
    return import('~/src/storage/specialization');
  }

  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    options = await load();
  });

  /** 在设置页保存规则后，新打开的页面读到的生效站点规则 */
  async function rulesOnNewPage(host: string) {
    const page = await load();
    await page.siteRulesReady();
    return page.getSiteRules(host);
  }

  test('用户排除逐字段追加在内置规则之后，不替换内置规则', async () => {
    const builtin = getSiteRules('github.com');
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'] });
    const rules = await rulesOnNewPage('github.com');
    expect(rules.exclude).toEqual([...builtin.exclude, '.my-sidebar']);
    expect(rules.preserve).toEqual(builtin.preserve);
  });

  test('没有内置规则的站点只含用户规则', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad', '#footer'] });
    expect(await rulesOnNewPage('example.com')).toEqual({
      scope: [],
      exclude: ['.ad', '#footer'],
      preserve: [],
    });
  });

  test('站点匹配沿用裸域名语义：子域归入、主域名归一', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    await options.saveUserSiteRules('www.example.org', { exclude: ['.promo'] });
    expect((await rulesOnNewPage('docs.example.com')).exclude).toEqual(['.ad']);
    expect((await rulesOnNewPage('example.org')).exclude).toEqual(['.promo']);
    expect((await rulesOnNewPage('notexample.com')).exclude).toEqual([]);
  });

  test('IP 只做精确匹配', async () => {
    await options.saveUserSiteRules('192.168.1.1', { exclude: ['.ad'] });
    expect((await rulesOnNewPage('192.168.1.1')).exclude).toEqual(['.ad']);
    expect((await rulesOnNewPage('192.168.1.10')).exclude).toEqual([]);
  });

  test('用户规则存放在 storage.local，不写入 storage.sync', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    expect(await chrome.storage.sync.get(null)).toEqual({});
    expect(JSON.stringify(await chrome.storage.local.get(null))).toContain('.ad');
  });

  test('站点卡片按新增顺序列出；同一站点再次保存是更新，不新增卡片', async () => {
    await options.saveUserSiteRules('example.com', {});
    await options.saveUserSiteRules('example.org', { exclude: ['.promo'] });
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'example.com', exclude: ['.ad'] },
      { site: 'example.org', exclude: ['.promo'] },
    ]);
  });

  test('每行一个选择器：去掉首尾空白，空行不保存', async () => {
    await options.saveUserSiteRules(' Example.COM ', {
      exclude: ['  .ad ', '', '   ', '#footer'],
    });
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'example.com', exclude: ['.ad', '#footer'] },
    ]);
  });

  test('不是裸域名时抛错，不写入', async () => {
    for (const bad of ['', '   ', 'https://example.com', 'example.com/path', 'exa mple.com']) {
      await expect(options.saveUserSiteRules(bad, { exclude: ['.ad'] })).rejects.toThrow();
    }
    expect(await options.getUserSiteRules()).toEqual([]);
  });

  test('未载入用户规则前只有内置规则', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    const page = await load();
    expect(page.getSiteRules('example.com').exclude).toEqual([]);
  });

  test('已打开的页面在别处保存后同步更新，不必刷新', async () => {
    const page = await load();
    await page.siteRulesReady();
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    const stored = await chrome.storage.local.get(null);
    fireStorageChange(
      Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, { newValue: v }])),
      'local',
    );
    expect(page.getSiteRules('example.com').exclude).toEqual(['.ad']);
  });

  test('存储里的脏数据跳过，不影响其他站点卡片', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    const stored = await chrome.storage.local.get(null);
    const [key] = Object.keys(stored);
    const value = stored[key!] as { user: unknown[] };
    await chrome.storage.local.set({
      [key!]: { user: [null, { site: 42 }, { site: 'bad.com', exclude: 'x' }, ...value.user] },
    });
    expect((await rulesOnNewPage('example.com')).exclude).toEqual(['.ad']);
    expect((await rulesOnNewPage('bad.com')).exclude).toEqual([]);
  });

  test('读取存储失败时只剩内置规则，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'] });
    const page = await load();
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    await page.siteRulesReady();
    expect(page.getSiteRules('github.com')).toEqual(getSiteRules('github.com'));
    warn.mockRestore();
  });

  test('用户规则变更时通知订阅者，其他键与 sync 的变更不通知', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    const stored = await chrome.storage.local.get(null);
    const change = Object.fromEntries(
      Object.entries(stored).map(([k, v]) => [k, { newValue: v }]),
    );
    const fn = vi.fn();
    const off = options.onUserSiteRulesChanged(fn);
    fireStorageChange({ 'pt-cache-index': { newValue: [] } }, 'local');
    fireStorageChange(change, 'sync');
    expect(fn).not.toHaveBeenCalled();
    fireStorageChange(change, 'local');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    fireStorageChange(change, 'local');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('用户规则里的无效选择器只跳过它自己', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await options.saveUserSiteRules('example.com', { exclude: ['.ad,', '.promo'] });
    expect((await rulesOnNewPage('example.com')).exclude).toEqual(['.promo']);
    warn.mockRestore();
  });

  test('限定范围与排除一样保存、追加生效（#374）', async () => {
    await options.saveUserSiteRules('example.com', { scope: ['  main ', '', '.post'] });
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'example.com', scope: ['main', '.post'], exclude: ['.ad'] },
    ]);
    expect(await rulesOnNewPage('docs.example.com')).toEqual({
      scope: ['main', '.post'],
      exclude: ['.ad'],
      preserve: [],
    });
  });

  test('没有设置限定范围的站点，限定范围为空（不限定）（#374）', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    expect((await rulesOnNewPage('example.com')).scope).toEqual([]);
    expect((await rulesOnNewPage('github.com')).scope).toEqual([]);
  });

  test('存储里限定范围不是字符串列表的卡片跳过（#374）', async () => {
    await options.saveUserSiteRules('example.com', { scope: ['main'] });
    const stored = await chrome.storage.local.get(null);
    const [key] = Object.keys(stored);
    const value = stored[key!] as { user: unknown[] };
    await chrome.storage.local.set({
      [key!]: { user: [{ site: 'bad.com', scope: 'main' }, ...value.user] },
    });
    expect((await rulesOnNewPage('example.com')).scope).toEqual(['main']);
    expect((await rulesOnNewPage('bad.com')).scope).toEqual([]);
  });
});
