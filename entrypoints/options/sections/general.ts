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

  syncUI();
  onSettingsChanged(() => syncUI());
}
