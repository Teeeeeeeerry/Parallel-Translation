// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 整页翻译会话（#1067）：一次全页翻译从开始到还原的状态收在这里。
//
// 内容脚本只注入 DOM 原语（采集、只读采集、把单元做成翻译项、渲染、撤回渲染、
// 页面上有没有译文、启动观察器），会话不直接碰 document。编排模块保留互斥、
// 页面级闸门的调用、切批与发送；整页开关入口拿到的是这里的“整页翻译”对象。
//
// 一个页面一个“整页翻译”（createPageTranslation），每次整页翻译从它新建一个
// 会话（begin）；还原整页结束当前会话，之后再点是新的一次，去重记录与统计
// 从头来。
//
// 会话持有（#1077、#1078）：
// - 采集去重：会话自己记下交出过的单元，同一个单元只交出一次（#1011）。补采集
//   能停下来不再依赖渲染一侧落下的完成标记（#1056）；完成标记仍由渲染落下，供
//   样式与还原使用。
// - 按轮统计：每一次采集是一轮，各轮各记渲染统计，“所有渲染都被拒”读首轮自己
//   的统计；对外的汇总由会话合成。跳过的单元只报一次。
// - 补采集（#1011、#1013）：首轮成功后再采，最多 RECOLLECT_MAX_ROUNDS 轮，轮间
//   等 RECOLLECT_INTERVAL_MS，某一轮没有新单元就结束。
// - 到顶交接（#1036）：补满轮数时，在启动观察器的同一个同步段里再采一次，交给
//   增量补翻；这一次翻译被等待（#1078，此前是没等待的调用）。
// - 观察器启停与观察器启动前的隐藏单元缓冲（#255、#331、#332）。
// - 还原：停观察器、撤回页面上全部渲染。

import type { RenderResult } from '../dom/renderer';
import type { SkipCategory } from '../dom/walker';
import type {
  PageToggleVisual,
  PageTranslateSummary,
  TranslateBatchResult,
  TranslateItem,
} from './orchestrator';
import {
  allRenderBlocked,
  countRender,
  countSkip,
  emptyRenderStats,
  emptySkipStats,
  type RenderStats,
  type SkipStats,
} from './page-summary';
import { sleepUnlessAborted } from '../runtime/sleep';

/**
 * 补采集的轮数上限与轮间间隔（#1013）。间隔按实测定：翻译期间滚到底之后，
 * Reddit 列表 929、1243 毫秒出现下一批，dev.to 首页 390 到 788 毫秒出现、最慢
 * 一次 1429 毫秒才渲染完（docs/research/lazy-load-window-repro.md 第 6 节）。
 * 观察器的 300 毫秒防抖一次都接不住。
 */
export const RECOLLECT_MAX_ROUNDS = 3;
export const RECOLLECT_INTERVAL_MS = 1500;

/** 增量补翻观察器的句柄（#331）。 */
export interface PageObserver<U> {
  stop(): void;
  /** 登记一个隐藏单元，展开后交给增量补翻（#330）。 */
  registerHidden(unit: U): void;
}

/** 内容脚本注入的 DOM 原语。U 是“单元”（真实页面上是元素）。 */
export interface PageDom<U extends object, Ctx> {
  /**
   * 照常翻译的那次采集（会切块）；被跳过的单元经 onSkip 报出，隐藏单元经
   * onHidden 交给会话（观察器启动前由会话缓冲）。
   */
  collect(onSkip: (unit: U, category: SkipCategory) => void, onHidden: (unit: U) => void): U[];
  /** 只读采集（#843）：不切块、不登记隐藏单元，页面一个字不动 —— 页面级闸门取样用。 */
  collectReadOnly(): U[];
  /** 把一个单元做成翻译项（取文字、占位符映射）。 */
  build(unit: U): TranslateItem<Ctx>;
  /** 把一个单元的译文渲染上去，报告渲染结果。 */
  render(item: TranslateItem<Ctx>, translation: string): RenderResult;
  /** 撤回页面上全部渲染（还原整页；逐段翻译、增量补翻翻好的也一并撤回）。 */
  unrenderAll(): void;
  /** 页面上有没有译文 —— 以页面为准（逐段翻译、增量补翻也算，#325）。 */
  hasTranslated(): boolean;
  /** 启动增量补翻观察器（整页翻译成功后，#328）。 */
  observe(): PageObserver<U>;
}

