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
// #669：文字末尾滚出框的可见区域时，圆点钳到可见边缘，不隐藏、不换样式。
// #667：文字末尾也是光标所在。圆点与光标并排，中间留与逐段按钮同一个口径
// 的间隙；右侧放不下时换到末尾那一行的上下，不压住光标（ADR-0006）。
// #666：单行文本框同样贴文字末尾。文字一长就横向滚动，末尾随滚动变：滚动
// 重算沿用已有的时机（打字中等停手），钳制沿用 #669 那一套；RTL 下末尾在
// 左侧，圆点放到文字左边。
// #668：量不准的情形都换位置、不隐藏（ADR-0006）。祖先带 transform 缩放时
// 测量交给回落，回落与钳制用的可见区域按缩放换算；停手之后网页字体才加载
// 完、站点改了框的样式或尺寸，都重新对齐一次。
// #671：contenteditable 同样贴文字末尾，用与逐段按钮共用的行盒测量（#634），
// 不另养镜像；钳边、停手对齐、测不出回落三条规则与文本框同一套。

import { mountIsolated, unmountIsolated } from './mount';
import { measureEditableEnd, measureFieldEnd, type TextEnd } from './input-measure';
import { GAP, SHOW_DELAY } from './paragraph-btn';
import { tf } from '../i18n';
import { decideInputEligibility, inputText, type TextInput } from './input-eligibility';

const HOST_ID = 'input-dot';

/** 框里至少有这么多字符才浮出 —— 空的搜索框上不该无故冒出一个点。 */
const MIN_CHARS = 2;

/** 圆点直径，与 injected.css 的 .pt-input-dot 一致。 */
const SIZE = 14;
/**
 * 可点区边长（#638），与 injected.css 的 .pt-input-dot::before 一致：不小于逐段
 * 翻译按钮的 24px 下限。可见圆点仍是 SIZE —— 直接撑大会挡住文字（ADR-0006）。
 */
const HIT = 24;
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

/** 框的可见区域（视口坐标）：边框以内、滚动条以外。 */
interface InnerBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 框的可见区域。内侧边缘优先用 clientWidth / clientHeight（不含滚动条），
 * 量不到时退回边框盒减边框。
 *
 * client* 是没缩放的排版尺寸，getBoundingClientRect 是屏幕上的尺寸：祖先带
 * transform 缩放时（#668）按两者之比换算，否则回落位置会落到框外。
 */
function innerBox(el: HTMLElement): InnerBox {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const sx = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
  const sy = el.offsetHeight > 0 ? r.height / el.offsetHeight : 1;
  const borderR = (parseFloat(cs.borderRightWidth) || 0) * sx;
  const borderB = (parseFloat(cs.borderBottomWidth) || 0) * sy;
  return {
    left: r.left + el.clientLeft * sx,
    top: r.top + el.clientTop * sy,
    right: el.clientWidth > 0 ? r.left + (el.clientLeft + el.clientWidth) * sx : r.right - borderR,
    bottom:
      el.clientHeight > 0 ? r.top + (el.clientTop + el.clientHeight) * sy : r.bottom - borderB,
  };
}

/** 文字末尾在圆点的哪一侧（#638）：扩出的那一圈不往这一侧伸。 */
type EndSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * 可点区在一条轴上相对可见圆点的偏移（#638）：可点区是 HIT 见方、把圆点
 * 包在里面的透明一圈，偏移取 [SIZE - HIT, 0]。guardMin / guardMax 是文字
 * 末尾给出的硬边界；框的可见区域是软边界，框装得下这一圈时才收进去；
 * 其余情况居中。
 */
function hitAxis(dot: number, boxLo: number, boxHi: number, guardMin: number, guardMax: number): number {
  let min = Math.max(SIZE - HIT, guardMin);
  let max = Math.min(0, guardMax);
  const inMin = Math.max(min, boxLo - dot);
  const inMax = Math.min(max, boxHi - HIT - dot);
  if (inMin <= inMax) {
    min = inMin;
    max = inMax;
  }
  return Math.min(max, Math.max(min, (SIZE - HIT) / 2));
}

/**
 * 摆放可点区（#638）。圆点贴在文字末尾旁边，扩出的那一圈要是对称地往外长，
 * 就会盖住末尾字符与光标，用户想点回文字里接着写时点中的是圆点。所以：
 * 1. 不往文字末尾那一侧伸，与末尾至少隔开 1px —— 末尾字符与光标仍是输入框的；
 * 2. 尽量不出框的可见区域 —— 滚动条、边框、拖拽手柄仍是输入框的；
 * 3. 其余情况居中。
 * 量不出末尾（回落位置）时没有第 1 条。
 */
function placeHit(
  dot: HTMLElement,
  left: number,
  top: number,
  box: InnerBox,
  end?: { side: EndSide; at: TextEnd },
): void {
  const spare = SIZE - HIT;
  let xMin = spare, xMax = 0, yMin = spare, yMax = 0;
  if (end?.side === 'left') xMin = Math.min(0, end.at.x + 1 - left);
  if (end?.side === 'right') xMax = Math.max(spare, end.at.x - 1 - HIT - left);
  if (end?.side === 'top') yMin = Math.min(0, end.at.y + end.at.height + 1 - top);
  if (end?.side === 'bottom') yMax = Math.max(spare, end.at.y - 1 - HIT - top);
  dot.style.setProperty('--pt-hit-x', `${hitAxis(left, box.left, box.right, xMin, xMax)}px`);
  dot.style.setProperty('--pt-hit-y', `${hitAxis(top, box.top, box.bottom, yMin, yMax)}px`);
}

