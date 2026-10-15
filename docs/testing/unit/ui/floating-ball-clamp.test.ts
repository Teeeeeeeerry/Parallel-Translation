/**
 * 悬浮球钳制的右、下边界（#994）
 *
 * position: fixed 的球能占的是视口去掉滚动条的那一块。占位的经典滚动条下
 * innerWidth 比文档根的 clientWidth 大出滚动条那一截，拿 innerWidth 钳制，
 * 拖到最右时球会被滚动条盖住。本机 macOS 的 headless Chromium 是覆盖式
 * 滚动条，两者相等，端到端复现不了；这里在 jsdom 里把两者设成不同值，
 * 断言钳制读的是 clientWidth / clientHeight —— 在哪台机器上跑都能红。
 *
 * jsdom 不排版：球的 offsetWidth / offsetHeight 设成 44，offsetLeft / offsetTop
 * 按内联 left / top 读，模拟拖过的球（position: fixed，offsetParent 为 null）。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

const BALL = 44;
const MARGIN = 8;
/** 带经典滚动条的视口：innerWidth 含 17px 竖向滚动条、innerHeight 含 17px 横向滚动条 */
const INNER = { w: 1280, h: 720 };
const CLIENT = { w: 1263, h: 703 };

/** 只撤自己装的桩：restoreAllMocks 会连 setup 里的 chrome.storage 桩一起撤掉 */
const spies: { mockRestore(): void }[] = [];
const spy = <T extends object>(obj: T, prop: keyof T & string, value: unknown) => {
  const s = vi.spyOn(obj as never, prop as never, 'get' as never) as unknown as {
    mockImplementation(fn: unknown): void;
    mockRestore(): void;
  };
  s.mockImplementation(typeof value === 'function' ? value : () => value);
  spies.push(s);
};

function ball(): HTMLElement {
  return document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball')!;
}

function stubBox(): void {
  const proto = HTMLElement.prototype;
  const size = function (this: HTMLElement) {
    return this.classList.contains('pt-ball') ? BALL : 0;
  };
  spy(proto, 'offsetWidth', size);
  spy(proto, 'offsetHeight', size);
  spy(proto, 'offsetLeft', function (this: HTMLElement) {
    return parseFloat(this.style.left) || 0;
  });
  spy(proto, 'offsetTop', function (this: HTMLElement) {
    return parseFloat(this.style.top) || 0;
  });
  spy(proto, 'offsetParent', () => null);
}

function stubViewport(): void {
  spy(window, 'innerWidth', INNER.w);
  spy(window, 'innerHeight', INNER.h);
  spy(document.documentElement, 'clientWidth', CLIENT.w);
  spy(document.documentElement, 'clientHeight', CLIENT.h);
}

/** 期望的右下角：从去掉滚动条的视口边缘往里留 8px */
const RIGHT = CLIENT.w - BALL - MARGIN;
const BOTTOM = CLIENT.h - BALL - MARGIN;

describe('悬浮球钳制读去掉滚动条的视口（#994）', () => {
  let stop: () => void;

  beforeEach(() => {
    resetStorage();
    vi.resetModules();
    document.body.innerHTML = '';
    stubBox();
    stubViewport();
    // 前提：环境确实是“经典滚动条”形态，且文档在标准模式
    expect(document.compatMode).toBe('CSS1Compat');
    expect(window.innerWidth).toBeGreaterThan(document.documentElement.clientWidth);
  });

  afterEach(() => {
    stop?.();
    while (spies.length) spies.pop()!.mockRestore();
  });

  test('拖到最右下角：球停在滚动条左缘、上缘往里 8px，不压到滚动条下面', async () => {
    const { createBall } = await import('~/src/ui/floating-ball');
    stop = createBall({ onToggle: () => {} });
    const b = ball();
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5000, clientY: 5000 }));
    expect(b.style.left).toBe(`${RIGHT}px`);
    expect(b.style.top).toBe(`${BOTTOM}px`);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const key = `pt-ball-pos:${location.hostname}`;
    await vi.waitFor(async () => {
      expect((await chrome.storage.local.get(key))[key]).toEqual({ x: RIGHT, y: BOTTOM });
    });
  });

  test('恢复的位置越界：钳回滚动条以内并写回存储', async () => {
    const key = `pt-ball-pos:${location.hostname}`;
    await chrome.storage.local.set({ [key]: { x: 5000, y: 5000 } });
    const { createBall } = await import('~/src/ui/floating-ball');
    stop = createBall({ onToggle: () => {} });
    await vi.waitFor(() => expect(ball().style.left).toBe(`${RIGHT}px`));
    expect(ball().style.top).toBe(`${BOTTOM}px`);
    await vi.waitFor(async () => {
      expect((await chrome.storage.local.get(key))[key]).toEqual({ x: RIGHT, y: BOTTOM });
    });
  });

  test('窗口变窄后拖过的球钳回：同样按去掉滚动条的宽度', async () => {
    const { createBall } = await import('~/src/ui/floating-ball');
    stop = createBall({ onToggle: () => {} });
    const b = ball();
    b.style.position = 'fixed';
    b.style.left = `${INNER.w - BALL - MARGIN}px`;
    b.style.top = '100px';
    window.dispatchEvent(new Event('resize'));
    expect(b.style.left).toBe(`${RIGHT}px`);
    expect(b.style.top).toBe('100px');
  });

  test('文档根量不到宽高（为 0）时退回 innerWidth / innerHeight，球不会被钳到左上角', async () => {
    spy(document.documentElement, 'clientWidth', 0);
    spy(document.documentElement, 'clientHeight', 0);
    const { createBall } = await import('~/src/ui/floating-ball');
    stop = createBall({ onToggle: () => {} });
    const b = ball();
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5000, clientY: 5000 }));
    expect(b.style.left).toBe(`${INNER.w - BALL - MARGIN}px`);
    expect(b.style.top).toBe(`${INNER.h - BALL - MARGIN}px`);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
});
