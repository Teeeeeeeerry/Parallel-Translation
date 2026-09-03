// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 6 — 设置页录制组件 + 冲突检测。
//
// 浏览器优先拦截、扩展收不到的组合需提示用户，
// 保留组合检测是提示而非阻止 —— 允许设置但给出明确警告。

import type { HotkeyAction } from '../storage/schema';
import { fromEvent } from './normalize';
import { tf } from '../i18n';
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

/** 动作显示名。取不到 i18n 文案时回退中文，保证漏配 key 不会显示空白。 */
export function actionLabel(action: HotkeyAction): string {
  const FALLBACK: Record<HotkeyAction, string> = {
    'toggle-translate': '全页翻译',
    'toggle-mode': '切换显示模式',
    'translate-paragraph': '翻译当前段',
    'toggle-extension': '扩展总开关',
  };
  const KEYS: Record<HotkeyAction, string> = {
    'toggle-translate': 'actionToggleTranslate',
    'toggle-mode': 'actionToggleMode',
    'translate-paragraph': 'actionTranslateParagraph',
    'toggle-extension': 'actionToggleExtension',
  };
  return tf(KEYS[action], FALLBACK[action]);
}

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
    return tf('conflictReserved', '该组合被浏览器占用，扩展无法接收');
  }
  for (const [action, bound] of Object.entries(hotkeys)) {
    if (action !== self && bound === combo) {
      const label = actionLabel(action as HotkeyAction);
      return tf('conflictDuplicate', `与“${label}”重复`, label);
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
  onCancel?: () => void,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // #176: Esc 单独走取消回调 —— 修复前 fromEvent 返回 null 走 onReject，
    // 误报「请使用带修饰键的组合」，用户以为录制出错
    if (e.key === 'Escape') {
      onCancel?.();
      return;
    }

    // 仅修饰键 -> 忽略
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

    const combo = fromEvent(e, os);
    if (!combo) {
      onReject(tf('needModifier', '请使用带修饰键的组合（如 ⌘+Shift+Y）'));
      return;
    }

    onCapture(combo);
  };

  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}
