// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译圆点的镜像测量（#665，ADR-0006）—— 量多行文本框里文字末尾的位置。
//
// textarea 的内容是 value 而不是 DOM 文本，Range 量不到。只能另建一个隐藏的
// 镜像元素：把影响排版的样式（字体、字号、行高、内边距、边框、字间距、
// 换行规则、书写方向）复制过去，放进同样的文字，在末尾插一个标记再量它，
// 最后减去框内的滚动位置。
//
// 契约：返回文字末尾的坐标，或者返回 null 表示算不出来（没有布局、框没有
// 渲染出来）。算不出来时调用方回落到框内侧右下角，绝不因此不显示圆点。
//
// 镜像放在调用方给的容器里（圆点自己的 shadow root）：页面样式碰不到它，
// 页面的 MutationObserver 也看不到它的增删。量完立刻移除。

/** 文字末尾：视口坐标下末尾那一行的左边缘位置与行盒的上沿、高度。 */
export interface TextEnd {
  x: number;
  y: number;
  height: number;
}

/** 复制到镜像上的排版样式。宽高与盒模型单独处理。 */
const COPIED = [
  'direction',
  'fontFamily',
  'fontFeatureSettings',
  'fontKerning',
  'fontSize',
  'fontSizeAdjust',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'overflowWrap',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'tabSize',
  'textAlign',
  'textIndent',
  'textTransform',
  'whiteSpace',
  'wordBreak',
  'wordSpacing',
  'writingMode',
] as const;

/**
 * 量多行文本框里文字末尾的位置；算不出来时为 null。
 * @param container 放镜像的容器（圆点自己的 shadow root）
 */
export function measureTextareaEnd(
  el: HTMLTextAreaElement,
  container: ShadowRoot | HTMLElement,
): TextEnd | null {
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const cs = getComputedStyle(el);

  const mirror = document.createElement('div');
  const style = mirror.style;
  for (const prop of COPIED) style[prop] = cs[prop];
  style.borderStyle = 'solid';
  style.borderColor = 'transparent';
  // 内容区宽度取 clientWidth 减内边距：竖向滚动条占掉的宽度不算，与框里换行一致
  style.boxSizing = 'content-box';
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  style.width = `${Math.max(0, el.clientWidth - padX)}px`;
  style.position = 'fixed';
  style.left = '0';
  style.top = '0';
  style.visibility = 'hidden';
  style.pointerEvents = 'none';
  style.overflow = 'hidden';
  // textarea 的文字总是保留空白与换行；站点改成别的值时以框的实际为准
  if (cs.whiteSpace === 'normal') style.whiteSpace = 'pre-wrap';

  // 末尾标记：零宽字符撑出行盒。跟在末尾换行与末尾空格之后，所以空行与
  // 末尾空格都会把它推到正确的位置
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.append(document.createTextNode(el.value), marker);

  container.appendChild(mirror);
  try {
    const m = mirror.getBoundingClientRect();
    const r = marker.getBoundingClientRect();
    if (m.width === 0 || r.height === 0) return null;
    const x = box.left + (r.left - m.left) - el.scrollLeft;
    const y = box.top + (r.top - m.top) - el.scrollTop;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, height: r.height };
  } finally {
    mirror.remove();
  }
}
