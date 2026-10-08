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
import { tf } from '../i18n';

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

/** 摘掉页面上现有的提示与它的计时，返回可以往里放新提示的 shadow root。 */
function resetToast(): ShadowRoot {
  // 复用已有 shadow root
  if (!toastShadow) {
    toastShadow = mountIsolated('toast');
  }

  // 移除旧 toast
  toastShadow.querySelector('.pt-toast')?.remove();
  clearTimeout(toastTimer);
  return toastShadow;
}

/**
 * 显示一条提示；新的一条直接替换旧的。
 *
 * #747：译文（内容类）到达时页面上若是等待态，就地把它变成译文 —— 同一条
 * 提示换掉内容、摘掉转圈，不先摘掉再弹一条新的。失败到达时的就地替换另由
 * #748 做，这里仍是摘掉再弹，等待态同样不会留下。
 */
export function toast(msg: string, { purpose, kind = 'info' }: ToastOptions): void {
  const pending =
    purpose === 'content'
      ? toastShadow?.querySelector<HTMLElement>('.pt-toast[data-state="pending"]')
      : null;
  let el: HTMLElement;
  if (pending) {
    clearTimeout(toastTimer);
    el = pending;
    delete el.dataset.state;
  } else {
    const root = resetToast();
    el = document.createElement('div');
    el.className = 'pt-toast';
    root.appendChild(el);
  }

  el.dataset.kind = kind;
  el.dataset.purpose = purpose;
  el.textContent = msg;
  const duration = purpose === 'content' ? contentDuration(msg) : TOAST_DURATION;
  const startTimer = () => {
    toastTimer = self.setTimeout(() => {
      el.remove();
    }, duration);
  };

  if (purpose === 'content') {
    el.append(closeButton(el));
    // #740：鼠标悬停在内容类提示上时不计时 —— 想读完、想把译文选中复制走，
    // 把鼠标放上去就行。状态类不挂这条
    el.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    // #741：移开后重新开始完整计时，不接着剩余时间 —— 否则快到点时才悬停，
    // 一移开就立刻消失，等于没停过。再移回去照样停住
    el.addEventListener('mouseleave', () => {
      // 已被关掉或替换的那一条不再起计时，免得占住下一条的计时
      if (!el.isConnected) return;
      clearTimeout(toastTimer);
      startTimer();
    });
    // 鼠标本来就停在等待态上、译文就地到达：不会再有 mouseenter，直接不开始
    // 计时，等移开再算
    if (isHovered(el)) return;
  }

  startTimer();
}

function isHovered(el: Element): boolean {
  try {
    return el.matches(':hover');
  } catch {
    return false;
  }
}

/**
 * 内容类的关闭按钮（#742）：读完了立刻关掉，不必等它自己走。点了摘掉这条
 * 提示并清掉计时。用真正的 button 元素，键盘可用留给 #743；叉号由样式画，
 * 不往提示里加字，选中复制译文时不会带上它。
 */
function closeButton(el: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pt-toast-close';
  btn.setAttribute('aria-label', tf('toastClose', '关闭'));
  btn.addEventListener('click', () => {
    // 同一时刻只有一条提示，现有的计时就是这一条的
    clearTimeout(toastTimer);
    el.remove();
  });
  return btn;
}

/** 等待态的句柄：发起方收尾时调用 dismiss。 */
export interface PendingToast {
  /** 这条等待态若仍在页面上（没被结果、失败或另一次发起替换）就收掉。 */
  dismiss(): void;
}

/**
 * 等待态（#746）：发起翻译时立即显示，带转圈，自己不会超时消失 —— 慢的
 * 引擎不该让用户以为失败了。下一条提示（译文或失败）到来时替换它；没有
 * 任何提示要接替它的退出路径（准入拦截不提示、出错），由发起方 dismiss。
 * 转圈复用悬浮球与输入翻译圆点的 pt-spin 动画。
 */
export function toastPending(msg: string): PendingToast {
  const root = resetToast();

  const el = document.createElement('div');
  el.className = 'pt-toast';
  el.dataset.kind = 'info';
  el.dataset.state = 'pending';
  const spinner = document.createElement('span');
  spinner.className = 'pt-toast-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  el.append(spinner, msg);
  root.appendChild(el);

  return {
    dismiss() {
      // 已就地变成译文的不算等待态（#747）
      if (el.isConnected && el.dataset.state === 'pending') el.remove();
    },
  };
}
