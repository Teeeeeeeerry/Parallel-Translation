// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译圆点的定位（#1081，父 #1070）：测量、收小（行高上限）、回落位置、钳边、
// 可点区，以及“就位状态”都在这里。位置的规则是 ADR-0006 定的三条，一条没改：
// 贴文字末尾、停手约 140 毫秒后对齐（#670）、测量失败回落到框内右下角。
//
// 就位状态只有两种：following（跟随中：打字期间，或停手计时还没到）与 settled
// （已就位：已对齐到当前测量位置，或已回落）。状态写在圆点的 data-placement
// 属性上供端到端读取，变化可订阅。打字期间不测量 —— 测量会强制同步布局，打字
// 卡顿是立刻能感觉到的，圆点允许落后，停手才对齐。

import { measureEditableEnd, measureFieldEnd, type TextEnd } from './input-measure';
import { inputDotHitSize } from './floating-ui-size';
import { GAP, SHOW_DELAY } from './float-common';

/** 量文字末尾；算不出来时为 null（回落）。缺省按框的种类用镜像或行盒测量。 */
export type MeasureEnd = (el: HTMLElement, shadow: ShadowRoot) => TextEnd | null;

const measureEnd: MeasureEnd = (el, shadow) =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
    ? measureFieldEnd(el, shadow)
    : measureEditableEnd(el);

/** 圆点直径的缺省值，与 injected.css 里 .pt-input-dot 的回落值一致。 */
const DEFAULT_SIZE = 14;

/**
 * 圆点直径与可点区边长（#987）。直径读圆点自己的布局宽度 —— 由设置经文档根上的
 * 变量给出，CSS 是唯一来源，这里不另读设置；隐藏时量不到，回落缺省值。可点区
 * （#638）边长与 CSS 同一个换算：随直径等比放大、不小于逐段翻译按钮的 24px
 * 下限。可见圆点不直接撑大成可点区 —— 那样会挡住文字（ADR-0006）。
 */
interface DotDims {
  size: number;
  hit: number;
}
function dotDims(dot: HTMLElement): DotDims {
  const size = dot.offsetWidth || DEFAULT_SIZE;
  return { size, hit: inputDotHitSize(size) };
}
/**
 * 多行的框里收小圆点（#997）。圆点竖直居中在末尾那一行，字形盒在行盒里上下
 * 对称，所以居中的圆点碰不到上一行字形的条件是：直径 ≤ 2 × 行高 − 字形高。
 * 行高紧凑的框（聊天、评论框常见 1.0–1.2）里设置的直径超过它时，按这个上限
 * 收小可见直径，宁可小一点也不压住文字（ADR-0006）；可点区按收小后的直径换算，
 * 仍不低于 24px。
 *
 * 上限写成圆点自己的 max-width / max-height，不覆盖直径变量：设置里再改直径时
 * 圆点照常变化，上面的直径观察器照常重新摆放。单行框上下没有别的行，不收。
 * 行高是 normal 时按字形高算（normal 的行盒约等于字形盒）。
 */
function fitLine(dot: HTMLElement, el: HTMLElement, end: TextEnd): DotDims {
  const d = dotDims(dot);
  const cap = lineCap(el, end);
  if (cap === null) return d;
  if (d.size <= cap) return d;
  const size = Math.max(MIN_FIT_SIZE, cap);
  dot.style.maxWidth = dot.style.maxHeight = `${size}px`;
  dot.style.setProperty('--pt-input-dot-hit', `${inputDotHitSize(size)}px`);
  return { size, hit: inputDotHitSize(size) };
}

/**
 * 收小上限（#997、#1017，#1081 起只在这里算）：直径 ≤ 2 × 行高 − 字形高。单行框
 * 上下没有别的行，不收（null）。行高取末尾那一行文字实际排版用的行高：文本框
 * 读框自己的；contenteditable 读末尾那段文字所在元素的 —— 富文本编辑器给内层
 * 段落另设的行高、行内元素自己的行高都在那里体现，宿主的行高不一定是文字的。
 * 行高是 normal（NaN）时按字形高算。
 */
