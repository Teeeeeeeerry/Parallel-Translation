// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 快捷键分区：动作列表 + 格式化显示 + 录制按钮 + 冲突检测。

import type { HotkeyAction } from '~/src/storage/schema';
import type { OS } from '~/src/hotkeys/platform';
import { formatHotkey } from '~/src/hotkeys/platform';
import { actionLabel, startRecording, checkConflict } from '~/src/hotkeys/recorder';
import { tf } from '~/src/i18n';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

const ACTIONS: HotkeyAction[] = [
  'toggle-translate',
  'toggle-mode',
  'translate-paragraph',
  'toggle-extension',
];

export function initHotkeys(os: OS): void {
  const listEl = document.getElementById('pt-hotkey-list')!;

  // #176: 单一活动录制会话 —— 录制 A 未结束点 B 时先取消 A，
  // 否则两个 keydown 监听并存，一次按键把同一 combo 同时写进两个动作
  let activeRecording: { action: HotkeyAction; cancel: () => void } | null =
    null;

  function cancelActiveRecording(): void {
    if (!activeRecording) return;
    activeRecording.cancel();
    const btn = document.getElementById(`pt-hotkey-${activeRecording.action}`);
    if (btn) {
      btn.classList.remove('pt-recording');
      btn.textContent = formatHotkey(
        getSettings().hotkeys[activeRecording.action]!,
        os,
      );
    }
    activeRecording = null;
  }

  function render(): void {
    const s = getSettings();
    listEl.innerHTML = ACTIONS.map((action) => {
      const combo = s.hotkeys[action];
      const conflict = checkConflict(combo, s.hotkeys, action);
      return `
        <div class="pt-hotkey-row">
          <span class="pt-row-label">${actionLabel(action)}</span>
          <button
            class="pt-hotkey-combo"
            id="pt-hotkey-${action}"
            data-action="${action}"
            title="${tf('recordTitle', '点击录制新快捷键')}"
          >${formatHotkey(combo, os)}</button>
        </div>
        ${conflict ? `<div class="pt-hotkey-conflict">⚠ ${conflict}</div>` : ''}
      `;
    }).join('');

    bindRecording(os);
  }

  function bindRecording(recOS: OS): void {
    for (const action of ACTIONS) {
      const btn = document.getElementById(`pt-hotkey-${action}`);
      if (!btn) continue;

      btn.addEventListener('click', () => {
        // 点击正在录制的按钮 → 取消本次录制
        if (btn.classList.contains('pt-recording')) {
          cancelActiveRecording();
          return;
        }

        // 开始新录制前取消上一个会话（#176）
        cancelActiveRecording();

        // Show recording state
        btn.classList.add('pt-recording');
        btn.textContent = tf('recording', '按下组合键…');

        const cancelRecord = startRecording(
          recOS,
          (combo) => {
            cancelRecord();
            activeRecording = null;
            btn.classList.remove('pt-recording');
            btn.textContent = formatHotkey(combo, recOS);

            const conflict = checkConflict(combo, getSettings().hotkeys, action);
            if (conflict) {
              // Show conflict warning but still allow saving
              const existing = document.getElementById(`pt-conflict-${action}`);
              if (existing) existing.remove();
              const warn = document.createElement('div');
              warn.id = `pt-conflict-${action}`;
              warn.className = 'pt-hotkey-conflict';
              warn.textContent = `⚠ ${conflict}`;
              btn.parentElement!.after(warn);
            }

            savePatch({ hotkeys: { ...getSettings().hotkeys, [action]: combo } });
          },
          (reason) => {
            cancelRecord();
            activeRecording = null;
            btn.classList.remove('pt-recording');
            btn.textContent = formatHotkey(getSettings().hotkeys[action]!, recOS);
            const existing = document.getElementById(`pt-conflict-${action}`);
            if (existing) existing.remove();
            const warn = document.createElement('div');
            warn.id = `pt-conflict-${action}`;
            warn.className = 'pt-hotkey-conflict';
            warn.textContent = `⚠ ${reason}`;
            btn.parentElement!.after(warn);
            setTimeout(() => warn.remove(), 2500);
          },
          () => {
            // #176: Esc 取消 —— 还原按钮态并给出「已取消」提示
            cancelRecord();
            activeRecording = null;
            btn.classList.remove('pt-recording');
            btn.textContent = formatHotkey(getSettings().hotkeys[action]!, recOS);
            const existing = document.getElementById(`pt-conflict-${action}`);
            if (existing) existing.remove();
            const warn = document.createElement('div');
            warn.id = `pt-conflict-${action}`;
            warn.className = 'pt-hotkey-conflict';
            warn.textContent = tf('recordCancelled', '已取消');
            btn.parentElement!.after(warn);
            setTimeout(() => warn.remove(), 2500);
          },
        );
        activeRecording = { action, cancel: cancelRecord };
      });
    }
  }

  render();
  onSettingsChanged(() => render());
}