/** 回落位置：框内侧右下角（ADR-0006）。 */
function placeFallback(dot: HTMLElement, el: HTMLElement): void {
  const box = innerBox(el);
  const left = box.right - INSET - SIZE;
  const top = box.bottom - INSET - SIZE;
  dot.style.left = `${left}px`;
  dot.style.top = `${top}px`;
  placeHit(dot, left, top, box);
}

/**
 * 把圆点钳在框的可见区域里（#669，ADR-0006）：文字末尾滚出可见区域时，
 * 圆点停在离它最近的可见边缘，不隐藏、也不换样式 —— 长文本恰恰是最想
 * 翻译的那种，圆点消失会被当成功能坏了。框比圆点还小时贴左上。
 */
function clampToBox(left: number, top: number, box: InnerBox): { left: number; top: number } {
  return {
    left: Math.max(box.left, Math.min(left, box.right - SIZE)),
    top: Math.max(box.top, Math.min(top, box.bottom - SIZE)),
  };
}

/**
 * 圆点放在文字末尾旁边（#667）。末尾也是光标所在，两者并排而不重叠，否则
 * 圆点会被当成光标的一部分：
 * - 默认在末尾之后（LTR 右侧、RTL 左侧，#666），留 GAP 的间隙，竖直居中于
 *   末尾那一行；
 * - 那一侧放不下（窄框、末尾顶到内边缘）时换到末尾那一行的下方，再不行
 *   上方，横向贴那一侧的内边缘 —— 不在这一行上，就碰不到光标；
 * - 上下也没地方（单行文本框）时放到光标的另一侧，同样留 GAP。
 */
function besideEnd(
  end: TextEnd,
  box: InnerBox,
  rtl: boolean,
): { left: number; top: number; side: EndSide } {
  const centered = end.y + end.height / 2 - SIZE / 2;
  const after = rtl ? end.x - GAP - SIZE : end.x + GAP;
  const before = rtl ? end.x + GAP : end.x - GAP - SIZE;
  if (after >= box.left && after + SIZE <= box.right) {
    return { left: after, top: centered, side: rtl ? 'right' : 'left' };
  }
  const left = rtl ? box.left : box.right - SIZE;
  const below = end.y + end.height;
  if (below + SIZE <= box.bottom) return { left, top: below, side: 'top' };
  const above = end.y - SIZE;
  if (above >= box.top) return { left, top: above, side: 'bottom' };
  return { left: before, top: centered, side: rtl ? 'left' : 'right' };
}

/**
 * 圆点位置（ADR-0006）：多行（#665）、单行（#666）文本框与 contenteditable
 * （#671）贴文字末尾，与光标并排（#667），并钳在框的可见区域里（#669）；量不
 * 出来时回落框内侧右下角 —— 圆点是唯一入口，量不出来只换位置，绝不不显示。
 */
function place(dot: HTMLElement, el: HTMLElement, shadow: ShadowRoot): void {
  const end =
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
      ? measureFieldEnd(el, shadow)
      : measureEditableEnd(el);
  if (!end) {
    placeFallback(dot, el);
    return;
  }
  const box = innerBox(el);
  const beside = besideEnd(end, box, getComputedStyle(el).direction === 'rtl');
  const { left, top } = clampToBox(beside.left, beside.top, box);
  dot.style.left = `${left}px`;
  dot.style.top = `${top}px`;
  placeHit(dot, left, top, box, { side: beside.side, at: end });
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

  /**
   * 盯住当前输入框的样式与尺寸（#668）：站点改了它的行内样式、class，或者
   * 经样式表、父容器让它变了尺寸，量过的末尾就过时了，重新对齐一次。
   */
  const restyled = new MutationObserver(() => onReflow());
  // observe 之后总会先报一次当前尺寸，那一次不是变化，不量
  let initialSize = false;
  const resized =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (initialSize) initialSize = false;
          else onReflow();
        });
  let watched: Element | null = null;
  const watch = (el: Element | null): void => {
    if (el === watched) return;
    restyled.disconnect();
    resized?.disconnect();
    watched = el;
    if (!el) return;
    initialSize = true;
    restyled.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    resized?.observe(el);
  };

  const hide = (): void => {
    cancelAlign();
    watch(null);
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
    watch(el);
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
  // 圆点是 fixed 定位，页面或框内滚动时重新贴合；网页字体加载完、框的样式
  // 或尺寸变了（#668）同样重新对齐
  // 还在等停手时不量：打字引起的框内滚动、自动增高交给停手后的那次对齐
  function onReflow(): void {
    if (target && settleTimer === undefined) place(dot, target, shadow);
  }

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
  document.fonts?.addEventListener('loadingdone', onReflow);

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
    document.fonts?.removeEventListener('loadingdone', onReflow);
    observer.disconnect();
    watch(null);
    unmountIsolated(HOST_ID);
  };
}
