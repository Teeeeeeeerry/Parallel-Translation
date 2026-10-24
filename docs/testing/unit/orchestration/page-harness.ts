/**
 * 测试装配：用现成的翻译项搭“整页翻译”（#1078）
 *
 * #1078 起整页开关入口只收整页翻译对象（src/orchestration/page-session.ts），
 * 翻译态查询、还原、观察器启停都在它的 DOM 原语里，不再是编排模块的选项。
 * 很多用例只关心编排模块的行为（准入、闸门、在飞互斥、切批、状态推送），用的
 * 是现成的翻译项与这几个钩子。这里把它们转成一个整页翻译对象：单元就是翻译项
 * 本身，渲染由 allRenderRejected 决定成败，其余钩子原样接到对应的原语上。会话
 * 自己的逻辑（去重、补采集、到顶交接、观察器）照常是真的。
 *
 * 真实采集与渲染原语的用例见 page-session.test.ts。
 */
import {
  createOrchestrator as createRealOrchestrator,
  type OrchestratorOptions,
  type TranslateItem,
  type TranslationOrchestrator,
  type PageToggleVisual,
} from '~/src/orchestration/orchestrator';
import { createPageTranslation, type PageTranslation } from '~/src/orchestration/page-session';
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
}

/** 旧装配里写在编排模块选项上的状态推送（#1079 起是整页翻译会话的状态流）。 */
export interface StatusHooks {
  /** 悬浮球该显示的状态；isMainFrame 为假时不推（子框架不显示，#327） */
  pushStatus?: (status: PageToggleVisual) => void;
}

const isPage = (x: unknown): x is PageTranslation =>
  typeof x === 'object' && x !== null && 'begin' in x && 'restore' in x;

/** 用翻译项搭一个整页翻译；source 可以随后换（itemsPage 返回的 setSource）。 */
export function itemsPage(source: ItemsSource, hooks: PageHooks = {}): PageTranslation & { setSource(s: ItemsSource): void } {
  // 闸门取样读最近一次交进来的翻译项；一次整页翻译开始（begin）时定下它采集用的
  // 那一份 —— 在飞期间又调了一次 togglePage（忙碌、还原）不会换掉在飞那一次的
  let pending = source;
  let active = source;
  const list = (src: ItemsSource, mode?: { readOnly: boolean }) => (typeof src === 'function' ? src(mode) : src);
  const page = createPageTranslation<TranslateItem<unknown>, unknown>({
    collect: () => list(active),
    collectReadOnly: () => list(pending, { readOnly: true }),
    build: (u) => u,
    render: () => (hooks.allRenderRejected?.() ? { rendered: false, reason: 'non-text-content' } : { rendered: true }),
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
  return Object.assign(page, { setSource: (s: ItemsSource) => (pending = s) });
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
    unrenderAll: () => restorePage(),
    hasTranslated: () => hasTranslated(),
    observe: () => ({ stop: () => {}, registerHidden: () => {} }),
  });
}

/**
 * 旧的装配方式：钩子写在编排模块的选项里，togglePage 传翻译项。同一个编排模块
 * 共用一个整页翻译对象（还原要停的是上一次启动的观察器），每次 togglePage 换上
 * 这一次的翻译项；传的已经是整页翻译对象时原样交给编排模块。
 */
export function createOrchestrator(
  opts: OrchestratorOptions & PageHooks & StatusHooks,
): Omit<TranslationOrchestrator, 'togglePage'> & {
  togglePage(items: ItemsSource | PageTranslation, from: string, to: string): ReturnType<TranslationOrchestrator['togglePage']>;
} {
  const { hasTranslated, restore, onObserverStart, onObserverStop, allRenderRejected, pushStatus, ...rest } = opts;
  const orch = createRealOrchestrator(rest);
  const page = itemsPage([], { hasTranslated, restore, onObserverStart, onObserverStop, allRenderRejected });
  // #1079：状态流由整页翻译发出；与 content 一样只在主框架订阅
  const subscribed = new WeakSet<PageTranslation>();
  const watch = (p: PageTranslation) => {
    if (!pushStatus || subscribed.has(p)) return;
    subscribed.add(p);
    p.subscribe((s) => {
      if (opts.isMainFrame?.() !== false) pushStatus(s);
    });
  };
  return {
    start: () => orch.start(),
    stop: () => orch.stop(),
    abort: () => orch.abort(),
    translatePage: (...args) => orch.translatePage(...args),
    translateText: (...args) => orch.translateText(...args),
    detectedLang: () => orch.detectedLang(),
    togglePage(items, from, to) {
      const target = isPage(items) ? items : (page.setSource(items), page);
      watch(target);
      return orch.togglePage(target, from, to);
    },
  };
}
