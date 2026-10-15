// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

import type { SkipCategory } from './walker';

/**
 * 一次整页翻译里的采集（#1011）：整页入口先采一次，翻完再补采集一次。
 *
 * 同一个元素只交出一次。首轮交出去的单元，不论之后翻成功、翻失败，还是
 * 译文与原文相同、被兜底拦下没落完成标记（#783），补采集都不再交出 —— 失败
 * 的重试归批次重试管（#1003）。带完成标记的单元由采集本身跳过（classify 的
 * 'translated'），不靠这里：逐段翻译、增量补翻在首轮之后翻掉的段落也因此
 * 不会被补采集重翻。
 *
 * 跳过的单元同样只报一次，“另有 N 段未被采集”的 N 不随补采集翻倍。
 *
 * 每次整页翻译新建一个：还原之后再点，是新的一次，所有单元重新交出。
 */
export function createPageCollector(
  collectOnce: (onSkip: (el: Element, category: SkipCategory) => void) => Element[],
  onSkip?: (el: Element, category: SkipCategory) => void,
): () => Element[] {
  const handedOut = new WeakSet<Element>();
  const reported = new WeakSet<Element>();
  return () => {
    const els = collectOnce((el, category) => {
      if (reported.has(el)) return;
      reported.add(el);
      onSkip?.(el, category);
    });
    const fresh = els.filter((el) => !handedOut.has(el));
    for (const el of fresh) handedOut.add(el);
    return fresh;
  };
}
