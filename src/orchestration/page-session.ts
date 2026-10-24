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
// - 增量补翻（#1118）：观察器交出的新单元由会话去重、送翻、渲染、记统计（单独
//   一轮），结局经 onIncremental 报出；内容脚本据此给失败提示。
// - 还原：停观察器、撤回页面上全部渲染。
// - 状态流（#1079）：悬浮球该显示什么 —— 进行中、完成、已还原（空闲）、失败 ——
//   由这里发出，悬浮球只订阅它。补采集真正结束后才报完成（#1012）。

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
  /**
   * 启动增量补翻观察器（整页翻译成功后，#328）：之后进入 DOM 的新单元、展开的
   * 隐藏单元经 onUnits 交回会话（#1118）。
   */
  observe(onUnits: (units: U[]) => void): PageObserver<U>;
}

/** 编排模块的批次流水线（准入、切批、闸门、发送、重试）。 */
export type PagePipeline = (
  items: TranslateItem<unknown>[],
  opts: {
    /**
     * 外层运行的信号；没有时从页面根派生 —— 增量补翻在整页开关返回之后才发生，
     * 不跟着那一次运行，只随还原整页中止（#1118）
     */
    signal?: AbortSignal;
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
}

/**
 * 整页翻译的状态（#1079）：idle 空闲（没翻、已还原、翻译中被放弃，不是错误），
 * loading 进行中，done 完成（补采集结束之后），error 失败（全部引擎失败、全部
 * 渲染被拒）。
 */
export type PageState = PageToggleVisual;

/** 一次整页翻译的结局。 */
export type PageRunOutcome =
  | { status: 'no-elements' }
  | { status: 'translated' | 'error' | 'abandoned'; summary: PageTranslateSummary };

/**
 * 一次增量补翻的结局（#1118）：translated 照常（可能有段落失败，看 stats），
 * error 全部批次失败，abandoned 被放弃（页面根中止，不提示）。准入拦下、会话已经
 * 结束（还原整页、新的一次开始）时不报。
 */
export interface IncrementalOutcome {
  status: 'translated' | 'error' | 'abandoned';
  summary: PageTranslateSummary;
  /** 这一次补翻自己那一轮的渲染统计 */
  stats: RenderStats;
}

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
  /** 订阅状态流（#1079）：悬浮球据此显示进度与完成。返回退订函数。 */
  subscribe(listener: (state: PageState) => void): () => void;
  /** 这一次不翻（页面级闸门判定本页已是目标语言，#793）：报空闲。 */
  decline(): void;
  /** 订阅增量补翻的结局（#1118）：失败提示与首轮同一套判定。返回退订函数。 */
  onIncremental(listener: (outcome: IncrementalOutcome) => void): () => void;
}

export function createPageTranslation<U extends object, Ctx>(dom: PageDom<U, Ctx>): PageTranslation {
  let current: (PageSession<Ctx> & { end(): void }) | null = null;
  const listeners = new Set<(state: PageState) => void>();
  const emit = (state: PageState) => {
    for (const l of [...listeners]) l(state);
  };
  const incrementalListeners = new Set<(outcome: IncrementalOutcome) => void>();
  const emitIncremental = (outcome: IncrementalOutcome) => {
    for (const l of [...incrementalListeners]) l(outcome);
  };
  return {
    hasTranslated: () => dom.hasTranslated(),
    readUnits: () => dom.collectReadOnly().map((u) => dom.build(u).text),
    begin() {
      current?.end();
      current = createSession(dom, emit, emitIncremental);
      return current;
    },
    restore() {
      current?.end();
      current = null;
      dom.unrenderAll();
      // #327: 还原后报空闲（不是错误）
      emit('idle');
    },
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    decline() {
      // #793：推成完成态是在骗人，用户再点一次也会困惑
      emit('idle');
    },
    onIncremental(listener) {
      incrementalListeners.add(listener);
      return () => incrementalListeners.delete(listener);
    },
  };
}

