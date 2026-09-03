// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 6 — 组合键规范化、解析、事件匹配。
//
// Mod 在 Mac 上是 ⌘、其余平台是 Ctrl；Ctrl 在 Mac 上是独立的 ⌃。
// 两者必须分开建模 —— 只用 Ctrl 会让 Mac 用户被迫使用反直觉的组合。

import type { OS } from './platform';

/**
 * 从 KeyboardEvent 提取平台无关的组合键表示。
 * 拒绝无修饰键的单键 → 避免与页面输入冲突。
 */
export function fromEvent(e: KeyboardEvent, os: OS): string | null {
  // #176: 空格/加号等会破坏 '+' 分隔符语义的键显式映射 ——
  // 原样保留会生成 'Mod+ ' / 'Mod++'，解析与显示双双损坏
  const KEY_ALIAS: Record<string, string> = { ' ': 'Space', '+': 'Plus' };
  const key = KEY_ALIAS[e.key] ?? e.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;

  const mods: string[] = [];
  if (os === 'mac') {
    if (e.metaKey) mods.push('Mod');
    if (e.ctrlKey) mods.push('Ctrl');
  } else if (e.ctrlKey) {
    mods.push('Mod');
  }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  if (!mods.length) return null;
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

export function matches(
  e: KeyboardEvent,
  combo: string,
  os: OS,
): boolean {
  return fromEvent(e, os) === combo;
}

/** 焦点在可输入元素内时不响应快捷键 */
export function isTypingContext(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.isContentEditable
  );
}
