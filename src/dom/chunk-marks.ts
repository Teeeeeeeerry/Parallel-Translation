// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 切块标记（#1144，父 #1138）：切块内核切出的切块与切过的容器各打一个标记，
// 采集、渲染、还原、观察器、逐段翻译按钮都靠它认出扩展自己切的东西。
//
// 标记原先在 7 个文件里写成字面量。现在只在这里定义，其余模块经下面的函数
// 识别与打标记。本模块不 import 任何东西，谁都可以用，不会多出循环引用。
//
// - 切块：<span class="pt-chunk" data-pt-chunk="1">。类名给样式用（injected.css），
//   识别看 data 属性
// - 切过的容器：data-pt-split="1"，切分幂等与还原时据此找回来

const CHUNK_CLASS = 'pt-chunk';
const CHUNK_ATTR = 'data-pt-chunk';
const SPLIT_ATTR = 'data-pt-split';
const CHUNK_SELECTOR = `[${CHUNK_ATTR}="1"]`;

/** 新建一个切块（还没挂进文档）。 */
export function createChunk(): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = CHUNK_CLASS;
  span.setAttribute(CHUNK_ATTR, '1');
  return span;
}

/** 是不是扩展切出的切块。 */
export function isChunk(el: Element): boolean {
  return el.getAttribute?.(CHUNK_ATTR) === '1';
}

/** el 自身或祖先里最近的切块。 */
export function closestChunk(el: Element): Element | null {
  return el.closest?.(CHUNK_SELECTOR) ?? null;
}

/** 容器直接包含的切块。 */
export function chunksOf(container: Element): Element[] {
  return [...container.querySelectorAll(`:scope > ${CHUNK_SELECTOR}`)];
}

/** 容器是否已经切过。 */
export function isSplitContainer(el: Element): boolean {
  return el.getAttribute(SPLIT_ATTR) === '1';
}

/** 给容器打上“已经切过”的标记。 */
export function markSplit(container: Element): void {
  container.setAttribute(SPLIT_ATTR, '1');
}

/** 去掉容器“已经切过”的标记（还原时）。 */
export function unmarkSplit(container: Element): void {
  container.removeAttribute(SPLIT_ATTR);
}
