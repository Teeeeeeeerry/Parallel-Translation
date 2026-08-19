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
    // #164: 按住按键时浏览器按 ~30Hz 重复派发 keydown —— 不过滤会
    // 连续触发 toggle/翻页，翻译进行中重复发起、译文落地后又还原。
    // 录制器 startRecording 首次捕获即移除监听，天然免疫此问题。
    if (e.repeat) return;
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
