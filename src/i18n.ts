// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 扩展自身 UI 的国际化入口。
//
// 只覆盖扩展 UI，与译文内容无关。文案统一走 chrome.i18n.getMessage，
// manifest 的 default_locale 决定回退语言。
//
// 静态文案在 HTML 里用 data-i18n 标注，由 applyI18n() 一次性替换；
// 动态生成的文案直接调 t()。两条路径共用同一份 messages.json，
// 不再有“HTML 里写死一份、TS 里再写死一份”的漂移风险。

/**
 * 取文案。取不到时返回 fallback（通常是 HTML 里已有的中文），
 * 保证漏配 key 时页面只是没被翻译，而不是显示空白。
 */
export function t(key: string, ...subs: string[]): string {
  try {
    const msg = chrome.i18n.getMessage(key, subs);
    if (msg) return msg;
  } catch {
    // 非扩展上下文（如单元测试）走 fallback
  }
  return '';
}

/** 取文案，取不到时用 fallback 顶上 */
export function tf(key: string, fallback: string, ...subs: string[]): string {
  return t(key, ...subs) || fallback;
}

/**
 * 把 DOM 中的 data-i18n / data-i18n-placeholder / data-i18n-title
 * 批量替换为当前语言的文案。取不到 key 时保留 HTML 里的原文。
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n!);
    if (msg) el.textContent = msg;
  });

  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '[data-i18n-placeholder]',
    )
    .forEach((el) => {
      const msg = t(el.dataset.i18nPlaceholder!);
      if (msg) el.placeholder = msg;
    });

  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const msg = t(el.dataset.i18nTitle!);
    if (msg) el.title = msg;
  });
}
