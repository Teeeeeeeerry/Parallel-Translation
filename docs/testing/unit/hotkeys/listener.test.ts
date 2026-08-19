/**
 * hotkeys/listener.ts — 快捷键监听器（#164）
 *
 * 覆盖：e.repeat 重复事件过滤、组合键命中 handler。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({
    hotkeys: { 'toggle-translate': 'Mod+Shift+Y' },
  })),
}));

vi.mock('~/src/hotkeys/platform', () => ({
  getOSSync: vi.fn(() => 'mac'),
}));

import { startHotkeys } from '~/src/hotkeys/listener';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

/** handlers 需覆盖全部 HotkeyAction（类型约束） */
function handlers(translate: () => void): Record<string, () => void> {
  return {
    'toggle-translate': translate,
    'toggle-mode': () => {},
    'translate-paragraph': () => {},
    'toggle-extension': () => {},
  };
}

describe('startHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('命中组合键 → 触发 handler', () => {
    const handler = vi.fn();
    const stop = startHotkeys(handlers(handler));
    document.dispatchEvent(
      keydown({ key: 'y', metaKey: true, shiftKey: true }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  test('repeat=true（按住连发）→ 不触发 handler（#164）', () => {
    const handler = vi.fn();
    const stop = startHotkeys(handlers(handler));
    document.dispatchEvent(
      keydown({ key: 'y', metaKey: true, shiftKey: true, repeat: true }),
    );
    expect(handler).not.toHaveBeenCalled();
    stop();
  });

  test('未命中组合键 → 不触发 handler', () => {
    const handler = vi.fn();
    const stop = startHotkeys(handlers(handler));
    document.dispatchEvent(keydown({ key: 'y', metaKey: true }));
    expect(handler).not.toHaveBeenCalled();
    stop();
  });
});
