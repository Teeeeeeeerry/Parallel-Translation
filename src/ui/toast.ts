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
// - 内容类：用户要读完的文字（划词译文），停留时长按长度算（#739）

import { mountIsolated } from './mount';

/** 状态类的停留时长：固定，不看文字长短。 */
const TOAST_DURATION = 3000;

/**
 * 内容类的停留时长（#739）：按字数换算，有下限有上限。规则只在这里，调用方
 * 不传时长。
 *
 * 换算按舒适阅读速度，比专注阅读放慢一些 —— 提示在屏幕角落，用户先要把视线
 * 挪过去，读的又是刚划下的那段话的另一种语言：
 * - 中日韩文字每秒 5 个（每分钟 300 字）。#726 的实测诉求是四五十个字要八到
 *   十秒，正是这个速度
 * - 其余文字每秒 15 个字符（英文约每分钟 150 词，按每词连空格约 6 个字符
 *   算）。英文非小说类默读的平均速度约每分钟 238 词（Brysbaert 2019），这里
 *   取它的六成多
 * - 另加 1.5 秒，留给视线挪到提示上
 * 下限 5 秒：短到一两个词的译文也不一闪而过，并且比状态类久。上限 60 秒：
 * 三四百字的整段译文读得完，再长也不会赖在屏幕上。只计非空白字符。
 */
const CONTENT_MIN = 5000;
const CONTENT_MAX = 60_000;
const CONTENT_LEAD = 1500;
const CJK_PER_SEC = 5;
const OTHER_PER_SEC = 15;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

function contentDuration(msg: string): number {
  const visible = msg.replace(/\s+/g, '');
  const cjk = visible.match(CJK)?.length ?? 0;
  const other = visible.length - cjk;
  const ms = CONTENT_LEAD + (cjk / CJK_PER_SEC + other / OTHER_PER_SEC) * 1000;
  return Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, Math.round(ms)));
}

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
  }, purpose === 'content' ? contentDuration(msg) : TOAST_DURATION);
}
