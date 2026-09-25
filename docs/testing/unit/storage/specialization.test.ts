/**
 * storage/specialization.ts — 领域与规则存储模块：生效站点规则（#366、#367、#369、#370、#372、#373、#374）
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

  test('存储里的无效选择器只跳过它自己', async () => {
    // 设置页保存时会拒绝无效选择器（#372）；存储里仍可能有（例如导入的规则）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await options.saveUserSiteRules('example.com', {});
    const stored = await chrome.storage.local.get(null);
    const [key] = Object.keys(stored);
    await chrome.storage.local.set({
      [key!]: { user: [{ site: 'example.com', exclude: ['.ad,', '.promo'] }] },
    });
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

  test('用户保留原文逐字段追加在内置保留原文之后（#373）', async () => {
    const builtin = getSiteRules('github.com');
    await options.saveUserSiteRules('github.com', { preserve: [' .my-handle ', ''] });
    const rules = await rulesOnNewPage('github.com');
    expect(rules.preserve).toEqual([...builtin.preserve, '.my-handle']);
    expect(rules.exclude).toEqual(builtin.exclude);
  });

  test('只改排除时，已保存的保留原文不丢（#373）', async () => {
    await options.saveUserSiteRules('example.com', { preserve: ['.handle'] });
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    expect(await rulesOnNewPage('example.com')).toEqual({
      scope: [],
      exclude: ['.ad'],
      preserve: ['.handle'],
    });
  });
});

/**
 * 保存时校验选择器（#372，ADR-0003 坏规则两头拦的保存一头）：逐行校验，
 * 存在无效行时整张卡片拒绝保存，并指出是哪个字段的第几行。
 */
describe('保存时校验选择器（#372）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  let spec: Spec;
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
    spec = await import('~/src/storage/specialization');
  });

  /** 保存被拒时的错误 */
  async function rejection(p: Promise<void>) {
    const e = await p.then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(spec.InvalidSelectorsError);
    return e as InstanceType<Spec['InvalidSelectorsError']>;
  }

  test('存在无效行时拒绝保存，已保存的规则不变', async () => {
    await spec.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    await rejection(spec.saveUserSiteRules('example.com', { exclude: ['.ad', '.promo,'] }));
    expect(await spec.getUserSiteRules()).toEqual([{ site: 'example.com', exclude: ['.ad'] }]);
  });

  test('新站点带无效行时不新增卡片', async () => {
    await rejection(spec.saveUserSiteRules('example.com', { exclude: ['div['] }));
    expect(await spec.getUserSiteRules()).toEqual([]);
  });

  test('逐行校验：指出每一条无效行的字段、行号与选择器', async () => {
    const e = await rejection(
      spec.saveUserSiteRules('example.com', {
        exclude: ['.ad', '.promo,', '#ok', 'div['],
        preserve: ['a.user-mention', '>>'],
      }),
    );
    expect(e.invalid).toEqual([
      { field: 'exclude', line: 2, selector: '.promo,' },
      { field: 'exclude', line: 4, selector: 'div[' },
      { field: 'preserve', line: 2, selector: '>>' },
    ]);
  });

  test('限定范围同样逐行校验', async () => {
    const e = await rejection(spec.saveUserSiteRules('example.com', { scope: ['main', 'main,'] }));
    expect(e.invalid).toEqual([{ field: 'scope', line: 2, selector: 'main,' }]);
  });

  test('空行与首尾空白被忽略，不算无效；行号按文本框里的原始行计', async () => {
    const e = await rejection(
      spec.saveUserSiteRules('example.com', { exclude: ['', '  .ad  ', '   ', ' .x, '] }),
    );
    expect(e.invalid).toEqual([{ field: 'exclude', line: 4, selector: '.x,' }]);
  });

  test('全部有效时照常保存', async () => {
    await spec.saveUserSiteRules('example.com', {
      exclude: ['', '  .ad  ', 'div > p:not(.x)', '[data-a="1"]'],
    });
    expect(await spec.getUserSiteRules()).toEqual([
      { site: 'example.com', exclude: ['.ad', 'div > p:not(.x)', '[data-a="1"]'] },
    ]);
  });
});

/**
 * 限定范围全部无效时的提示（#443）：容错语义不变（ADR-0003，无效选择器
 * 只跳过它自己，全部无效即退回不限定，不能重演 #93），但退回要让用户
 * 看得见 —— 控制台记一条专门的警告；设置页用校验接口检查已保存的规则。
 */
