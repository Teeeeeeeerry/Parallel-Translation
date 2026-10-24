/**
 * 页面上下文（#1119，父 #1112）：准入与当前领域只算一处
 *
 * 给定设置、本 frame 与顶层主机名、领域列表与临时选择，三个问答各给出什么：
 * - 准入（总开关、站点名单，按本 frame 的主机名）；
 * - 当前领域 ID（按顶层页面的主机名判定 #471，临时选择优先 #400，按给定的目标
 *   语言解析 —— 输入翻译传的是对方语言，ADR-0005）；
 * - popup 用的领域状态（#399）。
 */
import { describe, test, expect } from 'vitest';
import { createPageContext } from '~/src/orchestration/page-context';
import { DEFAULT_SETTINGS, type Settings } from '~/src/storage/schema';
import type { Domain, DomainChoice } from '~/src/storage/domains';

const domain = (id: string, targetLang: string, sites: string[]): Domain =>
  ({ id, name: `领域 ${id}`, targetLang, sites, terms: [] }) as unknown as Domain;

const DEV_ZH = domain('dev-zh', 'zh-CN', ['github.com']);
const DEV_EN = domain('dev-en', 'en', ['github.com']);
const LAW_ZH = domain('law-zh', 'zh-CN', ['law.example.org']);
const DOMAINS = [DEV_ZH, DEV_EN, LAW_ZH];

function ctx(opts: {
  settings?: Partial<Settings>;
  host?: string;
  top?: string;
  choice?: DomainChoice;
  mainFrame?: boolean;
} = {}) {
  return createPageContext({
    getSettings: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }),
    getHostname: () => opts.host ?? 'github.com',
    ...(opts.top !== undefined && { getTopHostname: () => opts.top! }),
    getDomains: () => DOMAINS,
    getDomainChoice: () => opts.choice ?? { kind: 'auto' },
    isMainFrame: () => opts.mainFrame ?? true,
  });
}

describe('准入', () => {
  test('总开关打开、站点不在名单里：放行', () => {
    expect(ctx().admission()).toBe('allowed');
  });

  test('站点在黑名单里：拦下（按本 frame 的主机名）', () => {
    const blocked = { siteList: { mode: 'blacklist' as const, list: ['example.com'] } };
    expect(ctx({ settings: blocked, host: 'www.example.com' }).admission()).toBe('blocked');
    // 顶层页面在名单里、本 frame 不在：照常放行
    expect(ctx({ settings: blocked, host: 'cdn.other.net', top: 'example.com' }).admission()).toBe('allowed');
  });

  test('白名单没命中：拦下', () => {
    const white = { siteList: { mode: 'whitelist' as const, list: ['github.com'] } };
    expect(ctx({ settings: white, host: 'example.com' }).admission()).toBe('blocked');
    expect(ctx({ settings: white, host: 'github.com' }).admission()).toBe('allowed');
  });

  test('站点是否被名单拦下不看总开关：更新提示据此躲开拉黑站点（ADR-0001、#1120）', () => {
    const list = { siteList: { mode: 'blacklist' as const, list: ['github.com'] } };
    expect(ctx({ settings: list }).siteBlocked()).toBe(true);
    expect(ctx({ settings: { ...list, enabled: false } }).siteBlocked()).toBe(true);
    expect(ctx({ settings: { enabled: false } }).siteBlocked()).toBe(false);
    expect(createPageContext({}).siteBlocked()).toBe(false);
  });

  test('总开关关闭：不论站点名单，都是关闭', () => {
    const off = { enabled: false, siteList: { mode: 'blacklist' as const, list: ['github.com'] } };
    expect(ctx({ settings: off }).admission()).toBe('disabled');
  });

  test('什么都没注入：放行、没有领域、算主框架', () => {
    const empty = createPageContext({});
    expect(empty.admission()).toBe('allowed');
    expect(empty.domainId('zh-CN')).toBeUndefined();
    expect(empty.isMainFrame()).toBe(true);
  });
});

describe('当前领域', () => {
  test('按目标语言从命中网址的领域里选', () => {
    expect(ctx().domainId('zh-CN')).toBe('dev-zh');
    expect(ctx().domainId('ZH-cn')).toBe('dev-zh');
    expect(ctx().domainId('ja')).toBeUndefined();
  });

  test('iframe 按顶层页面的主机名判领域（#471）', () => {
    expect(ctx({ host: 'cdn.other.net', top: 'github.com' }).domainId('zh-CN')).toBe('dev-zh');
    expect(ctx({ host: 'github.com', top: 'example.com' }).domainId('zh-CN')).toBeUndefined();
  });

  test('临时选择优先于按网址判定（#400）', () => {
    expect(ctx({ choice: { kind: 'domain', id: 'law-zh' } }).domainId('zh-CN')).toBe('law-zh');
  });

  test('临时选了“无领域”：这个页面不用领域', () => {
    expect(ctx({ choice: { kind: 'none' } }).domainId('zh-CN')).toBeUndefined();
  });

  test('输入翻译按对方语言那个方向解析（ADR-0005）', () => {
    // 阅读方向是 zh-CN，回复要译成英文：取服务英文的那个领域
    expect(ctx().domainId('en')).toBe('dev-en');
    // 临时选的领域服务另一种语言：这个方向回到按网址判定
    expect(ctx({ choice: { kind: 'domain', id: 'law-zh' } }).domainId('en')).toBe('dev-en');
  });
});

describe('popup 的领域状态', () => {
  test('自动判定会选中的领域、临时选择、可切换到的领域，主机名是顶层页面的', () => {
    const state = ctx({ host: 'cdn.other.net', top: 'github.com', choice: { kind: 'none' } }).domainState('zh-CN');
    expect(state).toEqual({
      host: 'github.com',
      autoName: '领域 dev-zh',
      choice: { kind: 'none' },
      options: [
        { id: 'dev-zh', name: '领域 dev-zh' },
        { id: 'law-zh', name: '领域 law-zh' },
      ],
    });
  });

  test('popup 显示的当前领域与请求实际带的一致（#1120）', () => {
    // 自动：popup 显示的自动判定就是请求带的领域
    const auto = ctx({ host: 'cdn.other.net', top: 'law.example.org' });
    const autoId = auto.domainId('zh-CN');
    expect(autoId).toBe('law-zh');
    expect(auto.domainState('zh-CN').autoName).toBe(DOMAINS.find((d) => d.id === autoId)!.name);
    // 临时选了别的领域：popup 报出的临时选择就是请求带的领域
    const chosen = ctx({ top: 'law.example.org', choice: { kind: 'domain', id: 'dev-zh' } });
    const state = chosen.domainState('zh-CN');
    expect(state.choice).toEqual({ kind: 'domain', id: 'dev-zh' });
    expect(chosen.domainId('zh-CN')).toBe('dev-zh');
    expect(state.options.map((o) => o.id)).toContain('dev-zh');
  });

  test('目标语言没有领域：自动判定为空、没有可选项', () => {
    expect(ctx().domainState('ja')).toMatchObject({ autoName: null, options: [] });
  });
});
