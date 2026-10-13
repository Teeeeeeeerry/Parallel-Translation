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
  /**
   * 状态类的这一条也就地替换等待态：划词命中兜底时的说明（#787）、划词的
   * 失败与站点禁用（#748）。内容类总是就地替换（#747）。不传的状态类提示
   * 仍是摘掉旧的再弹一条，行为与改动前一致。
   */
  replacePending?: boolean;
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
 * 提示换掉内容、摘掉转圈，不先摘掉再弹一条新的。
 *
 * #787、#748：划词命中兜底时的说明、划词的失败与站点禁用是状态类，显式要求
 * 就地替换（replacePending），与译文走同一条路径；替换之后按状态类计时。
 */
export function toast(
  msg: string,
  { purpose, kind = 'info', replacePending = false }: ToastOptions,
): void {
  const pending =
    purpose === 'content' || replacePending
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
  const duration = purpose === 'content' ? contentDuration(msg) : TOAST_DURATION;
  const startTimer = () => {
    toastTimer = self.setTimeout(() => {
      el.remove();
    }, duration);
  };

  if (purpose !== 'content') {
    el.textContent = msg;
    startTimer();
    return;
  }

  // #745：译文放在内层里，超过高度上限时在内层纵向滚动；关闭按钮留在外层，
  // 不随译文滚走
  const body = document.createElement('div');
  body.className = 'pt-toast-body';
  body.textContent = msg;
  el.replaceChildren(body, closeButton(el));

  // 鼠标本来就停在等待态上、译文就地到达：不会再有 mouseenter，直接不开始
  // 计时，等移开再算
  let hovered = isHovered(el);
  // #740：鼠标悬停在内容类提示上时不计时 —— 想读完、想把译文选中复制走，
  // 把鼠标放上去就行。状态类不挂这条
  el.addEventListener('mouseenter', () => {
    hovered = true;
    clearTimeout(toastTimer);
  });
  // #741：移开后重新开始完整计时，不接着剩余时间 —— 否则快到点时才悬停，
  // 一移开就立刻消失，等于没停过。再移回去照样停住
  el.addEventListener('mouseleave', () => {
    hovered = false;
    // 已被关掉或替换的那一条不再起计时，免得占住下一条的计时
    if (!el.isConnected) return;
    clearTimeout(toastTimer);
    startTimer();
  });
  // #745：滚动期间不消失。鼠标在提示上时已经不计时；触控板惯性滚动、键盘
  // 滚动时鼠标可能不在提示上，每滚一下重新完整计时
  body.addEventListener('scroll', () => {
    if (hovered || !el.isConnected) return;
    clearTimeout(toastTimer);
    startTimer();
  });
  if (!hovered) startTimer();
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

/**
 * 等待态的最短显示时间（#749）：引擎在此之前返回，发起方等满再替换，免得
 * “翻译中”闪一下、界面发抖。
 *
 * 取 500 毫秒，依据是人眼看清一次状态变化要多久：注意力被屏幕角落新出现的
 * 东西吸引过去约 200 毫秒（外源性注意的捕获时间），视线落定、认出“翻译中”
 * 这两三个字再要一次注视，约 250 毫秒（阅读时单次注视的典型时长）。合起来
 * 约 450 毫秒，取整到 500。短于它，用户只看到“有东西闪了一下”，不知道是
 * 什么；比它长就是在白白拖慢快引擎 —— 等待态在点下去时立即出现（#746），
 * 这里只管它最少待多久，不推迟它出现。
 */
const PENDING_MIN_SHOWN = 500;

/** 等待态的句柄：发起方收尾时调用 dismiss。 */
export interface PendingToast {
  /** 这条等待态若仍在页面上（没被结果、失败或另一次发起替换）就收掉。 */
  dismiss(): void;
  /**
   * 等待态显示满最短时间（#749）时兑现；已经满了就立即兑现。发起方拿到
   * 结果后先等它，再替换。
   */
  shownLongEnough(): Promise<void>;
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
  const shownAt = Date.now();

  return {
    shownLongEnough() {
      const left = PENDING_MIN_SHOWN - (Date.now() - shownAt);
      return left > 0 ? new Promise((resolve) => self.setTimeout(resolve, left)) : Promise.resolve();
    },
    dismiss() {
      // 已就地变成译文的不算等待态（#747）
      if (el.isConnected && el.dataset.state === 'pending') el.remove();
    },
  };
}
