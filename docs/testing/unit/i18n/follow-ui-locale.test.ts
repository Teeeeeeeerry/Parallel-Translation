/**
 * “跟随扩展语言”入口（#1123，父 #1114）
 *
 * 内容脚本与后台都只调一次 followUiLocale(设置订阅)：首次按当前设置载入，之后
 * 随设置变化换表；去重、失败重试、作废较早的载入都在入口里。假的设置订阅与
 * 取表函数；只看外部行为：切换语言后 t() 取到的文案是什么、取表调了几次。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  followUiLocale,
  loadUiLocale,
  t,
  type MessageLoader,
  type MessageTable,
  type UiLocale,
  type UiLocaleChoice,
} from '~/src/i18n';

function readMessages(locale: UiLocale): MessageTable {
  const p = path.resolve('public/_locales', locale, 'messages.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as MessageTable;
}
const KEY = 'toastExtOn';
const message = (locale: UiLocale) => readMessages(locale)[KEY]!.message;
/** 跟随浏览器时 t() 走 chrome.i18n；setup 的替身返回 key 本身 */
const browserText = () => chrome.i18n.getMessage(KEY);

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** 假的设置订阅：push(choice) 模拟设置变了 */
function fakeSettings(initial: UiLocaleChoice) {
  const listeners = new Set<(c: UiLocaleChoice) => void>();
  return {
    initial,
    subscribe: (fn: (c: UiLocaleChoice) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    push: (c: UiLocaleChoice) => listeners.forEach((fn) => fn(c)),
  };
}

const fromRepo: MessageLoader = async (locale) => readMessages(locale);

afterEach(async () => {
  await loadUiLocale('browser');
});

describe('跟随扩展语言（#1123）', () => {
  test('首次按当前设置载入；设置切到另一种语言后换表', async () => {
    const s = fakeSettings('en');
    const load = vi.fn(fromRepo);
    const follow = followUiLocale({ ...s, load });
    expect(await follow.ready).toBe(true);
    expect(t(KEY)).toBe(message('en'));

    s.push('zh_TW');
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    follow.stop();
  });

  test('选回“跟随浏览器”：立即回到浏览器语言，一次都不取表', async () => {
    const s = fakeSettings('en');
    const load = vi.fn(fromRepo);
    const follow = followUiLocale({ ...s, load });
    await follow.ready;
    const calls = load.mock.calls.length;
    s.push('browser');
    expect(t(KEY)).toBe(browserText());
    await flush();
    expect(load.mock.calls.length).toBe(calls);
    follow.stop();
  });

  test('一开始就是跟随浏览器：不载入任何东西', async () => {
    const load = vi.fn(fromRepo);
    const follow = followUiLocale({ ...fakeSettings('browser'), load });
    expect(await follow.ready).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(t(KEY)).toBe(browserText());
  });

  test('同一种语言不重复载入（设置里别的项变了也会推一次）', async () => {
    const s = fakeSettings('en');
    const load = vi.fn(fromRepo);
    const follow = followUiLocale({ ...s, load });
    await follow.ready;
    const calls = load.mock.calls.length;
    s.push('en');
    s.push('en');
    await flush();
    expect(load.mock.calls.length).toBe(calls);
    follow.stop();
  });

  test('取表失败（后台恰好在重启）：先回到浏览器语言，退避重试后最终换上所选语言', async () => {
    const s = fakeSettings('browser');
    let failures = 2;
    const load = vi.fn<MessageLoader>(async (locale) => {
      // 所选语言那张表前两次取不到（回落用的 zh_CN 每次照常）
      if (locale === 'zh_TW' && failures > 0) {
        failures--;
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return readMessages(locale);
    });
    const waits: number[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const follow = followUiLocale({ ...s, load, sleep: async (ms) => void waits.push(ms) });
    await follow.ready;

    s.push('zh_TW');
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    // 两次失败各等一次，等的时间越来越长
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]!);
    error.mockRestore();
    follow.stop();
  });

  test('一直取不到：重试有上限，停在浏览器语言；之后同一个选择再推来时重新试', async () => {
    let down = true;
    const load = vi.fn<MessageLoader>(async (locale) => {
      if (down) throw new Error('后台没有给出文案');
      return readMessages(locale);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = fakeSettings('en');
    const follow = followUiLocale({ ...s, load, sleep: async () => {} });
    expect(await follow.ready).toBe(false);
    await flush();
    // 首次一次加重试五次，每次取所选语言与回落的 zh_CN 两张表
    expect(load.mock.calls.filter(([l]) => l === 'en')).toHaveLength(6);
    const calls = load.mock.calls.length;
    await flush();
    expect(load.mock.calls.length).toBe(calls);
    expect(t(KEY)).toBe(browserText());

    // 后台回来了；设置里别的项变了，又推来同一个选择
    down = false;
    s.push('en');
    await flush();
    expect(t(KEY)).toBe(message('en'));
    error.mockRestore();
    follow.stop();
  });

  test('快速连切两次：最后是第二次选的语言，第一次较晚载完也不会盖过它', async () => {
    const s = fakeSettings('browser');
    /** 每一次取表各自的放行函数，按语言分组、按调用先后排 */
    const pending: { locale: UiLocale; release: () => void }[] = [];
    const load: MessageLoader = (locale) =>
      new Promise((resolve) => pending.push({ locale, release: () => resolve(readMessages(locale)) }));
    const releaseAll = (pick: (p: (typeof pending)[number], i: number) => boolean) =>
      pending.forEach((p, i) => pick(p, i) && p.release());
    const follow = followUiLocale({ ...s, load });
    await follow.ready;

    s.push('en');
    s.push('zh_TW');
    await flush();
    // 第一次切换取了 en 与 zh_CN，第二次取了 zh_TW 与 zh_CN
    expect(pending.map((p) => p.locale)).toEqual(['en', 'zh_CN', 'zh_TW', 'zh_CN']);
    // 第二次先载完
    releaseAll((_, i) => i >= 2);
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    // 第一次后载完：不盖过第二次
    releaseAll((_, i) => i < 2);
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    follow.stop();
  });

  test('初始设置还没读到时推来的选择优先（后台启动时被设置变化唤醒）', async () => {
    const s = fakeSettings('browser');
    let resolveInitial!: (c: UiLocaleChoice) => void;
    const follow = followUiLocale({
      initial: new Promise<UiLocaleChoice>((r) => (resolveInitial = r)),
      subscribe: s.subscribe,
      load: fromRepo,
    });
    s.push('zh_TW');
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    // 读到的初始设置是变化之前的旧值：不采用
    resolveInitial('en');
    expect(await follow.ready).toBe(true);
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    follow.stop();
  });

  test('重试等待期间换了选择：旧的那次不再重试', async () => {
    const s = fakeSettings('browser');
    const asked: UiLocale[] = [];
    let wake: (() => void) | null = null;
    const load: MessageLoader = async (locale) => {
      asked.push(locale);
      if (locale === 'en') throw new Error('后台没有给出文案');
      return readMessages(locale);
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const follow = followUiLocale({ ...s, load, sleep: () => new Promise<void>((r) => (wake = r)) });
    await follow.ready;
    s.push('en');
    await flush();
    s.push('zh_TW');
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    const before = asked.filter((l) => l === 'en').length;
    wake!();
    await flush();
    expect(asked.filter((l) => l === 'en').length).toBe(before);
    expect(t(KEY)).toBe(message('zh_TW'));
    error.mockRestore();
    follow.stop();
  });

  test('每次落定之后通知调用方（后台据此更新右键菜单标题）；退订之后不再跟随', async () => {
    const s = fakeSettings('en');
    const applied = vi.fn();
    const follow = followUiLocale({ ...s, load: fromRepo, onApplied: applied });
    await follow.ready;
    expect(applied).toHaveBeenCalledTimes(1);
    s.push('zh_TW');
    await flush();
    expect(applied).toHaveBeenCalledTimes(2);

    follow.stop();
    s.push('en');
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    expect(applied).toHaveBeenCalledTimes(2);
  });

  test('被同一上下文里别处的载入取代（不是失败）：不重试、不盖过对方', async () => {
    const s = fakeSettings('browser');
    let releaseEn: (() => void) | null = null;
    const load = vi.fn<MessageLoader>((locale) =>
      locale === 'en'
        ? new Promise((resolve) => (releaseEn = () => resolve(readMessages(locale))))
        : Promise.resolve(readMessages(locale)),
    );
    const waits: number[] = [];
    const applied = vi.fn();
    const follow = followUiLocale({ ...s, load, sleep: async (ms) => void waits.push(ms), onApplied: applied });
    await follow.ready;
    applied.mockClear();

    s.push('en');
    await flush();
    // en 还在载入，别处直接载入了繁体
    await loadUiLocale('zh_TW', fromRepo);
    releaseEn!();
    await flush();
    expect(t(KEY)).toBe(message('zh_TW'));
    expect(waits).toEqual([]);
    expect(load.mock.calls.filter(([l]) => l === 'en')).toHaveLength(1);
    expect(applied).not.toHaveBeenCalled();

    // 之后设置又推来 en：照常载入
    s.push('en');
    await flush();
    releaseEn!();
    await flush();
    expect(t(KEY)).toBe(message('en'));
    follow.stop();
  });
});
