/**
 * changelog/prompt.ts — 更新提示流程（#1172）
 *
 * 切入点是 content script 侧的流程模块：接上真实的后台仲裁（claim.ts）与
 * 真实的已读存储（state.ts），页面可见性与弹窗渲染用假实现。一个“页面”
 * 就是一份流程实例 + 一个仲裁用的占用者，卸载页面等于连接断开、释放占用。
 *
 * 断言只看外部结果：哪个页面弹了、存储里记没记已读。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import type { ChangelogEntry } from '~/src/changelog/data';

const VERSION = '9.9.9';
const ENTRIES: ChangelogEntry[] = [{ version: VERSION, groups: [] }];

type Claim = typeof import('~/src/changelog/claim');
type Prompt = typeof import('~/src/changelog/prompt');
type State = typeof import('~/src/changelog/state');
let claim: Claim;
let prompt: Prompt;
let state: State;

interface Modal {
  open: boolean;
  /** 用户点 X / 知道了 / 遮罩 / Esc */
  closeByUser(): void;
}

/** 打开一个页面：visible 为 false 时是后台标签页或预渲染文档。 */
function openPage(opts: { visible?: boolean; renderThrows?: boolean } = {}) {
  let visible = opts.visible ?? true;
  const listeners = new Set<() => void>();
  const owner = {};
  const modals: Modal[] = [];

  const stop = prompt.startChangelogPrompt({
    input: { version: VERSION, isDev: false, isMainFrame: true, siteBlocked: false, entries: ENTRIES },
    page: {
      isVisible: () => visible,
      onVisibilityChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    claim: async (version) => {
      const outcome = await claim.claimShow(version, owner);
      return outcome === 'granted'
        ? { granted: true, lease: { release: () => claim.releaseShow(owner) } }
        : { granted: false, reason: outcome };
    },
    async render(_entry, onClose) {
      if (opts.renderThrows) throw new Error('render failed');
      const m: Modal = {
        open: true,
        closeByUser() {
          m.open = false;
          onClose();
        },
      };
      modals.push(m);
      return () => {
        m.open = false;
      };
    },
  });

  return {
    /** 弹窗此刻是否开着 */
    isOpen: () => modals.some((m) => m.open),
    /** 一共弹过几次 */
    shownCount: () => modals.length,
    modal: () => modals[modals.length - 1]!,
    setVisible(v: boolean) {
      visible = v;
      for (const fn of [...listeners]) fn();
    },
    /** 页面卸载：流程停止，连接断开时后台释放占用 */
    unload() {
      stop();
      claim.releaseShow(owner);
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.useFakeTimers();
  resetStorage();
  // claim.ts 持有模块级队列与占用者，每个用例需要干净的实例
  vi.resetModules();
  claim = await import('~/src/changelog/claim');
  prompt = await import('~/src/changelog/prompt');
  state = await import('~/src/changelog/state');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('可见页面', () => {
  test('弹出；持续可见满阈值后记为已读，之后的页面不再弹', async () => {
    const a = openPage();
    await flush();
    expect(a.isOpen()).toBe(true);
    expect(await state.hasSeen(VERSION)).toBe(false);

    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS);
    expect(await state.hasSeen(VERSION)).toBe(true);
    // 记为已读不关弹窗，等用户自己关
    expect(a.isOpen()).toBe(true);

    const b = openPage();
    await flush();
    expect(b.shownCount()).toBe(0);
  });
});

describe('用户关闭', () => {
  test('不足阈值就关掉也算看过', async () => {
    const a = openPage();
    await flush();
    a.modal().closeByUser();
    await flush();
    expect(await state.hasSeen(VERSION)).toBe(true);

    const b = openPage();
    await flush();
    expect(b.shownCount()).toBe(0);
  });
});

describe('后台标签页与预渲染', () => {
  test('不可见的页面不申请显示权，切到前台才弹', async () => {
    const a = openPage({ visible: false });
    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS * 2);
    expect(a.shownCount()).toBe(0);
    expect(await state.hasSeen(VERSION)).toBe(false);

    a.setVisible(true);
    await flush();
    expect(a.isOpen()).toBe(true);
  });

  test('浏览器重启恢复出一批标签页：只在正在看的那个弹，后台的一个也不弹', async () => {
    const bg1 = openPage({ visible: false });
    const bg2 = openPage({ visible: false });
    const front = openPage({ visible: true });
    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS);

    expect(front.shownCount()).toBe(1);
    expect(await state.hasSeen(VERSION)).toBe(true);

    // 之后切到后台标签页也不再弹
    bg1.setVisible(true);
    bg2.setVisible(true);
    await flush();
    expect(bg1.shownCount() + bg2.shownCount()).toBe(0);
  });

  test('后台标签页没切过去就被关掉，不消耗这次提示', async () => {
    const bg = openPage({ visible: false });
    await flush();
    bg.unload();

    const next = openPage();
    await flush();
    expect(next.isOpen()).toBe(true);
  });
});

describe('没看成就离开', () => {
  test('弹出后不足阈值就卸载（马上跳走）：不记已读，下一个可见页面再弹', async () => {
    const a = openPage();
    await flush();
    expect(a.isOpen()).toBe(true);
    a.unload();
    expect(await state.hasSeen(VERSION)).toBe(false);

    const b = openPage();
    await flush();
    expect(b.isOpen()).toBe(true);
  });

  test('弹出后不足阈值就切走：收起弹窗、不记已读，别的可见页面能拿到', async () => {
    const a = openPage();
    await flush();
    a.setVisible(false);
    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS);
    expect(a.isOpen()).toBe(false);
    expect(await state.hasSeen(VERSION)).toBe(false);

    const b = openPage();
    await flush();
    expect(b.isOpen()).toBe(true);
  });

  test('切走再切回：重新弹出', async () => {
    const a = openPage();
    await flush();
    a.setVisible(false);
    a.setVisible(true);
    await flush();
    expect(a.isOpen()).toBe(true);
    expect(a.shownCount()).toBe(2);
  });

  test('已经算看过之后再切走：弹窗留着，等用户自己关', async () => {
    const a = openPage();
    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS);
    a.setVisible(false);
    expect(a.isOpen()).toBe(true);
  });
});

