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
// #647：翻译进行中再点不发第二次请求 —— 一次点击只花一份配额。
// #648：进行中的状态长在圆点上 —— 变灰转圈，结束回到常态。
// #650：能不能参与交给「这个输入框能不能参与」的判定，放行普通文本框与
// 搜索框；圆点位置仍是回落位置。
// #655：contenteditable 的编辑宿主同样浮出，位置同样是回落位置。
// #656：受控编辑器拦下 beforeinput 自己改 DOM，没有 input 事件 —— 焦点所在的
// 编辑宿主改由 DOM 变动驱动同步。
// #665：多行文本框里圆点贴文字末尾（ADR-0006），位置由镜像测量给出；量不
// 出来时回落框内侧右下角。单行文本框与 contenteditable 仍是回落位置。
// #670：镜像测量会强制同步布局，不能挂在每次按键上。连续打字期间不重算
// 位置，停手 SHOW_DELAY（与逐段按钮悬停意图同一个口径）后对齐一次 —— 打字
// 时圆点在哪儿没人看，打字卡顿却是立刻能感觉到的（ADR-0006）。

import { mountIsolated, unmountIsolated } from './mount';
import { measureTextareaEnd } from './input-measure';
import { SHOW_DELAY } from './paragraph-btn';
import { tf } from '../i18n';
import { decideInputEligibility, inputText, type TextInput } from './input-eligibility';

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

function eligible(el: Element | null): el is TextInput {
  return decideInputEligibility(el).eligible;
}

function hasEnoughText(el: TextInput): boolean {
  return inputText(el).trim().length >= MIN_CHARS;
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

/**
 * 圆点位置（ADR-0006）：多行文本框贴文字末尾（#665），圆点左边缘贴末尾，
 * 竖直居中于末尾那一行；量不出来、或是其余输入框时回落框内侧右下角 ——
 * 圆点是唯一入口，量不出来只换位置，绝不不显示。
 */
function place(dot: HTMLElement, el: HTMLElement, shadow: ShadowRoot): void {
  const end = el instanceof HTMLTextAreaElement ? measureTextareaEnd(el, shadow) : null;
  if (!end) {
    placeFallback(dot, el);
    return;
  }
  dot.style.left = `${end.x}px`;
  dot.style.top = `${end.y + end.height / 2 - SIZE / 2}px`;
}

/** 圆点的回调：点击时拿到当前输入框。 */
interface InputDotHandlers {
  translate: (el: TextInput) => Promise<void>;
}

export function createInputDot(handlers: InputDotHandlers): () => void {
  const shadow = mountIsolated(HOST_ID);
  const dot = document.createElement('button');
  dot.className = 'pt-input-dot';
  dot.type = 'button';
  dot.setAttribute('aria-label', tf('inputDotLabel', '翻译输入框里的文字'));
  shadow.appendChild(dot);

  let target: TextInput | null = null;
  /**
   * 翻译还没回来的输入框（#647）。进行中再点直接忽略：不发请求，也不往
   * 框里写任何占位或提示文字 —— 占位文字一旦被用户发送出去，扩展的状态
   * 就成了对外内容。回调结束（完成、失败、放弃写回）后移出，恢复可点。
   * 按输入框记，一个框在翻译中不妨碍另一个框。
   */
  const inFlight = new WeakSet<TextInput>();

  /**
   * 圆点的进行中状态（#648）直接读在飞标记，不另存一份。
   *
   * 只同步改属性，转圈交给 CSS 动画：标签页在后台时不依赖动画帧回调 ——
   * 回调不执行时状态会卡住（与逐段按钮刻意不用 rAF 同一个理由）。
   */
  const syncState = (): void => {
    if (target && inFlight.has(target)) {
      dot.dataset.state = 'busy';
      dot.setAttribute('aria-busy', 'true');
    } else {
      delete dot.dataset.state;
      dot.removeAttribute('aria-busy');
    }
  };

  /** 停手后对齐的计时器（#670）；有值表示还在等停手。 */
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelAlign = (): void => {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  };
  const alignAfterTyping = (): void => {
    cancelAlign();
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (target) place(dot, target, shadow);
    }, SHOW_DELAY);
  };

  const hide = (): void => {
    cancelAlign();
    dot.style.display = 'none';
    target = null;
    syncState();
  };

  /**
   * 按焦点所在的输入框显示或隐藏圆点。
   * typing 为 true 时是打字引起的（#670）：不做测量，停手后再对齐；圆点在
   * 这次刚浮出时先放在回落位置，不至于没有位置。
   */
  const sync = (el: Element | null, typing = false): void => {
    if (!eligible(el) || !hasEnoughText(el)) {
      hide();
      return;
    }
    const wasShown = target === el && dot.style.display === 'block';
    target = el;
    syncState();
    dot.style.display = 'block';
    if (!typing) {
      cancelAlign();
      place(dot, el, shadow);
      return;
    }
    if (!wasShown) placeFallback(dot, el);
    alignAfterTyping();
  };

  /**
   * 焦点所在的编辑宿主里的 DOM 变动（#656）。Slate、Lexical 一类受控编辑器
   * 拦下 beforeinput、改自己的模型再重新渲染，浏览器不再派发 input 事件；
   * 只听 input，打字时圆点就不会跟着出现。
   */
  const observer = new MutationObserver(() => {
    const el = deepActiveElement();
    if (el === observed) sync(el, true);
  });
  let observed: Element | null = null;
  const observe = (el: Element | null): void => {
    observer.disconnect();
    observed = null;
    const d = decideInputEligibility(el);
    if (el && d.eligible && d.kind === 'contenteditable') {
      observer.observe(el, { childList: true, characterData: true, subtree: true });
      observed = el;
    }
  };

  // focusin 的 target 在跨 shadow 边界时被重定向到宿主，取路径首项才是输入框
  const onFocusIn = (e: FocusEvent): void => {
    const el = (e.composedPath()[0] as Element | undefined) ?? null;
    observe(el);
    sync(el);
  };
  const onFocusOut = (): void => {
    observe(null);
    hide();
  };
  const onInput = (e: Event): void => {
    const el = (e.composedPath()[0] as Element | undefined) ?? null;
    if (el === deepActiveElement()) sync(el, true);
  };
  // 圆点是 fixed 定位，页面或框内滚动时重新贴合
  // 还在等停手时不量：打字引起的框内滚动交给停手后的那次对齐
  const onReflow = (): void => {
    if (target && settleTimer === undefined) place(dot, target, shadow);
  };

  // 按下时阻止默认行为：不夺走输入框的焦点，光标与选区都还在
  dot.addEventListener('mousedown', (e) => e.preventDefault());

  dot.addEventListener('click', () => {
    const el = target;
    if (!el || inFlight.has(el)) return;
    inFlight.add(el);
    syncState();
    handlers
      .translate(el)
      .catch((e) => console.error('[PT] 输入翻译失败:', e))
      .finally(() => {
        inFlight.delete(el);
        syncState();
      });
  });

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('input', onInput, true);
  window.addEventListener('scroll', onReflow, { passive: true, capture: true });
  window.addEventListener('resize', onReflow, { passive: true });

  // 打开开关时焦点可能已经在框里 —— 即刻生效，不必重新聚焦
  observe(deepActiveElement());
  sync(deepActiveElement());

  return () => {
    cancelAlign();
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    observer.disconnect();
    unmountIsolated(HOST_ID);
  };
}
