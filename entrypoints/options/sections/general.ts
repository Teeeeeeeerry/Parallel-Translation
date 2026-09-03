// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 通用设置分区：开关、语言对、显示模式、悬浮 UI。

import { LANG_LIST } from '~/src/storage/schema';
import type { DisplayMode } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { tf } from '~/src/i18n';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

function buildLangOptions(selected: string, includeAuto: boolean): string {
  return LANG_LIST
    .filter((l) => includeAuto || l.code !== 'auto')
    .map(
      (l) =>
        `<option value="${l.code}"${l.code === selected ? ' selected' : ''}>${l.label}</option>`,
    )
    .join('');
}

export function initGeneral(): void {
  const toggleEnabled = document.getElementById('pt-toggle-enabled')!;
  const selectFrom = document.getElementById('pt-select-from') as HTMLSelectElement;
  const selectTo = document.getElementById('pt-select-to') as HTMLSelectElement;
  const selectMode = document.getElementById('pt-select-mode') as HTMLSelectElement;
  const selectParaMode = document.getElementById('pt-select-para-mode') as HTMLSelectElement;
  const toggleFloatingBall = document.getElementById('pt-toggle-floating-ball')!;
  const toggleParagraphBtn = document.getElementById('pt-toggle-paragraph-btn')!;

  function syncUI(): void {
    const s = getSettings();
    toggleEnabled.classList.toggle('pt-on', s.enabled);
    selectFrom.innerHTML = buildLangOptions(s.from, true);
    selectTo.innerHTML = buildLangOptions(s.to, false);
    selectMode.value = s.displayMode;
    selectParaMode.value = s.paraDisplayMode ?? 'follow';
    toggleFloatingBall.classList.toggle('pt-on', s.showFloatingBall);
    toggleParagraphBtn.classList.toggle('pt-on', s.showParagraphBtn);
  }

  toggleEnabled.addEventListener('click', () => {
    savePatch({ enabled: !getSettings().enabled });
  });

  selectFrom.addEventListener('change', () => {
    savePatch({ from: selectFrom.value });
  });

  selectTo.addEventListener('change', () => {
    savePatch({ to: selectTo.value });
  });

  selectMode.addEventListener('change', () => {
    savePatch({ displayMode: selectMode.value as DisplayMode });
  });

  selectParaMode.addEventListener('change', () => {
    savePatch({
      paraDisplayMode: selectParaMode.value as DisplayMode | 'follow',
    });
  });

  toggleFloatingBall.addEventListener('click', () => {
    savePatch({ showFloatingBall: !getSettings().showFloatingBall });
  });

  toggleParagraphBtn.addEventListener('click', () => {
    savePatch({ showParagraphBtn: !getSettings().showParagraphBtn });
  });

  const resetBallPosBtn = document.getElementById('pt-reset-ball-pos-btn')!;
  const ballPosToggle = document.getElementById('pt-ball-pos-toggle')!;
  const ballPosPanel = document.getElementById('pt-ball-pos-panel')!;
  const ballPosList = document.getElementById('pt-ball-pos-list')!;
  const ballPosTable = document.getElementById('pt-ball-pos-table')!;
  const ballPosEmpty = document.getElementById('pt-ball-pos-empty')!;

  async function loadBallPosSites(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    // #180: 悬浮球位置只写 pt-ball-pos:<hostname>，全局键 pt-ball-pos
    // 是死概念（从未被写入）—— 列表/删除/重置都不再处理它
    const ballKeys = Object.keys(all).filter((k) =>
      k.startsWith('pt-ball-pos:'),
    );
    if (ballKeys.length === 0) {
      ballPosEmpty.style.display = 'block';
      ballPosTable.style.display = 'none';
      return;
    }
    ballPosEmpty.style.display = 'none';
    ballPosTable.style.display = '';

    const rows: string[] = [];
    for (const key of ballKeys) {
      const hostname = key.slice('pt-ball-pos:'.length);
      const pos = all[key] as { x: number; y: number } | undefined;
      const posText = pos
        ? `(${Math.round(pos.x)}, ${Math.round(pos.y)})`
        : tf('ballPosDefaultTag', '默认（右下角）');
      rows.push(`
        <tr data-key="${hostname}">
          <td>${hostname}</td>
          <td>${posText}</td>
          <td class="pt-ball-pos-cell-btn">
            <button class="pt-btn-icon pt-ball-pos-delete" data-key="${hostname}" data-i18n="btnDelete" title="${tf('btnDelete', '删除')}">✕</button>
          </td>
        </tr>
      `);
    }
    ballPosList.innerHTML = rows.join('');

    // 绑定删除事件
    ballPosList.querySelectorAll('.pt-ball-pos-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const hostname = (btn as HTMLElement).dataset.key!;
        const storageKey = `pt-ball-pos:${hostname}`;
        await chrome.storage.local.remove(storageKey).catch(() => {});
        await loadBallPosSites();
      });
    });
  }

  async function resetAllBallPos(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const ballKeys = Object.keys(all).filter((k) =>
      k.startsWith('pt-ball-pos:'),
    );
    if (ballKeys.length > 0) {
      await chrome.storage.local.remove(ballKeys).catch(() => {});
    }
    await loadBallPosSites();
    resetBallPosBtn.textContent = tf('toastBallPosReset', '已重置');
    setTimeout(() => {
      resetBallPosBtn.textContent = tf('btnResetBallPos', '重置悬浮球位置');
    }, 1500);
  }

  resetBallPosBtn.addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const ballKeys = Object.keys(all).filter((k) =>
      k.startsWith('pt-ball-pos:'),
    );
    if (ballKeys.length === 0) {
      resetBallPosBtn.textContent = tf('toastBallPosReset', '已重置');
      setTimeout(() => {
        resetBallPosBtn.textContent = tf('btnResetBallPos', '重置悬浮球位置');
      }, 1500);
      return;
    }
    await resetAllBallPos();
  });

  ballPosToggle.addEventListener('click', () => {
    const isOpen = ballPosPanel.style.display !== 'none';
    ballPosPanel.style.display = isOpen ? 'none' : '';
    if (!isOpen) loadBallPosSites();
  });

  // 点击面板外关闭
  document.addEventListener('click', (e) => {
    if (
      ballPosPanel.style.display !== 'none' &&
      !ballPosPanel.contains(e.target as Node) &&
      e.target !== ballPosToggle &&
      !ballPosToggle.contains(e.target as Node)
    ) {
      ballPosPanel.style.display = 'none';
    }
  });

  syncUI();
  onSettingsChanged(() => syncUI());
}
