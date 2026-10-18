// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 整页翻译会话（#1067）：一次全页翻译从开始到还原的状态收在这里。
//
// 每次整页翻译新建一个会话；还原之后再点是新的一次，去重记录与统计从头来。
// 内容脚本只注入 DOM 原语（采集、只读采集、把元素做成翻译项、渲染一个单元），
// 会话不直接碰 document。
//
// #1077（这一张）：首轮与补采集的采集去重、按轮统计归会话。
// - 去重：会话自己记下交出过的单元，同一个元素只交出一次（#1011）。补采集能
//   停下来不再依赖渲染一侧落下的完成标记 —— #1056 就是测试替身没落标记、
//   这条隐式约定被打破，补采集每轮把全部段落重采重发。完成标记仍由渲染落下，
//   供样式与还原使用；首轮之后被逐段翻译、增量补翻翻掉的段落照旧由采集本身
//   按完成标记跳过（classify 的 'translated'）。
// - 统计：每一次采集是一轮，各轮各记各的渲染统计；批次结果交回会话时记进
//   这批单元所在的那一轮。“所有渲染都被拒”读首轮自己的统计，不会被补翻或
//   另一路增量补翻清零、叠加。对外的“这一次的汇总”由会话合成。
// - 跳过的单元同样只报一次，“另有 N 段未被采集”的 N 不随补采集翻倍。

import type { RenderResult } from '../dom/renderer';
import type { SkipCategory } from '../dom/walker';
import { createPageCollector } from '../dom/page-collect';
import type { TranslateItem, TranslateBatchResult } from './orchestrator';
import {
  countRender,
  countSkip,
  emptyRenderStats,
  emptySkipStats,
  type RenderStats,
  type SkipStats,
} from './page-summary';

/** 内容脚本注入的 DOM 原语。 */
export interface PageSessionDom<Ctx> {
  /** 照常翻译的那次采集（会切块、登记隐藏单元）；被跳过的单元经 onSkip 报出。 */
  collect(onSkip: (el: Element, category: SkipCategory) => void): Element[];
  /** 只读采集（#843）：不切块、不登记隐藏单元，页面一个字不动 —— 页面级闸门取样用。 */
  collectReadOnly(): Element[];
  /** 把一个单元元素做成翻译项（取文字、占位符映射）。 */
  build(el: Element): TranslateItem<Ctx>;
  /** 把一个单元的译文渲染上去，报告渲染结果。 */
  render(item: TranslateItem<Ctx>, translation: string): RenderResult;
}

export interface PageSession<Ctx = unknown> {
  /** 只读单元的文字：页面级闸门取样（#843），不交出、不计轮。 */
  readUnits(): string[];
  /**
   * 采集一轮：只交出这个会话还没交出过的单元，开一轮新的统计。第一次调用是
   * 首轮，之后是补采集的各轮（#1011）。
   */
  collectRound(): TranslateItem<Ctx>[];
  /** 编排模块把每一批的结果交回来：会话渲染，记进这批单元所在那一轮的统计。 */
  onBatchResult(batch: TranslateItem<unknown>[], result: TranslateBatchResult): void;
  /** 第 i 轮（0 是首轮）的渲染统计；还没有这一轮时是全零。 */
  roundStats(i: number): RenderStats;
  /** 这一次的汇总：各轮渲染统计相加。 */
  totals(): RenderStats;
  /** 这一次采集里被跳过的单元，按原因分组（每个元素只计一次，#727）。 */
  skips(): SkipStats;
}

export function createPageSession<Ctx>(dom: PageSessionDom<Ctx>): PageSession<Ctx> {
  const skips = emptySkipStats();
  const collectFresh = createPageCollector(
    (onSkip) => dom.collect(onSkip),
    (_el, category) => countSkip(skips, category),
  );
  const rounds: RenderStats[] = [];
  /** 翻译项 → 它所在的那一轮（批次里拿到的是同一批对象）。 */
  const roundOf = new WeakMap<object, RenderStats>();

  return {
    readUnits() {
      return dom.collectReadOnly().map((el) => dom.build(el).text);
    },

    collectRound() {
      const stats = emptyRenderStats();
      rounds.push(stats);
      const items = collectFresh().map((el) => dom.build(el));
      for (const item of items) roundOf.set(item, stats);
      return items;
    },

    onBatchResult(batch, result) {
      const statsOf = (item: TranslateItem<unknown>) => roundOf.get(item) ?? rounds[rounds.length - 1]!;
      if (!result.ok || !result.data) {
        for (const item of batch) statsOf(item).failed++;
        return;
      }
      const translations = result.data.translations;
      // #416: 所有引擎都失败的段落不渲染，保持原样，结束后汇总提示
      const failed = new Set(result.data.failedIndices ?? []);
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        if (failed.has(j)) {
          statsOf(item).failed++;
          continue;
        }
        try {
          countRender(statsOf(item), dom.render(item as TranslateItem<Ctx>, translations[j]!));
        } catch (e) {
          throw new Error(`[render idx=${j}] ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    },

    roundStats(i) {
      return rounds[i] ?? emptyRenderStats();
    },

    totals() {
      const sum = emptyRenderStats();
      for (const r of rounds) {
        sum.succeeded += r.succeeded;
        sum.rejected += r.rejected;
        sum.sameAsSource += r.sameAsSource;
        sum.failed += r.failed;
      }
      return sum;
    },

    skips() {
      return { ...skips };
    },
  };
}

/** 整页开关入口收到的是会话（不是现成的数组或采集函数，#1077）。 */
export function isPageSession(x: unknown): x is PageSession {
  return typeof x === 'object' && x !== null && 'collectRound' in x;
}