describe('限定范围全部无效时的提示（#443）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  const ALL_INVALID = '限定范围全部无效';

  beforeEach(() => {
    resetStorage();
  });

  /** 存储里直接写入站点卡片（例如导入的规则），再新打开一个页面 */
  async function pageWithStored(user: unknown[]): Promise<Spec> {
    await chrome.storage.local.set({ 'pt-site-rules': { user } });
    vi.resetModules();
    const page = await import('~/src/storage/specialization');
    await page.siteRulesReady();
    return page;
  }

  const warnings = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes(ALL_INVALID));

  test('全部无效时限定范围为空（不限定），并记一条专门的警告，只记一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await pageWithStored([{ site: 'example.com', scope: ['main,', 'div['] }]);
    expect(page.getSiteRules('example.com').scope).toEqual([]);
    expect(page.getSiteRules('docs.example.com').scope).toEqual([]);
    const hints = warnings(warn);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('example.com');
    expect(hints[0]).toContain('已按不限定处理');
    warn.mockRestore();
  });

  test('部分无效时只剔除无效项，不记这条警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await pageWithStored([{ site: 'example.com', scope: ['main,', '.post'] }]);
    expect(page.getSiteRules('example.com').scope).toEqual(['.post']);
    expect(warnings(warn)).toEqual([]);
    warn.mockRestore();
  });

  test('没有声明限定范围时不记这条警告；只有空白行也算没有声明', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await pageWithStored([
      { site: 'example.com', exclude: ['.ad,'] },
      { site: 'blank.com', scope: ['', '   '] },
    ]);
    expect(page.getSiteRules('example.com').scope).toEqual([]);
    expect(page.getSiteRules('blank.com').scope).toEqual([]);
    expect(warnings(warn)).toEqual([]);
    // 设置页同样不把空白行当作无效行
    expect(page.findInvalidSelectors({ scope: ['', '   '] })).toEqual([]);
    warn.mockRestore();
  });

  test('校验接口对已保存的规则返回字段、行号与选择器，与保存时拒绝的结果一致', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const card = { site: 'example.com', scope: ['main,'], exclude: ['.ad', 'div['], preserve: ['>>'] };
    const page = await pageWithStored([card]);
    const [saved] = await page.getUserSiteRules();
    const expected = [
      { field: 'scope', line: 1, selector: 'main,' },
      { field: 'exclude', line: 2, selector: 'div[' },
      { field: 'preserve', line: 1, selector: '>>' },
    ];
    expect(page.findInvalidSelectors(saved!)).toEqual(expected);

    const e = await page.saveUserSiteRules('example.com', card).then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(page.InvalidSelectorsError);
    expect((e as InstanceType<Spec['InvalidSelectorsError']>).invalid).toEqual(expected);
    expect(page.findInvalidSelectors({ scope: ['main'], exclude: ['', ' .ad '] })).toEqual([]);
    warn.mockRestore();
  });
});

/**
 * 删除站点卡片（#371）：设置页删除用户新增的站点卡片后，storage.local
 * 里不再有该站点的用户规则，该站点的生效规则回到仅内置规则。
 */
describe('删除站点卡片（#371）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  async function load(): Promise<Spec> {
    vi.resetModules();
    return import('~/src/storage/specialization');
  }

  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    options = await load();
  });

  test('删除后 storage.local 不再有该站点的用户规则，其他卡片不变', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    await options.saveUserSiteRules('example.org', { exclude: ['.promo'] });
    await options.deleteUserSiteRules('example.com');
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'example.org', exclude: ['.promo'] },
    ]);
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain('.ad');
  });

  test('删除后该站点的生效规则回到仅内置规则', async () => {
    const builtin = getSiteRules('github.com');
    await options.saveUserSiteRules('github.com', {
      scope: ['main'],
      exclude: ['.my-sidebar'],
      preserve: ['.handle'],
    });
    await options.deleteUserSiteRules('github.com');

    const page = await load();
    await page.siteRulesReady();
    expect(page.getSiteRules('github.com')).toEqual(builtin);
    // 删除所在的上下文同样立即生效
    expect(options.getSiteRules('github.com')).toEqual(builtin);
  });

  test('已打开的页面在别处删除后同步更新，不必刷新', async () => {
    await options.saveUserSiteRules('example.com', { exclude: ['.ad'] });
    const page = await load();
    await page.siteRulesReady();
    expect(page.getSiteRules('example.com').exclude).toEqual(['.ad']);

    const before = await chrome.storage.local.get('pt-site-rules');
    await options.deleteUserSiteRules('example.com');
    const after = await chrome.storage.local.get('pt-site-rules');
    fireStorageChange(
      { 'pt-site-rules': { oldValue: before['pt-site-rules'], newValue: after['pt-site-rules'] } },
      'local',
    );
    expect(page.getSiteRules('example.com').exclude).toEqual([]);
  });

  test('删除不存在的站点卡片不报错，已有卡片不变', async () => {
    await options.saveUserSiteRules('example.org', { exclude: ['.promo'] });
    await options.deleteUserSiteRules('example.com');
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'example.org', exclude: ['.promo'] },
    ]);
  });
});

