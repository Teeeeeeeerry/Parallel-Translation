// Phase 7 — 外观分区：样式预设选择 + 实时预览 + 自定义 CSS。

import type { StyleId } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { tf } from '~/src/i18n';
import { validateCustomCss } from '~/src/styles/custom';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

export function initAppearance(): void {
  const selectStyle = document.getElementById('pt-select-style') as HTMLSelectElement;
  const cssTextarea = document.getElementById('pt-custom-css') as HTMLTextAreaElement;
  const cssErrorEl = document.getElementById('pt-css-error')!;
  const previewRoot = document.getElementById('pt-style-preview');

  function syncUI(): void {
    const s = getSettings();
    selectStyle.value = s.style;
    cssTextarea.value = s.customCss;
  }

  // ---- Style preset change ----

  selectStyle.addEventListener('change', () => {
    const style = selectStyle.value as StyleId;
    savePatch({ style });
  });

  // ---- Custom CSS with validation ----

  let cssTimer: ReturnType<typeof setTimeout>;
  cssTextarea.addEventListener('input', () => {
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => {
      const css = cssTextarea.value;
      // #168: 与运行时/导入共用同一校验器，行为不再分叉
      const result = validateCustomCss(css);
      if (!result.ok) {
        cssTextarea.classList.add('pt-error');
        cssErrorEl.classList.add('pt-visible');
        cssErrorEl.textContent = result.msg;
      } else {
        cssTextarea.classList.remove('pt-error');
        cssErrorEl.classList.remove('pt-visible');
        savePatch({ customCss: css });
      }
    }, 400);
  });

  // ---- Live preview ----

  /**
   * presets.css 用的是祖先-后代选择器（`.pt-style-border .pt-trans`），
   * 所以 pt-style-* 必须加在预览**容器**上而不是 .pt-trans 自身 ——
   * 元素不是自己的祖先，加在自己身上永远匹配不上。
   * 这与 renderer.ts 把类名加在文档根上是同一套规则。
   */
  function updatePreview(): void {
    if (!previewRoot) return;
    const s = getSettings();

    // 先快照再删 —— classList 是实时集合，边遍历边删会漏项
    Array.from(previewRoot.classList)
      .filter((c) => c.startsWith('pt-style-') && c !== 'pt-style-preview')
      .forEach((c) => previewRoot.classList.remove(c));
    previewRoot.classList.add(`pt-style-${s.style}`);
  }

  syncUI();
  updatePreview();

  onSettingsChanged(() => {
    syncUI();
    updatePreview();
  });
}
