// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 通用设置分区：开关、语言对、显示模式、悬浮 UI。

import {
  BALL_SIZE_MAX,
  BALL_SIZE_MIN,
  INPUT_DOT_SIZE_MAX,
  INPUT_DOT_SIZE_MIN,
  LANG_LIST,
  PARA_BTN_HIDE_DELAY_MAX,
  PARA_BTN_HIDE_DELAY_MIN,
  PARA_BTN_SIZE_MAX,
  PARA_BTN_SIZE_MIN,
} from '~/src/storage/schema';
import type { DisplayMode, Settings } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { tf } from '~/src/i18n';
import { createSliderRow } from '../slider-row';
import { createFloatingPreview } from '../floating-preview';

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
  const toggleInputTranslate = document.getElementById('pt-toggle-input-translate')!;

  function syncUI(): void {
    const s = getSettings();
    toggleEnabled.classList.toggle('pt-on', s.enabled);
    selectFrom.innerHTML = buildLangOptions(s.from, true);
    selectTo.innerHTML = buildLangOptions(s.to, false);
    selectMode.value = s.displayMode;
    selectParaMode.value = s.paraDisplayMode ?? 'follow';
    toggleFloatingBall.classList.toggle('pt-on', s.showFloatingBall);
    toggleParagraphBtn.classList.toggle('pt-on', s.showParagraphBtn);
    toggleInputTranslate.classList.toggle('pt-on', s.inputTranslate);
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

  toggleInputTranslate.addEventListener('click', () => {
    savePatch({ inputTranslate: !getSettings().inputTranslate });
  });

  // #968: 实时预览。拖动中、还没写盘的滑块值记在 draft 里，预览先按它画，
  // 不等写盘；尺寸换算只经 floatingUiVars（预览模块里），不在这里另算
  const preview = createFloatingPreview(document.getElementById('pt-floating-preview')!);
  const draft: Partial<Settings> = {};
  const updatePreview = () => preview.update({ ...getSettings(), ...draft });

  // #967: 悬浮 UI 尺寸滑块，跟在三个开关之后；三项共用 slider-row 工厂
  const sliderRows = document.getElementById('pt-floating-ui-sliders')!;
  const ballSize = createSliderRow({
    id: 'pt-slider-ball-size',
    labelKey: 'rowBallSize',
    labelFallback: '悬浮球大小',
    min: BALL_SIZE_MIN,
    max: BALL_SIZE_MAX,
    step: 2,
    unit: 'px',
    format: (v) => String(v),
    get: () => getSettings().floatingBallSize,
    set: (v) => savePatch({ floatingBallSize: v }),
    onInput: (v) => {
      draft.floatingBallSize = v;
      updatePreview();
    },
  });
  // #971: 逐段翻译按钮大小（按钮的最小边长，字号随它等比走）
  const paraBtnSize = createSliderRow({
    id: 'pt-slider-para-btn-size',
    labelKey: 'rowParaBtnSize',
    labelFallback: '逐段翻译按钮大小',
    min: PARA_BTN_SIZE_MIN,
    max: PARA_BTN_SIZE_MAX,
    step: 2,
    unit: 'px',
    format: (v) => String(v),
    get: () => getSettings().paraBtnSize,
    set: (v) => savePatch({ paraBtnSize: v }),
    onInput: (v) => {
      draft.paraBtnSize = v;
      updatePreview();
    },
  });
  // #973: 逐段翻译按钮显示时长 —— 鼠标离开段落之后停留多久，不是浮出前的等待
  // （那个 140ms 与输入翻译圆点同源，不做成设置）。存毫秒、读数按秒，不进预览
  const paraBtnHideDelay = createSliderRow({
    id: 'pt-slider-para-btn-hide-delay',
    labelKey: 'rowParaBtnHideDelay',
    labelFallback: '鼠标离开段落后按钮停留',
    min: PARA_BTN_HIDE_DELAY_MIN,
    max: PARA_BTN_HIDE_DELAY_MAX,
    step: 100,
    unit: tf('unitSeconds', '秒'),
    format: (v) => (v / 1000).toFixed(1),
    get: () => getSettings().paraBtnHideDelay,
    set: (v) => savePatch({ paraBtnHideDelay: v }),
  });
  // #987: 输入翻译圆点大小（可见直径；可点区随它等比放大、不低于 24px）
  const inputDotSize = createSliderRow({
    id: 'pt-slider-input-dot-size',
    labelKey: 'rowInputDotSize',
    labelFallback: '输入翻译圆点大小',
    min: INPUT_DOT_SIZE_MIN,
    max: INPUT_DOT_SIZE_MAX,
    step: 2,
    unit: 'px',
    format: (v) => String(v),
    get: () => getSettings().inputDotSize,
    set: (v) => savePatch({ inputDotSize: v }),
    onInput: (v) => {
      draft.inputDotSize = v;
      updatePreview();
    },
  });
  sliderRows.append(ballSize.row, paraBtnSize.row, paraBtnHideDelay.row, inputDotSize.row);

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
  updatePreview();
  onSettingsChanged(() => {
    syncUI();
    // 滑块按存储值重画了，拖动中的值就作废，预览改按存储值画（popup、另一个设置页改的）
    if (ballSize.sync()) delete draft.floatingBallSize;
    if (paraBtnSize.sync()) delete draft.paraBtnSize;
    paraBtnHideDelay.sync();
    if (inputDotSize.sync()) delete draft.inputDotSize;
    updatePreview();
  });
}