/**
 * 停用某个站点的内置规则（#375）：站点卡片上的开关，打开后该站点只剩
 * 用户规则生效，便于内置规则出错时完全接管；关闭后恢复追加合并。开关
 * 状态随站点卡片存放在 storage.local。
 */
describe('停用某个站点的内置规则（#375）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  async function load(): Promise<Spec> {
    vi.resetModules();
    return import('~/src/storage/specialization');
  }

  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    options = await load();
  });

  async function rulesOnNewPage(host: string) {
    const page = await load();
    await page.siteRulesReady();
    return page.getSiteRules(host);
  }

  test('有内置规则的站点才显示开关：按裸域名语义判断', () => {
    expect(options.hasBuiltinSiteRules('github.com')).toBe(true);
    expect(options.hasBuiltinSiteRules('www.youtube.com')).toBe(true);
    expect(options.hasBuiltinSiteRules('example.com')).toBe(false);
    expect(options.hasBuiltinSiteRules('notgithub.com')).toBe(false);
  });

  test('开关打开后，生效规则只含用户规则；子域同样生效', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'] });
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    const only = { scope: [], exclude: ['.my-sidebar'], preserve: [] };
    expect(await rulesOnNewPage('github.com')).toEqual(only);
    expect(await rulesOnNewPage('gist.github.com')).toEqual(only);
    // 设置所在的上下文同样立即生效
    expect(options.getSiteRules('github.com')).toEqual(only);
  });

  test('开关状态存放在 storage.local；关闭后恢复追加合并', async () => {
    const builtin = getSiteRules('github.com');
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'] });
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    expect(await chrome.storage.sync.get(null)).toEqual({});
    expect(await options.getUserSiteRules()).toEqual([
      { site: 'github.com', exclude: ['.my-sidebar'], disableBuiltin: true },
    ]);

    await options.setBuiltinSiteRulesDisabled('github.com', false);
    expect((await rulesOnNewPage('github.com')).exclude).toEqual([
      ...builtin.exclude,
      '.my-sidebar',
    ]);
    expect((await rulesOnNewPage('github.com')).preserve).toEqual(builtin.preserve);
  });

  test('只停用该站点的内置规则，其他站点不受影响', async () => {
    await options.saveUserSiteRules('github.com', {});
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    expect(await rulesOnNewPage('youtube.com')).toEqual(getSiteRules('youtube.com'));
  });

  test('保存选择器不改变开关状态', async () => {
    await options.saveUserSiteRules('github.com', {});
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    await options.saveUserSiteRules('github.com', { exclude: ['.ad'] });
    expect((await rulesOnNewPage('github.com')).exclude).toEqual(['.ad']);
  });

  test('存储里开关不是布尔值的卡片跳过', async () => {
    await chrome.storage.local.set({
      'pt-site-rules': {
        user: [
          { site: 'github.com', disableBuiltin: 'yes' },
          { site: 'example.com', exclude: ['.ad'] },
        ],
      },
    });
    const page = await load();
    await page.siteRulesReady();
    expect(page.getSiteRules('github.com')).toEqual(getSiteRules('github.com'));
    expect(page.getSiteRules('example.com').exclude).toEqual(['.ad']);
  });
});

/**
 * 停用开关的生效范围（#467）：只作用于卡片站点本身及其子域，`www.` 前缀
 * 视同主域名。子域卡片打开停用，不波及主域名与兄弟子域。用户规则的
 * 选择器仍按裸域名语义追加（含主域名归一），不在本组范围内。
 */