describe('多个可见页面', () => {
  test('同时打开：只有一个弹出，看完后其余的也不再弹', async () => {
    const pages = [openPage(), openPage(), openPage()];
    await vi.advanceTimersByTimeAsync(prompt.SEEN_AFTER_MS + prompt.BUSY_RETRY_MS * 3);
    expect(pages.reduce((n, p) => n + p.shownCount(), 0)).toBe(1);
    expect(await state.hasSeen(VERSION)).toBe(true);
  });

  test('占着显示权的页面没看成就离开：等着的可见页面接着弹', async () => {
    const a = openPage();
    const b = openPage();
    await flush();
    expect(a.isOpen()).toBe(true);
    expect(b.shownCount()).toBe(0);

    a.unload();
    await vi.advanceTimersByTimeAsync(prompt.BUSY_RETRY_MS);
    expect(b.isOpen()).toBe(true);
  });
});

describe('异常', () => {
  test('渲染失败：不记已读，释放显示权给下一个页面', async () => {
    const broken = openPage({ renderThrows: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await flush();
    expect(broken.shownCount()).toBe(0);
    expect(await state.hasSeen(VERSION)).toBe(false);

    const next = openPage();
    await flush();
    expect(next.isOpen()).toBe(true);
  });

  test('弹窗开着时 content script 失效：还没算看过的弹窗收起，不记已读', async () => {
    const a = openPage();
    await flush();
    a.unload();
    expect(a.isOpen()).toBe(false);
    expect(await state.hasSeen(VERSION)).toBe(false);
  });

  test('本机首装标记落盘后（内存闸门已随 SW 回收丢失）：同版本不弹', async () => {
    await state.markInstalled(VERSION);
    const a = openPage();
    await flush();
    expect(a.shownCount()).toBe(0);
  });

  test('首装：同版本不弹', async () => {
    claim.markFreshInstall();
    const a = openPage();
    await flush();
    expect(a.shownCount()).toBe(0);
  });

  test('申请期间切走：交还显示权，切回来再弹', async () => {
    const a = openPage();
    a.setVisible(false); // 申请还在路上
    await flush();
    expect(a.isOpen()).toBe(false);
    expect(await state.hasSeen(VERSION)).toBe(false);

    a.setVisible(true);
    await flush();
    expect(a.isOpen()).toBe(true);
  });

  test('申请期间页面卸载：拿到的显示权立即交还', async () => {
    const a = openPage();
    a.unload(); // 申请还在路上
    await flush();
    expect(a.shownCount()).toBe(0);

    const b = openPage();
    await flush();
    expect(b.isOpen()).toBe(true);
  });
});
