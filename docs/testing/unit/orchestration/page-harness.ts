/**
 * 测试装配：用现成的翻译项搭“整页翻译”（#1078）
 *
 * #1078 起整页开关入口只收整页翻译对象（src/orchestration/page-session.ts），
 * 翻译态查询、还原、观察器启停都在它的 DOM 原语里，不是编排模块的选项。
 * 很多用例只关心编排模块的行为（准入、闸门、在飞互斥、切批），用的是现成的
 * 翻译项与这几个钩子。itemsPage 用它们直接搭一个整页翻译对象：单元就是翻译项
 * 本身，渲染由 allRenderRejected 决定成败，其余钩子接到对应的原语上。会话自己
 * 的逻辑（去重、补采集、到顶交接、观察器、状态流）照常是真的。用例自己创建
 * 编排模块，把这个对象交给 togglePage；状态流用 page.subscribe 订阅（#1117）。
 *
 * 真实采集与渲染原语的用例见 page-session.test.ts。
 */
import type {
  BatchCallback,
  PageToggleResult,
  PageTranslateSummary,
  TranslateItem,
  TranslationOrchestrator,
} from '~/src/orchestration/orchestrator';
import {
  createPageTranslation,
  type PagePipeline,
  type PageTranslation,
} from '~/src/orchestration/page-session';
import { emptyRenderStats, emptySkipStats } from '~/src/orchestration/page-summary';
import { collect, type SkipCategory } from '~/src/dom/walker';
import { render } from '~/src/dom/renderer';
import { hasTranslated, restorePage } from '~/src/dom/page-dom';

/** 现成的翻译项，或按需交出翻译项的函数（收到 readOnly 时是闸门取样）。 */
export type ItemsSource =
  | TranslateItem<unknown>[]
  | ((mode?: { readOnly: boolean }) => TranslateItem<unknown>[]);

export interface PageHooks {
  /** 页面上有没有译文 */
  hasTranslated?: () => boolean;
  /** 撤回页面上全部渲染 */
  restore?: () => void;
  /** 观察器启动（整页翻译成功后，#328） */
  onObserverStart?: () => void;
  /** 观察器停止（还原时，启动过才停） */
  onObserverStop?: () => void;
  /** 为真时每个单元都被渲染层拒绝（#327） */
  allRenderRejected?: () => boolean;
  /** 每渲染一个单元调一次（批次里按顺序），在 allRenderRejected 判定之前 */
  onRender?: (item: TranslateItem<unknown>, translation: string) => void;
}

/** itemsPage 搭出的整页翻译：可以换上下一次要翻的翻译项。 */
export type ItemsPage = PageTranslation & {
  /** 换上下一次 togglePage 要翻的翻译项，返回这个整页翻译本身 */
  withSource(s: ItemsSource): ItemsPage;
};

/** 用翻译项搭一个整页翻译；source 可以随后换（withSource）。 */
export function itemsPage(source: ItemsSource = [], hooks: PageHooks = {}): ItemsPage {
  // 闸门取样读最近一次交进来的翻译项；一次整页翻译开始（begin）时定下它采集用的
  // 那一份 —— 在飞期间又调了一次 togglePage（忙碌、还原）不会换掉在飞那一次的
  let pending = source;
  let active = source;
  const list = (src: ItemsSource, mode?: { readOnly: boolean }) => (typeof src === 'function' ? src(mode) : src);
  const page = createPageTranslation<TranslateItem<unknown>, unknown>({
    collect: () => list(active),
    collectReadOnly: () => list(pending, { readOnly: true }),
    build: (u) => u,
    render: (item, translation) => {
      hooks.onRender?.(item, translation);
      return hooks.allRenderRejected?.() ? { rendered: false, reason: 'non-text-content' } : { rendered: true };
    },
    unrenderAll: () => hooks.restore?.(),
    hasTranslated: () => hooks.hasTranslated?.() ?? false,
    observe: () => {
      hooks.onObserverStart?.();
      return { stop: () => hooks.onObserverStop?.(), registerHidden: () => {} };
    },
  });
  const begin = page.begin.bind(page);
  page.begin = () => {
    active = pending;
    return begin();
  };
  const self: ItemsPage = Object.assign(page, {
    withSource: (s: ItemsSource) => {
      pending = s;
      return self;
    },
  });
  return self;
}

