// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译的圆点（#633）—— 输入翻译的唯一入口。
//
// 焦点落进输入框、且框里有文字时浮出，失焦即消失。单个圆点实例复用，
// 随焦点在输入框之间移动。与悬浮球、逐段按钮不同，它在每个 frame 注入：
// iframe 里的评论框、客服窗口是这个功能的主场之一。
//
// #636：只认多行文本框；位置只用 ADR-0006 定的回落位置（框内侧右下角），
// 贴文字末尾是后面的票。
// #639：点圆点把当前输入框交给翻译回调；写不写回由回调决定。

import { mountIsolated, unmountIsolated } from './mount';
import { tf } from '../i18n';

const HOST_ID = 'input-dot';

/** 框里至少有这么多字符才浮出 —— 空的搜索框上不该无故冒出一个点。 */
const MIN_CHARS = 2;

/** 圆点直径，与 injected.css 的 .pt-input-dot 一致。 */
const SIZE = 14;
/** 回落位置离框内侧边缘的距离。 */
const INSET = 6;

/** 沿 shadow root 往下找真正持有焦点的元素。 */
export function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function eligible(el: Element | null): el is HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement;
}

function hasEnoughText(el: HTMLTextAreaElement): boolean {
  return el.value.trim().length >= MIN_CHARS;
}

/**
 * 回落位置：框内侧右下角（ADR-0006）。
 * 内侧右边缘优先用 clientWidth（不含滚动条），量不到时退回边框盒减边框。
 */
function placeFallback(dot: HTMLElement, el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const borderR = parseFloat(cs.borderRightWidth) || 0;
  const borderB = parseFloat(cs.borderBottomWidth) || 0;
  const innerRight =
    el.clientWidth > 0 ? r.left + el.clientLeft + el.clientWidth : r.right - borderR;
  const innerBottom =
    el.clientHeight > 0 ? r.top + el.clientTop + el.clientHeight : r.bottom - borderB;
  dot.style.left = `${innerRight - INSET - SIZE}px`;
  dot.style.top = `${innerBottom - INSET - SIZE}px`;
}

/** 圆点的回调：点击时拿到当前输入框。 */
interface InputDotHandlers {
  translate: (el: HTMLTextAreaElement) => Promise<void>;
}

export function createInputDot(handlers: InputDotHandlers): () => void {
  const shadow = mountIsolated(HOST_ID);
  const dot = document.createElement('button');
  dot.className = 'pt-input-dot';
  dot.type = 'button';
  dot.setAttribute('aria-label', tf('inputDotLabel', '翻译输入框里的文字'));
  shadow.appendChild(dot);

  let target: HTMLTextAreaElement | null = null;

  const hide = (): void => {
    dot.style.display = 'none';
    target = null;
  };

  const sync = (el: Element | null): void => {
    if (!eligible(el) || !hasEnoughText(el)) {
      hide();
      return;
    }
    target = el;
    dot.style.display = 'block';
    placeFallback(dot, el);
  };

  // focusin 的 target 在跨 shadow 边界时被重定向到宿主，取路径首项才是输入框
  const onFocusIn = (e: FocusEvent): void => {
    sync((e.composedPath()[0] as Element | undefined) ?? null);
  };
  const onFocusOut = (): void => hide();
  const onInput = (e: Event): void => {
    const el = (e.composedPath()[0] as Element | undefined) ?? null;
    if (el === deepActiveElement()) sync(el);
  };
  // 圆点是 fixed 定位，页面或框内滚动时重新贴合
  const onReflow = (): void => {
    if (target) placeFallback(dot, target);
  };

  // 按下时阻止默认行为：不夺走输入框的焦点，光标与选区都还在
  dot.addEventListener('mousedown', (e) => e.preventDefault());

  dot.addEventListener('click', () => {
    if (!target) return;
    handlers.translate(target).catch((e) => console.error('[PT] 输入翻译失败:', e));
  });

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('input', onInput, true);
  window.addEventListener('scroll', onReflow, { passive: true, capture: true });
  window.addEventListener('resize', onReflow, { passive: true });

  // 打开开关时焦点可能已经在框里 —— 即刻生效，不必重新聚焦
  sync(deepActiveElement());

  return () => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    unmountIsolated(HOST_ID);
  };
}