describe('停用开关只作用于卡片站点及其子域（#467）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  async function load(): Promise<Spec> {
    vi.resetModules();
    return import('~/src/storage/specialization');
  }

  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    options = await load();
  });

  async function rulesOnNewPage(host: string) {
    const page = await load();
    await page.siteRulesReady();
    return page.getSiteRules(host);
  }

  const builtinExclude = () => getSiteRules('github.com').exclude;

  test('子域卡片停用后，该子域及其子域只剩用户规则', async () => {
    await options.saveUserSiteRules('gist.github.com', { exclude: ['.gist-only'] });
    await options.setBuiltinSiteRulesDisabled('gist.github.com', true);
    const only = { scope: [], exclude: ['.gist-only'], preserve: [] };
    expect(await rulesOnNewPage('gist.github.com')).toEqual(only);
    expect(await rulesOnNewPage('www.gist.github.com')).toEqual(only);
    expect(await rulesOnNewPage('raw.gist.github.com')).toEqual(only);
  });

  test('子域卡片停用后，主域名与兄弟子域的内置规则照常生效', async () => {
    await options.saveUserSiteRules('gist.github.com', { exclude: ['.gist-only'] });
    await options.setBuiltinSiteRulesDisabled('gist.github.com', true);
    for (const host of ['github.com', 'www.github.com', 'api.github.com']) {
      const rules = await rulesOnNewPage(host);
      expect(rules.exclude.slice(0, builtinExclude().length)).toEqual(builtinExclude());
      expect(rules.preserve).toEqual(getSiteRules('github.com').preserve);
    }
  });

  test('www. 卡片与主域名卡片效果相同：主域名与各子域都只剩用户规则', async () => {
    await options.saveUserSiteRules('www.github.com', { exclude: ['.mine'] });
    await options.setBuiltinSiteRulesDisabled('www.github.com', true);
    const only = { scope: [], exclude: ['.mine'], preserve: [] };
    expect(await rulesOnNewPage('github.com')).toEqual(only);
    expect(await rulesOnNewPage('www.github.com')).toEqual(only);
    expect(await rulesOnNewPage('gist.github.com')).toEqual(only);
  });

  test('主域名卡片与子域卡片并存时，停用只在打开开关的卡片范围内生效', async () => {
    await options.saveUserSiteRules('github.com', {});
    await options.saveUserSiteRules('gist.github.com', {});
    await options.setBuiltinSiteRulesDisabled('gist.github.com', true);
    expect((await rulesOnNewPage('github.com')).exclude).toEqual(builtinExclude());
    expect((await rulesOnNewPage('gist.github.com')).exclude).toEqual([]);
  });

  test('显示开关的站点，打开停用后该站点的内置规则确实被停用', async () => {
    for (const site of ['github.com', 'www.github.com', 'gist.github.com']) {
      resetStorage();
      options = await load();
      expect(options.hasBuiltinSiteRules(site)).toBe(true);
      await options.setBuiltinSiteRulesDisabled(site, true);
      expect((await rulesOnNewPage(site)).exclude).toEqual([]);
    }
    expect(options.hasBuiltinSiteRules('example.com')).toBe(false);
    expect(options.hasBuiltinSiteRules('gist.example.com')).toBe(false);
  });
});

/**
 * 站点规则 JSON 导出（#376）：把全部用户规则导出为一个 JSON 文件，用于
 * 备份和迁移。按裸域名列出站点卡片，含三类选择器列表与停用内置规则
 * 标记，带格式版本号。只含用户规则，不含内置规则。
 */
describe('站点规则 JSON 导出（#376）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
    options = await import('~/src/storage/specialization');
  });

  const exported = async () => JSON.parse(await options.exportUserSiteRules());

  test('没有用户规则时导出空列表，带格式标识与版本号', async () => {
    expect(await exported()).toEqual({
      format: 'parallel-translation-site-rules',
      version: 1,
      sites: {},
    });
  });

  test('按裸域名导出每张站点卡片的三类选择器与停用内置规则标记', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'], preserve: ['.user'] });
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    await options.saveUserSiteRules('example.com', { scope: ['main', 'article'] });
    expect((await exported()).sites).toEqual({
      'github.com': {
        scope: [],
        exclude: ['.my-sidebar'],
        preserve: ['.user'],
        disableBuiltin: true,
      },
      'example.com': {
        scope: ['main', 'article'],
        exclude: [],
        preserve: [],
        disableBuiltin: false,
      },
    });
  });

  test('站点按新增顺序排列', async () => {
    for (const site of ['c.com', 'a.com', 'b.com']) await options.saveUserSiteRules(site, {});
    expect(Object.keys((await exported()).sites)).toEqual(['c.com', 'a.com', 'b.com']);
  });

  test('只含用户规则，不含内置规则', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'] });
    const { sites } = await exported();
    expect(Object.keys(sites)).toEqual(['github.com']);
    expect(sites['github.com'].exclude).toEqual(['.my-sidebar']);
    expect(JSON.stringify(sites)).not.toContain('.blob-code');
  });

  test('存储里的脏卡片不导出', async () => {
    await chrome.storage.local.set({
      'pt-site-rules': {
        user: [{ site: 'bad.com', exclude: 'oops' }, { site: 'ok.com', exclude: ['.ad'] }],
      },
    });
    expect(Object.keys((await exported()).sites)).toEqual(['ok.com']);
  });
});

