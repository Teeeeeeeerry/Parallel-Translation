// Phase 7 — 外观分区：样式预设选择 + 实时预览 + 自定义 CSS。

import type { StyleId } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

const STYLE_LABELS: Record<StyleId, string> = {
  default: '默认',
  dim: '弱化',
  underline: '实线下划线',
  bold: '加粗',
  italic: '斜体',
  fade: '半透明',
};

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

/**
 * 校验 CSS 声明块的语法安全性。
 * 不允许选择器、不允许 url()（防隐私泄漏）。
 */
function validateCss(css: string): string | null {
  if (!css.trim()) return null;
  if (/[{}\\]/.test(css)) return '只需填写 CSS 属性，无需选择器与花括号';
  if (/url\s*\(/i.test(css)) return '不允许使用 url()';
  return null;
}

export function initAppearance(): void {
  const selectStyle = document.getElementById('pt-select-style') as HTMLSelectElement;
  const cssTextarea = document.getElementById('pt-custom-css') as HTMLTextAreaElement;
  const cssErrorEl = document.getElementById('pt-css-error')!;
  const previewTrans = document.querySelector('.pt-style-preview-trans') as HTMLElement;

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
      const err = validateCss(css);
      if (err) {
        cssTextarea.classList.add('pt-error');
        cssErrorEl.classList.add('pt-visible');
        cssErrorEl.textContent = err;
      } else {
        cssTextarea.classList.remove('pt-error');
        cssErrorEl.classList.remove('pt-visible');
        savePatch({ customCss: css });
      }
    }, 400);
  });

  // ---- Live preview ----

  function updatePreview(): void {
    const s = getSettings();
    if (!previewTrans) return;

    // Remove all style classes
    const styleClasses = Object.keys(STYLE_LABELS);
    previewTrans.classList.remove(...styleClasses);

    // Apply current style preset
    previewTrans.className = `pt-trans pt-style-preview-trans pt-style-${s.style}`;
  }

  syncUI();
  updatePreview();

  onSettingsChanged(() => {
    syncUI();
    updatePreview();
  });
}
