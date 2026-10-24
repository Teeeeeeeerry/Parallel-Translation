// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 整页 DOM 原语（#1116，父 #1110）：全页翻译交给整页翻译会话的那几个 DOM 动作
// —— 把单元做成翻译项、渲染一项、还原整页、页面是否已有译文。
//
// 原先写在内容脚本里，单测拿不到，两份测试装配各自照抄了一份（其中一份漏了
// 切块还原）。搬到这里之后内容脚本与测试装配用的是同一份实现。

import type { TranslateItem } from '../orchestration/orchestrator';
import { hasBlockTextChildren, restorePreserves, unitTextEx } from './text';
import { render, unrender, type RenderResult } from './renderer';
import { unsplitChunks } from './chunk-split';
import { walkShadowTree } from './shadow-walk';

/** 翻译项的渲染上下文（#261）：目标元素 + preserves + 原文。 */
export interface PageItemCtx {
  target: Element;
  preserves: Map<string, string>;
  rawText: string;
}

/**
 * 构建翻译项（#329）：归一化内部空白、混合内容提取、占位符映射全部在此。
 */
export function buildPageItem(el: Element): TranslateItem<PageItemCtx> {
  const { text, preserves } = unitTextEx(el, { shallow: hasBlockTextChildren(el) });
  return { text, ctx: { target: el, preserves, rawText: text } };
}

/** 渲染一个单元：占位符换回原文后插入译文。 */
export function renderPageItem(item: TranslateItem<PageItemCtx>, translation: string): RenderResult {
  const ctx = item.ctx;
  // #58：将占位符替换回原文（用户名等标识符不翻译但保留）
  const restored = restorePreserves(translation, ctx.preserves, ctx.rawText);
  // #783：译文与送去翻译的原文比对，原文里的占位符同样换回
  const source = restorePreserves(ctx.rawText, ctx.preserves, ctx.rawText);
  return render(ctx.target, restored, 'page', source);
}

/**
 * 还原整页：撤回页面上全部渲染（逐段翻译、增量补翻翻好的也一并撤回），再拆回
 * 被切分的容器，DOM 回到逐字节原貌。
 */
export function restorePage(): void {
  // #253: 还原收集走统一遍历模块（shadow 穿透 + 集中式跳过规则）。
  // skipTranslated: false —— 嵌套在已翻译单元内的已翻译单元
  // （.pt-origin 搬移的既有译文）也要一并收集还原。
  const els: Element[] = [];
  const splitContainers: Element[] = [];
  walkShadowTree(
    document,
    (el) => {
      if (el.getAttribute('data-pt') === 'done') els.push(el);
      // #65：收集被切分的容器（#705 起不只 pre），在 unrender 后还原 DOM
      if (el.getAttribute('data-pt-split') === '1') splitContainers.push(el);
    },
    { skipTranslated: false },
  );

  for (const el of els) {
    unrender(el);
  }
  // #65：unrender chunk 后再还原切分包装，将 DOM 恢复为逐字节原貌
  for (const container of splitContainers) {
    unsplitChunks(container);
  }
}

/**
 * 页面上有没有译文（#325/#329）—— 以真实 DOM 为准而不是布尔标志：
 * 逐段翻译与增量补翻都会落 data-pt="done"，仅查标志会把“页面上已有译文”
 * 误判成“没翻过”，整页开关走错分支。
 */
export function hasTranslated(): boolean {
  // #253: 判定走统一遍历模块（shadow 穿透，命中即短路终止）
  let found = false;
  walkShadowTree(document, (el) => {
    if (el.getAttribute('data-pt') === 'done') {
      found = true;
      return 'stop';
    }
  });
  return found;
}
