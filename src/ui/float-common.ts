// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 悬浮控件共用的口径（#1080）：逐段翻译按钮、输入翻译圆点、输入翻译入口各自
// 从这里引用，彼此不再互相依赖 —— 输入翻译的业务入口不依赖圆点这个 UI 部件，
// 圆点也不依赖逐段翻译按钮。

/**
 * 悬停意图延迟：指针在同一段落上停住这么久才浮出按钮。
 *
 * 没有这道闸门时，mouseover 一命中段落就立刻浮出并重定位 —— 鼠标从文章
 * 上方扫到下方，按钮会挨个段落跳几十次，看起来就是不停闪。隐藏延迟
 * 越长这个现象越显眼，因为按钮全程挂着而不是跳完就消失。
 *
 * 140ms 略低于人眼把“停顿”与“路过”区分开的阈值，有意停留时几乎无感，
 * 单纯划过则完全不触发。输入翻译圆点停手后对齐沿用同一个口径（#670）。
 */
export const SHOW_DELAY = 140;

/** 逐段翻译按钮与段落边缘的间隙；输入翻译圆点与光标之间沿用同一个口径（#667）。 */
export const GAP = 4;

/** 沿 shadow root 往下找真正持有焦点的元素。 */
export function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
