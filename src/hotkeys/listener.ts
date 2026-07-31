// Phase 6 — content script 运行时快捷键监听。
// 用捕获阶段监听，抢在页面自身的按键处理之前。

import { getOSSync } from './platform';
import { fromEvent, isTypingContext } from './normalize';
import { getSettings } from '../storage/settings';
import type { HotkeyAction } from '../storage/schema';

export function startHotkeys(
  handlers: Record<HotkeyAction, () => void>,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingContext()) return;
    const os = getOSSync();
    const combo = fromEvent(e, os);
    if (!combo) return;

    const { hotkeys } = getSettings();
    for (const [action, bound] of Object.entries(hotkeys)) {
      if (bound === combo) {
        e.preventDefault();
        e.stopPropagation();
        handlers[action as HotkeyAction]?.();
        return;
      }
    }
  };
  // 用捕获阶段，抢在页面自身的按键处理之前
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}