/** 编排模块的批次流水线（准入、切批、闸门、发送、重试）。 */
export type PagePipeline = (
  items: TranslateItem<unknown>[],
  opts: {
    signal: AbortSignal;
    onBatch: (batch: TranslateItem<unknown>[], result: TranslateBatchResult) => void;
    /** 补采集与到顶交接是这一次的延续，准入不重判（#1011） */
    admitted?: boolean;
  },
) => Promise<PageTranslateSummary>;

/** 会话跑一次整页翻译要用的东西，由编排模块给出。 */
export interface PageRunContext {
  translate: PagePipeline;
  /** 这一次整页开关的运行（#1073）：还原整页让它中止 */
  signal: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  /** 悬浮球该显示什么（#327、#1012） */
  onState: (state: PageToggleVisual) => void;
}

/** 一次整页翻译的结局。 */
export type PageRunOutcome =
  | { status: 'no-elements' }
  | { status: 'translated' | 'error' | 'abandoned'; summary: PageTranslateSummary };

export interface PageSession<Ctx = unknown> {
  /** 跑这一次整页翻译：首轮 → 补采集 → 到顶交接 → 启动观察器。 */
  run(ctx: PageRunContext): Promise<PageRunOutcome>;
  /** 采集一轮：只交出这个会话还没交出过的单元，开一轮新的统计。 */
  collectRound(): TranslateItem<Ctx>[];
  /** 第 i 轮（0 是首轮）的渲染统计；还没有这一轮时是全零。 */
  roundStats(i: number): RenderStats;
  /** 这一次的汇总：各轮渲染统计相加。 */
  totals(): RenderStats;
  /** 这一次采集里被跳过的单元，按原因分组（每个单元只计一次，#727）。 */
  skips(): SkipStats;
}

/** 一个页面的整页翻译：整页开关入口拿到的就是它。 */
export interface PageTranslation {
  /** 页面上有没有译文：有就还原，没有就翻译（#325）。 */
  hasTranslated(): boolean;
  /** 只读单元的文字：页面级闸门取样（#843）。 */
  readUnits(): string[];
  /** 新的一次整页翻译：之前的会话就此结束。 */
  begin(): PageSession;
  /** 还原整页：停观察器、撤回页面上全部渲染，当前会话结束。 */
  restore(): void;
  /** 最近一次 begin() 的会话；还原之后、或从没开始过时为 null。 */
  current(): PageSession | null;
}

export function createPageTranslation<U extends object, Ctx>(dom: PageDom<U, Ctx>): PageTranslation {
  let current: (PageSession<Ctx> & { end(): void }) | null = null;
  return {
    hasTranslated: () => dom.hasTranslated(),
    readUnits: () => dom.collectReadOnly().map((u) => dom.build(u).text),
    begin() {
      current?.end();
      current = createSession(dom);
      return current;
    },
    restore() {
      current?.end();
      current = null;
      dom.unrenderAll();
    },
    current: () => current,
  };
}

