/**
 * hotkeys/recorder.ts — 录制组件（#176）
 *
 * 覆盖：Esc 走取消回调、带修饰键捕获、无修饰键拒绝。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('~/src/i18n', () => ({
  tf: (key: string, fallback: string) => fallback,
}));

import { startRecording } from '~/src/hotkeys/recorder';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe('startRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('带修饰键 → onCapture 收到规范组合', () => {
    const onCapture = vi.fn();
    const onReject = vi.fn();
    const stop = startRecording('mac', onCapture, onReject);
    document.dispatchEvent(keydown({ key: 'y', metaKey: true, shiftKey: true }));
    expect(onCapture).toHaveBeenCalledWith('Mod+Shift+Y');
    expect(onReject).not.toHaveBeenCalled();
    stop();
  });

  test('Esc → 走 onCancel 而非 onReject（#176）', () => {
    const onCapture = vi.fn();
    const onReject = vi.fn();
    const onCancel = vi.fn();
    const stop = startRecording('mac', onCapture, onReject, onCancel);
    document.dispatchEvent(keydown({ key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    stop();
  });

  test('无修饰键 → onReject', () => {
    const onCapture = vi.fn();
    const onReject = vi.fn();
    const stop = startRecording('mac', onCapture, onReject);
    document.dispatchEvent(keydown({ key: 'y' }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
    stop();
  });

  test('stop() 后不再监听', () => {
    const onCapture = vi.fn();
    const stop = startRecording('mac', onCapture, vi.fn());
    stop();
    document.dispatchEvent(keydown({ key: 'y', metaKey: true }));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