/**
 * 真实 DOM 原语搭的整页翻译，与 content script 同一口径：采集用 walker 的
 * collect（或用例给的采集），渲染用 renderer 的 render，还原与翻译态查询用
 * page-dom 的真实实现（#1116，含切块还原）。统计与跳过从 page.current() 读。
 */
export function domPage(
  opts: {
    collect?: (onSkip: (el: Element, category: SkipCategory) => void) => Element[];
    build?: (el: Element) => TranslateItem<Element>;
  } = {},
): PageTranslation {
  return createPageTranslation<Element, Element>({
    collect: opts.collect ?? ((onSkip, onHidden) => collect(document.body, onHidden, { onSkip })),
    collectReadOnly: () => collect(document.body, undefined, { readOnly: true }),
    build: opts.build ?? ((el) => ({ text: el.textContent!, ctx: el })),
    render: (item, translation) => render(item.ctx, translation, 'page', item.text),
    unrenderAll: restorePage,
    hasTranslated,
    observe: () => ({ stop: () => {}, registerHidden: () => {} }),
  });
}

/** 每个编排模块、每对语言经整页开关拿到的流水线（同时来的几次共用一次拿取）。 */
const pipelines = new WeakMap<TranslationOrchestrator, Map<string, Promise<PagePipeline | PageToggleResult>>>();

/** 经一次整页开关拿到编排模块交给会话的批次流水线；被准入拦下时返回开关的结果。 */
async function pipelineOf(orch: TranslationOrchestrator, from: string, to: string): Promise<PagePipeline | PageToggleResult> {
  let byLang = pipelines.get(orch);
  if (!byLang) pipelines.set(orch, (byLang = new Map()));
  const key = `${from}>${to}`;
  const cached = byLang.get(key);
  if (cached) return cached;
  let pipeline: PagePipeline | null = null;
  const probe: PageTranslation = {
    hasTranslated: () => false,
    readUnits: () => [],
    begin: () => ({
      run: async (ctx) => {
        pipeline = ctx.translate;
        return { status: 'no-elements' };
      },
      collectRound: () => [],
      roundStats: () => emptyRenderStats(),
      totals: () => emptyRenderStats(),
      skips: () => emptySkipStats(),
    }),
    restore: () => {},
    current: () => null,
    subscribe: () => () => {},
    decline: () => {},
    onIncremental: () => () => {},
  };
  const got = orch.togglePage(probe, from, to).then((result) => {
    if (pipeline) return pipeline;
    // 准入拦下的不留：设置改了之后再来要重新拿
    byLang.delete(key);
    if (result.status === 'disabled' || result.status === 'blocked') return result;
    throw new Error(`[harness] 没拿到批次流水线：整页开关返回 ${result.status}`);
  });
  byLang.set(key, got);
  return got;
}

/**
 * 直接跑一遍批次流水线（#1118 起编排模块只有 togglePage 一个整页入口）：经一次
 * 整页开关拿到它交给会话的流水线（每个编排模块每对语言拿一次），再像增量补翻
 * 那样送翻 —— 准入照常重判，信号从页面根派生（还原整页、abort 让它放弃）。管的
 * 是切批、闸门、重试、放弃、失效与领域这些流水线自己的行为，用不着采集、补采集
 * 与观察器。
 */
export async function translateItems(
  orch: TranslationOrchestrator,
  items: TranslateItem<unknown>[],
  from: string,
  to: string,
  opts: { onBatch?: BatchCallback } = {},
): Promise<PageTranslateSummary> {
  const pipeline = await pipelineOf(orch, from, to);
  if (typeof pipeline !== 'function') {
    return {
      admission: pipeline.admission,
      allFailed: false,
      abandoned: false,
      invalidated: false,
      fatalError: null,
      display: { showRealReason: false },
    };
  }
  return pipeline(items, { onBatch: opts.onBatch ?? (() => {}) });
}
