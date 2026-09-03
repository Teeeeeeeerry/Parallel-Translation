// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 4 — 用户自定义 CSS 校验、作用域限定、注入。
//
// 只收 CSS 声明块（属性: 值），不收选择器。
// 这换来三重安全：改不动宿主页面、改不动扩展自身 UI、
// 商店审核层面干净。

const STYLE_ID = 'pt-custom-style';

/** 禁止出现的构造 —— 一旦允许，用户就能改宿主页面和扩展自身 UI */
const FORBIDDEN = [
  { pattern: /[{}\\]/, msg: '只需填写 CSS 属性，无需选择器与花括号' },
  { pattern: /@import/i, msg: '不支持 @import' },
  { pattern: /<\/?style/i, msg: '不允许 style 标签' },
  { pattern: /url\s*\(/i, msg: '不允许使用 url()' },
  { pattern: /javascript:/i, msg: '不允许 javascript: 协议' },
  { pattern: /expression\s*\(/i, msg: '不允许 expression()' },
];

/**
 * 自定义 CSS 的唯一校验器 —— #168。
 * 表单校验、设置导入、运行时注入三处共用，行为不再分叉。
 */
export function validateCustomCss(
  input: string,
): { ok: true } | { ok: false; msg: string } {
  for (const { pattern, msg } of FORBIDDEN) {
    if (pattern.test(input)) return { ok: false, msg };
  }
  return { ok: true };
}

/**
 * 把用户输入的声明块包进 .pt-trans 作用域后注入。
 * 用户写 `color: #555`，实际注入 `.pt-trans { color: #555 }`。
 *
 * #168: 选择器用 `.pt-trans.pt-trans`（特异性 0,2,0，与预设
 * `.pt-style-border .pt-trans` 同级）—— 单类选择器（0,1,0）会被预设
 * 压住，opacity 等预设属性永远无法被自定义覆盖。同级特异性下
 * 后注入者胜：扩展的预设样式随文档注入，本 style 在设置加载/变更时
 * 追加到 head 末尾，时序上晚于预设，自定义总能覆盖预设。
 */
export function applyCustomCss(input: string): void {
  const css = input.trim();
  // #168: 先校验后删除 —— 校验失败时保留旧样式，避免「用户以为生效，
  // 实际旧样式也被清掉」的无声失败
  if (css && !validateCustomCss(css).ok) return;

  document.getElementById(STYLE_ID)?.remove();
  if (!css) return;

  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-pt-ui', '1'); // 防止被 walker 采集
  el.textContent = '.pt-trans.pt-trans { ' + css + ' }';
  document.head.appendChild(el);
}
