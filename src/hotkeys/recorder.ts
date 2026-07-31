// Phase 6 — 设置页录制组件 + 冲突检测。
//
// 浏览器优先拦截、扩展收不到的组合需提示用户，
// 保留组合检测是提示而非阻止 —— 允许设置但给出明确警告。

import type { HotkeyAction } from '../storage/schema';
import { fromEvent } from './normalize';
import type { OS } from './platform';

/** 浏览器优先拦截、扩展收不到的组合 */
const RESERVED = [
  'Mod+T',
  'Mod+W',
  'Mod+N',
  'Mod+Q',
  'Mod+R',
  'Mod+L',
  'Mod+Shift+T',
  'Mod+Shift+N',
  'Mod+Shift+W',
];

const ACTION_LABELS: Record<HotkeyAction, string> = {
  'toggle-translate': '全页翻译',
  'toggle-mode': '切换显示模式',
  'translate-paragraph': '翻译当前段',
  'toggle-extension': '扩展总开关',
};

/**
 * 检测冲突：
 * - 浏览器保留组合 → 提示但允许
 * - 与其他已绑定的动作重复 → 提示冲突
 */
export function checkConflict(
  combo: string,
  hotkeys: Record<HotkeyAction, string>,
  self: HotkeyAction,
): string | null {
  if (RESERVED.includes(combo)) {
    return '该组合被浏览器占用，扩展无法接收';
  }
  for (const [action, bound] of Object.entries(hotkeys)) {
    if (action !== self && bound === combo) {
      return `与「${ACTION_LABELS[action as HotkeyAction]}」重复`;
    }
  }
  return null;
}

/**
 * 录制组件：监听 keydown，捕获并规范化用户按下的组合。
 * 仅接受带修饰键的组合，拒绝单键。
 * 返回取消监听函数。
 */
export function startRecording(
  os: OS,
  onCapture: (combo: string) => void,
  onReject: (reason: string) => void,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 仅修饰键 -> 忽略
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

    const combo = fromEvent(e, os);
    if (!combo) {
      onReject('请使用带修饰键的组合（如 ⌘+Shift+Y）');
      return;
    }

    onCapture(combo);
  };

  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}

export { ACTION_LABELS };
