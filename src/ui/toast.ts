// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 5 — 状态与错误提示 toast。
// 短暂提示，通过注入 shadow root 隔离，不受宿主页面样式影响。
//
// #738：同一个组件承载两类用途，调用方显式表明是哪一类，组件不猜文本内容
// （长度超过多少就算内容的启发式会把一条长错误消息也当成内容）：
// - 状态类：失败、配额、站点禁用、无法单独翻译等，固定短时长
// - 内容类：用户要读完的文字（划词译文）。行为暂与状态类相同，停留时长
//   等差异由 #726 的后续票逐条加上

import { mountIsolated } from './mount';

const TOAST_DURATION = 3000;

/** 提示的用途：状态类是短暂的状态与错误，内容类是用户要读完的文字。 */
export type ToastPurpose = 'status' | 'content';

export interface ToastOptions {
  purpose: ToastPurpose;
  /** 'error' 用 --pt-danger，其余用 --pt-forest。缺省 'info'。 */
  kind?: 'info' | 'error';
}

let toastTimer: number | undefined;
let toastShadow: ShadowRoot | null = null;

/** 显示一条提示；新的一条直接替换旧的。 */
export function toast(msg: string, { purpose, kind = 'info' }: ToastOptions): void {
  // 复用已有 shadow root
  if (!toastShadow) {
    toastShadow = mountIsolated('toast');
  }

  // 移除旧 toast
  toastShadow.querySelector('.pt-toast')?.remove();
  clearTimeout(toastTimer);

  const el = document.createElement('div');
  el.className = 'pt-toast';
  el.dataset.kind = kind;
  el.dataset.purpose = purpose;
  el.textContent = msg;
  toastShadow.appendChild(el);

  toastTimer = self.setTimeout(() => {
    el.remove();
  }, TOAST_DURATION);
}