export function lineCap(el: HTMLElement, end: TextEnd): number | null {
  if (el instanceof HTMLInputElement) return null;
  const lh = parseFloat(getComputedStyle(lineHost(el)).lineHeight);
  return Math.floor(2 * (Number.isFinite(lh) ? lh : end.height) - end.height);
}

/** 末尾那一行文字的行高读谁的：文本框是它自己，contenteditable 是最后一段文字的父元素。 */
function lineHost(el: HTMLElement): Element {
  if (el instanceof HTMLTextAreaElement) return el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent?.trim()) last = n;
  }
  return last?.parentElement ?? el;
}

/** 收小的下限：再小就只剩描边，看不出是个按钮。行高低到要收到这以下时宁可压一点。 */
const MIN_FIT_SIZE = 8;

/** 撤掉上一次的收小，回到设置给的直径与可点区。 */
function unfit(dot: HTMLElement): void {
  dot.style.maxWidth = dot.style.maxHeight = '';
  dot.style.removeProperty('--pt-input-dot-hit');
}

/** 回落位置离框内侧边缘的距离。 */
const INSET = 6;

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
 * 可点区在一条轴上相对可见圆点的偏移（#638）：可点区是 hit 见方、把圆点
 * 包在里面的透明一圈，偏移取 [size - hit, 0]。guardMin / guardMax 是文字
 * 末尾给出的硬边界；框的可见区域是软边界，框装得下这一圈时才收进去；
 * 其余情况居中。
 */
function hitAxis(
  dot: number,
  boxLo: number,
  boxHi: number,
  guardMin: number,
  guardMax: number,
  { size, hit }: DotDims,
): number {
  let min = Math.max(size - hit, guardMin);
  let max = Math.min(0, guardMax);
  const inMin = Math.max(min, boxLo - dot);
  const inMax = Math.min(max, boxHi - hit - dot);
  if (inMin <= inMax) {
    min = inMin;
    max = inMax;
  }
  return Math.min(max, Math.max(min, (size - hit) / 2));
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
  d: DotDims,
  end?: { side: EndSide; at: TextEnd },
): void {
  const spare = d.size - d.hit;
  let xMin = spare, xMax = 0, yMin = spare, yMax = 0;
  if (end?.side === 'left') xMin = Math.min(0, end.at.x + 1 - left);
  if (end?.side === 'right') xMax = Math.max(spare, end.at.x - 1 - d.hit - left);
  if (end?.side === 'top') yMin = Math.min(0, end.at.y + end.at.height + 1 - top);
  if (end?.side === 'bottom') yMax = Math.max(spare, end.at.y - 1 - d.hit - top);
  dot.style.setProperty('--pt-hit-x', `${hitAxis(left, box.left, box.right, xMin, xMax, d)}px`);
  dot.style.setProperty('--pt-hit-y', `${hitAxis(top, box.top, box.bottom, yMin, yMax, d)}px`);
}

/** 回落位置：框内侧右下角（ADR-0006）。 */
function placeFallback(dot: HTMLElement, el: HTMLElement): void {
  const box = innerBox(el);
  const d = dotDims(dot);
  const left = box.right - INSET - d.size;
  const top = box.bottom - INSET - d.size;
  dot.style.left = `${left}px`;
  dot.style.top = `${top}px`;
  placeHit(dot, left, top, box, d);
}

/**
 * 把圆点钳在框的可见区域里（#669，ADR-0006）：文字末尾滚出可见区域时，
 * 圆点停在离它最近的可见边缘，不隐藏、也不换样式 —— 长文本恰恰是最想
 * 翻译的那种，圆点消失会被当成功能坏了。框比圆点还小时贴左上。
 */