function createSession<U extends object, Ctx>(dom: PageDom<U, Ctx>): PageSession<Ctx> & { end(): void } {
  const skips = emptySkipStats();
  const handedOut = new WeakSet<U>();
  const reported = new WeakSet<U>();
  const rounds: RenderStats[] = [];
  /** 翻译项 → 它所在的那一轮（批次里拿到的是同一批对象）。 */
  const roundOf = new WeakMap<object, RenderStats>();
  /** 观察器启动前采集到的隐藏单元（#332，弱引用 #330）。 */
  const preStartHidden = new Set<WeakRef<U>>();
  /** 已进缓冲的单元：首轮与补采集各轮都会再报一次同一个隐藏单元，只缓冲一份。 */
  const buffered = new WeakSet<U>();
  let observer: PageObserver<U> | null = null;
  let ended = false;

  const onHidden = (unit: U) => {
    if (observer) observer.registerHidden(unit);
    else if (!ended && !buffered.has(unit)) {
      buffered.add(unit);
      preStartHidden.add(new WeakRef(unit));
    }
  };

  const collectRound = (): TranslateItem<Ctx>[] => {
    const stats = emptyRenderStats();
    rounds.push(stats);
    const units = dom.collect((unit, category) => {
      if (reported.has(unit)) return;
      reported.add(unit);
      countSkip(skips, category);
    }, onHidden);
    const fresh = units.filter((u) => !handedOut.has(u));
    for (const u of fresh) handedOut.add(u);
    const items = fresh.map((u) => dom.build(u));
    for (const item of items) roundOf.set(item, stats);
    return items;
  };

  const onBatch = (batch: TranslateItem<unknown>[], result: TranslateBatchResult): void => {
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
  };

  /** #328: 观察器只在整页翻译成功后启动恰好一次；补挂启动前登记的隐藏单元。 */
  const startObserver = (): void => {
    if (observer || ended) return;
    observer = dom.observe();
    for (const ref of preStartHidden) {
      const unit = ref.deref();
      if (unit) observer.registerHidden(unit);
    }
    preStartHidden.clear();
  };

  /**
   * 补采集（#1011）：再采一次，交出来的单元走同一条批次流水线。还原：每轮开始前
   * 看信号，每批放行时由闸门里的中止判定拦下（#1007）。补采集自身的失败不回写
   * 整页的结论 —— 首轮已经成功的段落照常显示。
   *
   * #1013：补完一轮再查一次，有新的接着补，最多 RECOLLECT_MAX_ROUNDS 轮；某一轮
   * 没有新单元就结束。第一轮紧接首轮，之后每轮先等 RECOLLECT_INTERVAL_MS。
   *
   * #1036：返回是否补满了轮数。补满时最后一轮采集之后、它的译文回来之前进 DOM
   * 的内容，补采集不再采、观察器启动前也看不到，由到顶交接接上；提前结束（某轮
   * 为空、中止、失效）时没有这段窗口。
   */
  const recollect = async (ctx: PageRunContext): Promise<boolean> => {
    for (let round = 1; round <= RECOLLECT_MAX_ROUNDS; round++) {
      // #1073：轮间等待可被还原打断
      if (round > 1) await sleepUnlessAborted(RECOLLECT_INTERVAL_MS, ctx.signal, ctx.sleep);
      if (ctx.signal.aborted) return false;
      const more = collectRound();
      if (more.length === 0) return false;
      console.info(`[PT] 补采集第 ${round} 轮：${more.length} 个新单元`);
      const summary = await ctx.translate(more, { signal: ctx.signal, onBatch, admitted: true });
      if (summary.abandoned || summary.invalidated) return false;
    }
    return true;
  };

  return {
    collectRound,

    async run(ctx) {
      const list = collectRound();
      if (list.length === 0) return { status: 'no-elements' };
      ctx.onState('loading');
      const summary = await ctx.translate(list, { signal: ctx.signal, onBatch });
      // #1077：读首轮自己的统计 —— 不被补翻、另一路增量补翻清零或叠加
      // #327/#416: 引擎返回结果但全部渲染被拒 → 错误态；有段落失败时不算
      const status = summary.abandoned
        ? 'abandoned'
        : summary.allFailed || allRenderBlocked(rounds[0]!)
          ? 'error'
          : 'translated';
      // #327: 中止（还原）→ 空闲态；失败 → 错误态。#1012：成功的完成态等补采集
      // 结束才推 —— 先报完成、下半页却还在翻，正是 #1003 最让人困惑的地方
      if (status !== 'translated') {
        ctx.onState(status === 'error' ? 'error' : 'idle');
        return { status, summary };
      }
      // #1073：部分批次成功后判了失效 —— 已经翻好的照常显示，失效原因由提示
      // 说明；不再补采集、不启动观察器，接着发只会再失效
      if (summary.invalidated) {
        ctx.onState('done');
        return { status, summary };
      }
      // #1011：补采集。触发条件与观察器启动一致（只有判为成功才补），页面级
      // 闸门与准入不重判
      const capped = await recollect(ctx);
      // 补采集期间用户点了还原：还原已经推过空闲态、停了观察器，这里不再推
      // 完成态、不再启动
      if (ctx.signal.aborted) return { status: 'abandoned', summary };
      ctx.onState('done');
      // #1036：补满了轮数时在启动观察器的同一个同步段里再采一次，交给增量补翻。
      // 采集与启动之间没有 await，页面脚本插不进来：这一刻之前进 DOM 的由这次
      // 采集接住，之后的由观察器接住，同一个节点不会两边各翻一次
      const handoff = capped ? collectRound() : [];
      startObserver();
      if (handoff.length > 0) {
        console.info(`[PT] 补采集到顶，交给观察器补翻：${handoff.length} 个新单元`);
        // #1078：到顶交接被等待；它自身的失败不回写整页的结论
        try {
          await ctx.translate(handoff, { signal: ctx.signal, onBatch, admitted: true });
        } catch (e) {
          console.error('[PT] 补采集到顶后的补翻失败:', e);
        }
      }
      return { status, summary };
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

    /** 会话结束（还原、新的一次开始）：停观察器（幂等）。 */
    end() {
      ended = true;
      observer?.stop();
      observer = null;
      preStartHidden.clear();
    },
  };
}
