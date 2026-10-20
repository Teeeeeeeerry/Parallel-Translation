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
import { deepActiveElement } from './float-common';
import { createDotPlacer, type DotPlacement } from './input-dot-place';
import { onUiLocaleChange, tf } from '../i18n';
import { decideInputEligibility, inputText, type TextInput } from './input-eligibility';

const HOST_ID = 'input-dot';

/** 框里至少有这么多字符才浮出 —— 空的搜索框上不该无故冒出一个点。 */
const MIN_CHARS = 2;

function eligible(el: Element | null): el is TextInput {
  return decideInputEligibility(el).eligible;
}

function hasEnoughText(el: TextInput): boolean {
  return inputText(el).trim().length >= MIN_CHARS;
}


/** 圆点的回调：点击时拿到当前输入框。 */
interface InputDotHandlers {
  translate: (el: TextInput) => Promise<void>;
  /**
   * 就位状态的变化（#1081）：跟随中 / 已就位；圆点隐藏时为 null。页面上同时
   * 写在圆点的 data-placement 属性上。
   */
  onPlacement?: (state: DotPlacement | null) => void;
}

export function createInputDot(handlers: InputDotHandlers): () => void {
  const shadow = mountIsolated(HOST_ID);
  const dot = document.createElement('button');
  dot.className = 'pt-input-dot';
  dot.type = 'button';
  shadow.appendChild(dot);
  // 可读名称按当时的扩展语言取，扩展语言变了重取（#1101）
  const relabel = () => dot.setAttribute('aria-label', tf('inputDotLabel', '翻译输入框里的文字'));
  relabel();
  const offLocale = onUiLocaleChange(relabel);

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

  // #1081：测量、收小、回落、停手对齐与就位状态在定位模块
  const placer = createDotPlacer(dot, shadow);
  if (handlers.onPlacement) placer.subscribe(handlers.onPlacement);

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
  // #987: 设置里改了圆点大小（文档根上的变量变了）时圆点正显示着，变量变化
  // 不经过上面任何一个时机，按新直径重新摆放一次。只认非零直径的变化 ——
  // 显示与隐藏切换（0 ↔ 直径）不算，第一次量到直径也不算
  let laidSize = 0;
  const dotResized =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const size = dot.offsetWidth;
          if (size === 0 || size === laidSize) return;
          const first = laidSize === 0;
          laidSize = size;
          if (!first) onReflow();
        });
  dotResized?.observe(dot);
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
    placer.reset();
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
    if (!typing) placer.settle(el);
    else placer.follow(el, !wasShown);
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
    if (target && !placer.waiting()) placer.settle(target);
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
    offLocale();
    placer.reset();
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    document.fonts?.removeEventListener('loadingdone', onReflow);
    observer.disconnect();
    dotResized?.disconnect();
    watch(null);
    unmountIsolated(HOST_ID);
  };
}