function createSession<U extends object, Ctx>(
  dom: PageDom<U, Ctx>,
  emit: (state: PageState) => void,
  emitIncremental: (outcome: IncrementalOutcome) => void,
): PageSession<Ctx> & { end(): void } {
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
  /** 这一次整页翻译的批次流水线：增量补翻在整页开关返回之后还要用它送翻。 */
  let translate: PagePipeline | null = null;
  /**
   * 正在送翻、结果还没回来的单元（#1118，增量补翻的去重口径）。观察器只交出页面上
   * 没有译文的单元：翻好的不会再来，在飞的还没落完成标记，可能再交一次。
   */
  const inFlight = new WeakSet<U>();
  /** 翻译项 → 它的单元。 */
  const unitOf = new WeakMap<object, U>();

  const onHidden = (unit: U) => {
    if (observer) observer.registerHidden(unit);
    else if (!ended && !buffered.has(unit)) {
      buffered.add(unit);
      preStartHidden.add(new WeakRef(unit));
    }
  };

  /** 开一轮新的统计，把这些单元做成翻译项，记进这一轮。 */
  const takeRound = (fresh: U[]): TranslateItem<Ctx>[] => {
    const stats = emptyRenderStats();
    rounds.push(stats);
    for (const u of fresh) handedOut.add(u);
    const items = fresh.map((u) => {
      const item = dom.build(u);
      roundOf.set(item, stats);
      unitOf.set(item, u);
      return item;
    });
    return items;
  };

  /** 送翻一轮：期间这些单元算在飞，结束后（含放弃、失效）不再算。 */
  const sendRound = async (
    pipeline: PagePipeline,
    items: TranslateItem<Ctx>[],
    opts: Parameters<PagePipeline>[1],
  ): Promise<PageTranslateSummary> => {
    const units = items.map((item) => unitOf.get(item)!);
    for (const u of units) inFlight.add(u);
    try {
      return await pipeline(items, opts);
    } finally {
      for (const u of units) inFlight.delete(u);
    }
  };

  /** 采集一轮：只交出这个会话还没交出过的单元（#1011、#1056）。 */
  const collectRound = (): TranslateItem<Ctx>[] =>
    takeRound(
      dom
        .collect((unit, category) => {
          if (reported.has(unit)) return;
          reported.add(unit);
          countSkip(skips, category);
        }, onHidden)
        .filter((u) => !handedOut.has(u)),
    );

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

  /**
   * 增量补翻（#1118，原在内容脚本）：观察器交出的新单元单独记一轮，走同一条
   * 批次流水线。准入照常重判（扩展关掉、站点拉黑之后不再补翻）；信号从页面根
   * 派生，还原整页让在飞的这一次放弃、译文不落 DOM。正在送翻的单元不再送一次；
   * 翻好之后页面改写了原文的单元（观察器撤回渲染再交回来，#179）照常重翻。
   */
  const incremental = async (units: U[]): Promise<void> => {
    if (ended || !translate) return;
    const fresh = units.filter((u) => !inFlight.has(u));
    if (fresh.length === 0) return;
    const items = takeRound(fresh);
    const stats = rounds[rounds.length - 1]!;
    const summary = await sendRound(translate, items, { onBatch });
    // 准入拦下不报；会话已经结束（还原、新的一次开始）的也不报 —— 结局是这一次的
    if (summary.admission !== 'allowed' || ended) return;
    const status = summary.abandoned ? 'abandoned' : summary.allFailed ? 'error' : 'translated';
    emitIncremental({ status, summary, stats });
  };

  /** #328: 观察器只在整页翻译成功后启动恰好一次；补挂启动前登记的隐藏单元。 */
  const startObserver = (): void => {
    if (observer || ended) return;
    observer = dom.observe((units) => {
      incremental(units).catch((e) => console.error('[PT] 增量补翻失败:', e));
    });
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
      const summary = await sendRound(ctx.translate, more, { signal: ctx.signal, onBatch, admitted: true });
      if (summary.abandoned || summary.invalidated) return false;
    }
    return true;
  };

  return {
    collectRound,

    async run(ctx) {
      translate = ctx.translate;
      const list = collectRound();
      if (list.length === 0) return { status: 'no-elements' };
      emit('loading');
      const summary = await sendRound(ctx.translate, list, { signal: ctx.signal, onBatch });
      // #1077：读首轮自己的统计 —— 不被补翻、增量补翻叠加
      // #327/#416: 引擎返回结果但全部渲染被拒 → 错误态；有段落失败时不算
      const status = summary.abandoned
        ? 'abandoned'
        : summary.allFailed || allRenderBlocked(rounds[0]!)
          ? 'error'
          : 'translated';
      // #327: 中止（还原）→ 空闲态；失败 → 错误态。#1012：成功的完成态等补采集
      // 结束才推 —— 先报完成、下半页却还在翻，正是 #1003 最让人困惑的地方
      if (status !== 'translated') {
        emit(status === 'error' ? 'error' : 'idle');
        return { status, summary };
      }
      // #1073：部分批次成功后判了失效 —— 已经翻好的照常显示，失效原因由提示
      // 说明；不再补采集、不启动观察器，接着发只会再失效
      if (summary.invalidated) {
        emit('done');
        return { status, summary };
      }
      // #1011：补采集。触发条件与观察器启动一致（只有判为成功才补），页面级
      // 闸门与准入不重判
      const capped = await recollect(ctx);
      // 补采集期间用户点了还原：还原已经推过空闲态、停了观察器，这里不再推
      // 完成态、不再启动
      if (ctx.signal.aborted) return { status: 'abandoned', summary };
      emit('done');
      // #1036：补满了轮数时在启动观察器的同一个同步段里再采一次，交给增量补翻。
      // 采集与启动之间没有 await，页面脚本插不进来：这一刻之前进 DOM 的由这次
      // 采集接住，之后的由观察器接住，同一个节点不会两边各翻一次
      const handoff = capped ? collectRound() : [];
      startObserver();
      if (handoff.length > 0) {
        console.info(`[PT] 补采集到顶，交给观察器补翻：${handoff.length} 个新单元`);
        // #1078：到顶交接被等待；它自身的失败不回写整页的结论
        try {
          await sendRound(ctx.translate, handoff, { signal: ctx.signal, onBatch, admitted: true });
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
