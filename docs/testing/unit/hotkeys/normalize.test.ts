/**
 * hotkeys/normalize.ts — 组合键规范化 单元测试
 */
import { describe, test, expect } from 'vitest';
import { fromEvent, isTypingContext } from '~/src/hotkeys/normalize';
import type { OS } from '~/src/hotkeys/platform';

function makeKeyEvent(
  key: string,
  opts: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
  });
}

describe('fromEvent', () => {
  // ── Mac ──

  test('Mac Meta+Y → "Mod+Y"', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('y', { metaKey: true });
    expect(fromEvent(e, os)).toBe('Mod+Y');
  });

  test('Mac Ctrl+Shift+T → "Ctrl+Shift+T"', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('t', { ctrlKey: true, shiftKey: true });
    expect(fromEvent(e, os)).toBe('Ctrl+Shift+T');
  });

  test('Mac Meta+Alt+Shift+D → "Mod+Alt+Shift+D"', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('d', { metaKey: true, altKey: true, shiftKey: true });
    expect(fromEvent(e, os)).toBe('Mod+Alt+Shift+D');
  });

  test('Mac Meta+Shift+Y → "Mod+Shift+Y"', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('y', { metaKey: true, shiftKey: true });
    expect(fromEvent(e, os)).toBe('Mod+Shift+Y');
  });

  // ── Windows/Linux ──

  test('Win Ctrl+Y → "Mod+Y"', () => {
    const os: OS = 'other';
    const e = makeKeyEvent('y', { ctrlKey: true });
    expect(fromEvent(e, os)).toBe('Mod+Y');
  });

  test('Win Ctrl+Shift+Y → "Mod+Shift+Y"', () => {
    const os: OS = 'other';
    const e = makeKeyEvent('y', { ctrlKey: true, shiftKey: true });
    expect(fromEvent(e, os)).toBe('Mod+Shift+Y');
  });

  test('Win Meta 键被忽略（不生成 Mod）', () => {
    const os: OS = 'other';
    const e = makeKeyEvent('y', { metaKey: true, ctrlKey: true });
    // Windows 上 metaKey 不生成 Mod，只有 ctrlKey 生成 Mod
    expect(fromEvent(e, os)).toBe('Mod+Y');
  });

  // ── 拒绝 ──

  test('无修饰键 → null', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('y');
    expect(fromEvent(e, os)).toBeNull();
  });

  test('Control 单独按下 → null', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('Control');
    expect(fromEvent(e, os)).toBeNull();
  });

  test('Meta 单独按下 → null', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('Meta');
    expect(fromEvent(e, os)).toBeNull();
  });

  test('Alt 单独按下 → null', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('Alt');
    expect(fromEvent(e, os)).toBeNull();
  });

  test('Shift 单独按下 → null', () => {
    const os: OS = 'mac';
    const e = makeKeyEvent('Shift');
    expect(fromEvent(e, os)).toBeNull();
  });

  // ── #176：空格 / 加号显式映射 ──

  test('Mac Meta+空格 → "Mod+Space"（#176）', () => {
    const e = makeKeyEvent(' ', { metaKey: true });
    expect(fromEvent(e, 'mac')).toBe('Mod+Space');
  });

  test('Win Ctrl+加号 → "Mod+Plus"（#176）', () => {
    const e = makeKeyEvent('+', { ctrlKey: true });
    expect(fromEvent(e, 'other')).toBe('Mod+Plus');
  });
});

describe('isTypingContext', () => {
  // jsdom 中 focus() 和 isContentEditable 行为与真实浏览器有差异，
  // 直接 mock document.activeElement

  function mockActiveElement(tag: string, contentEditable = false): void {
    const el = document.createElement(tag) as HTMLElement;
    if (contentEditable) el.contentEditable = 'true';
    // jsdom 中 isContentEditable 可能为 undefined，显式设置
    Object.defineProperty(el, 'isContentEditable', {
      value: contentEditable,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'activeElement', {
      value: el,
      writable: true,
      configurable: true,
    });
  }

  test('input → true', () => {
    mockActiveElement('input');
    expect(isTypingContext()).toBe(true);
  });

  test('textarea → true', () => {
    mockActiveElement('textarea');
    expect(isTypingContext()).toBe(true);
  });

  test('[contentEditable] → true', () => {
    mockActiveElement('div', true);
    expect(isTypingContext()).toBe(true);
  });

  test('普通 div → false', () => {
    mockActiveElement('div');
    expect(isTypingContext()).toBe(false);
  });

  test('body → false', () => {
    mockActiveElement('body');
    expect(isTypingContext()).toBe(false);
  });
});