function clampToBox(
  left: number,
  top: number,
  box: InnerBox,
  size: number,
): { left: number; top: number } {
  return {
    left: Math.max(box.left, Math.min(left, box.right - size)),
    top: Math.max(box.top, Math.min(top, box.bottom - size)),
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
  size: number,
): { left: number; top: number; side: EndSide } {
  const centered = end.y + end.height / 2 - size / 2;
  const after = rtl ? end.x - GAP - size : end.x + GAP;
  const before = rtl ? end.x + GAP : end.x - GAP - size;
  if (after >= box.left && after + size <= box.right) {
    return { left: after, top: centered, side: rtl ? 'right' : 'left' };
  }
  const left = rtl ? box.left : box.right - size;
  const below = end.y + end.height;
  if (below + size <= box.bottom) return { left, top: below, side: 'top' };
  const above = end.y - size;
  if (above >= box.top) return { left, top: above, side: 'bottom' };
  return { left: before, top: centered, side: rtl ? 'left' : 'right' };
}

/**
 * 圆点位置（ADR-0006）：多行（#665）、单行（#666）文本框与 contenteditable
 * （#671）贴文字末尾，与光标并排（#667），并钳在框的可见区域里（#669）；量不
 * 出来时回落框内侧右下角 —— 圆点是唯一入口，量不出来只换位置，绝不不显示。
 */
function place(dot: HTMLElement, el: HTMLElement, shadow: ShadowRoot, measure: MeasureEnd): void {
  const end = measure(el, shadow);
  unfit(dot);
  if (!end) {
    placeFallback(dot, el);
    return;
  }
  const box = innerBox(el);
  const d = fitLine(dot, el, end);
  const beside = besideEnd(end, box, getComputedStyle(el).direction === 'rtl', d.size);
  const { left, top } = clampToBox(beside.left, beside.top, box, d.size);
  dot.style.left = `${left}px`;
  dot.style.top = `${top}px`;
  placeHit(dot, left, top, box, d, { side: beside.side, at: end });
}

/** 就位状态（#1081）。 */
export type DotPlacement = 'following' | 'settled';

export interface DotPlacer {
  /** 立即对齐（聚焦、滚动、框改了样式或尺寸）：量一次、摆好，已就位。 */
  settle(el: HTMLElement): void;
  /**
   * 打字（#670）：不测量，跟随中；刚浮出时先放回落位置，不至于没有位置。停手
   * SHOW_DELAY 后对齐一次，已就位。
   */
  follow(el: HTMLElement, firstShow: boolean): void;
  /** 还在等停手：这时滚动、改尺寸都不量，交给停手后的那次对齐。 */
  waiting(): boolean;
  /** 圆点隐藏：取消等待，不再有就位状态。 */
  reset(): void;
  /** 当前就位状态；圆点没显示时为 null。 */
  state(): DotPlacement | null;
  /** 订阅就位状态的变化（null 表示圆点隐藏）。返回退订函数。 */
  subscribe(listener: (state: DotPlacement | null) => void): () => void;
}

export function createDotPlacer(
  dot: HTMLElement,
  shadow: ShadowRoot,
  measure: MeasureEnd = measureEnd,
): DotPlacer {
  let current: DotPlacement | null = null;
  const listeners = new Set<(state: DotPlacement | null) => void>();
  const setState = (next: DotPlacement | null): void => {
    if (next === current) return;
    current = next;
    if (next) dot.dataset.placement = next;
    else delete dot.dataset.placement;
    for (const l of [...listeners]) l(next);
  };

  /** 停手后对齐的计时器（#670）；有值表示还在等停手。 */
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const settle = (el: HTMLElement): void => {
    cancel();
    place(dot, el, shadow, measure);
    setState('settled');
  };

  return {
    settle,
    follow(el, firstShow) {
      cancel();
      if (firstShow) placeFallback(dot, el);
      setState('following');
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        settle(el);
      }, SHOW_DELAY);
    },
    waiting: () => settleTimer !== undefined,
    reset() {
      cancel();
      setState(null);
    },
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
