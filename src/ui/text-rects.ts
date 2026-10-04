// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 量元素内文字的实际行盒 —— 逐段翻译按钮与输入翻译的圆点共用（#634）。
//
// 只负责测量，不含任何按钮或圆点的定位逻辑：取哪一行、贴哪一侧、
// 放不下时退到哪里，由各自的调用方决定。

/**
 * 取元素内文字的实际行盒矩形列表（`Range.getClientRects()`）。
 * 空列表意味着元素内容全是浮动/绝对定位子元素等没有行盒的情况。
 */
export function textRects(el: Element): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()];
}