/**
 * 站点规则 JSON 导入（#377）：导入 #376 导出的文件，与现有用户规则合并 ——
 * 新站点新增在末尾；同一站点逐字段追加并去重，停用内置规则的标记只会
 * 打开、不会被导入关闭。本组只处理格式正确的文件（容错见 #378）。
 */
describe('站点规则 JSON 导入（#377）', () => {
  type Spec = typeof import('~/src/storage/specialization');
  async function load(): Promise<Spec> {
    vi.resetModules();
    return import('~/src/storage/specialization');
  }

  let options: Spec;
  beforeEach(async () => {
    resetStorage();
    options = await load();
  });

  const file = (sites: Record<string, unknown>) =>
    JSON.stringify({ format: 'parallel-translation-site-rules', version: 1, sites });

  test('导出再导入到空白设备后，用户规则与导出前一致', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.my-sidebar'], preserve: ['.user'] });
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    await options.saveUserSiteRules('example.com', { scope: ['main'] });
    const json = await options.exportUserSiteRules();
    const before = {
      github: options.getSiteRules('github.com'),
      example: options.getSiteRules('example.com'),
    };

    resetStorage();
    options = await load();
    await options.importUserSiteRules(json);
    expect(await options.exportUserSiteRules()).toBe(json);
    const page = await load();
    await page.siteRulesReady();
    expect(page.getSiteRules('github.com')).toEqual(before.github);
    expect(page.getSiteRules('example.com')).toEqual(before.example);
  });

  test('导出再导入到同一设备，用户规则不变（去重）', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.a', '.b'] });
    const json = await options.exportUserSiteRules();
    await options.importUserSiteRules(json);
    expect(await options.exportUserSiteRules()).toBe(json);
  });

  test('同一站点已有规则时逐字段追加并去重，新站点新增在末尾', async () => {
    await options.saveUserSiteRules('github.com', { exclude: ['.a'], preserve: ['.p'] });
    await options.importUserSiteRules(
      file({
        'github.com': { scope: ['main'], exclude: ['.a', '.b'], preserve: [], disableBuiltin: false },
        'example.com': { scope: [], exclude: ['.ad'], preserve: [], disableBuiltin: false },
      }),
    );
    expect(JSON.parse(await options.exportUserSiteRules()).sites).toEqual({
      'github.com': { scope: ['main'], exclude: ['.a', '.b'], preserve: ['.p'], disableBuiltin: false },
      'example.com': { scope: [], exclude: ['.ad'], preserve: [], disableBuiltin: false },
    });
  });

  test('停用内置规则的标记：导入打开的会打开，导入关闭的不改变现有设置', async () => {
    await options.setBuiltinSiteRulesDisabled('github.com', true);
    await options.importUserSiteRules(
      file({
        'github.com': { scope: [], exclude: [], preserve: [], disableBuiltin: false },
        'youtube.com': { scope: [], exclude: [], preserve: [], disableBuiltin: true },
      }),
    );
    const { sites } = JSON.parse(await options.exportUserSiteRules());
    expect(sites['github.com'].disableBuiltin).toBe(true);
    expect(sites['youtube.com'].disableBuiltin).toBe(true);
  });

  test('导入后规则生效：设置所在的上下文立即生效，页面刷新后同样生效', async () => {
    await options.importUserSiteRules(
      file({ 'example.com': { scope: [], exclude: ['.ad'], preserve: [], disableBuiltin: false } }),
    );
    expect(options.getSiteRules('example.com').exclude).toEqual(['.ad']);
    const page = await load();
    await page.siteRulesReady();
    expect(page.getSiteRules('example.com').exclude).toEqual(['.ad']);
  });

  test('返回导入的站点数', async () => {
    const result = await options.importUserSiteRules(
      file({
        'a.com': { scope: [], exclude: ['.x'], preserve: [], disableBuiltin: false },
        'b.com': { scope: [], exclude: [], preserve: [], disableBuiltin: false },
      }),
    );
    expect(result.imported).toBe(2);
  });
});
