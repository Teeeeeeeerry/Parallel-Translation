// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译编排模块 —— #221 架构评审候选 1。
//
// content 入口（约 585 行）一个闭包同时承担：翻译编排（批次拆分、
// 中止、渐进渲染）、UI 生命周期、消息路由 —— 编排逻辑完全
// 没有单元测试，e2e 之外无法触达。本模块把编排收在小 interface
// 后面（启动 / 停止 / 翻译入口），消息发送与渲染以回调注入，不直接
// 触碰 chrome 全局，测试用假消息层即可断言批次拆分、回调次数与
// 渐进渲染节奏。
//
// 演进：骨架与批次拆分（#245）→ 渐进渲染回调（#256）→ content
// 装配切换（#261）→ epoch 中止语义迁入（#262）→ 放弃收进“翻译运行”
// 模块，纪元计数删除（#1066）。

import type {
  TranslateRequest,
  TranslateResponse,
  FailureCategory,
} from '~/src/engines/types';
import type { Settings } from '~/src/storage/schema';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import { currentDomain } from '~/src/storage/domains';
import type { Domain, DomainChoice } from '~/src/storage/domains';
import { isSiteBlocked } from '~/src/dom/site-filter';
import { judgePage, type ContentLang, type PageGateDecision } from './page-gate';
import type { PageTranslation } from './page-session';
// #1078：补采集的轮数与间隔归整页翻译会话；这里转出，旧的引用不必改
export { RECOLLECT_MAX_ROUNDS, RECOLLECT_INTERVAL_MS } from './page-session';
import { normalizeLangCode } from './lang-code';
import { attemptBatchWithRetry } from '~/src/runtime/batch-retry';
import {
  createTranslationRuns,
  isAbandoned,
  RunInvalidated,
  type RunRoot,
} from '~/src/orchestration/translation-run';
import { sleepUnlessAborted } from '~/src/runtime/sleep';
import {
  displayDecision,
  singleTextMissNotice,
  type SingleTextMiss,
  type TextNotice,
} from '~/src/orchestration/text-notice';
import { sleep as defaultSleep } from '~/src/runtime/sleep';
import { createGate } from '~/src/queue/concurrency';

/**
 * 全页翻译与增量补翻的切批闸值（#1005，父 #1000）。原先按 15 个单元一批切，与
 * 单元多长无关：维基 F1 车手页 2053 个单元、文字中位数 5 字符，切出 137 批。
 *
 * 取值由实测定（#1006，docs/research/batch-char-budget.md）：
 * - 个数上限 20：Google 免 key 端点一条文本一个请求，content 侧闸门（#1007）之后
 *   一批大致独占一条引擎通道，单批耗时约等于条数乘单次请求耗时。单次实测约
 *   0.47 秒、慢网按 1 秒算，40 条就要 40 秒，超过 30 秒的单次响应超时；20 条在
 *   每次请求慢到 1.5 秒之前都不会超时。再小只多出往返次数，换不来什么。
 * - 字符预算 2000：Bing 单次上限是 1000 条、50000 字符（超了回 400，整批失败），
 *   单次耗时随字数涨，4.7 万字一个请求要 11 秒；LLM 引擎把全部条目拼进同一条
 *   提示，输出时长同样跟字数走。2000 字下三种形态的整页耗时都在几秒，再放大只
 *   省长段落页面的往返次数，再缩小则长段落、混合页面的批次数翻倍。
 */
export const FULL_PAGE_BATCH_LIMITS: BatchLimits = { maxItems: 20, maxChars: 2000 };

/** 翻译项：文本 + 调用方携带的渲染/还原上下文（#245 保持与现状同构）。 */
export interface TranslateItem<TCtx> {
  text: string;
  ctx: TCtx;
}

/** 消息发送回调 —— 注入假消息层即可单测，模块不直接触碰 chrome。 */
/**
 * 消息发送层。#1001：第二个参数带一个中止信号，编排模块放弃这一批（还原、
 * 失效短路）时触发，发送层据此通知后台中止对应的引擎调用。
 */
export type SendTranslate = (req: TranslateRequest, ctl?: { signal: AbortSignal }) => Promise<unknown>;

/** 单批发送结果（#256）：渲染层按批消费，批次间不互相等待。 */
export interface TranslateBatchResult {
  ok: boolean;
  data?: TranslateResponse;
  error?: string;
  invalidated?: boolean;
  retryable?: boolean;
  category?: FailureCategory;
  aborted?: boolean;
  /** #579: 扩展上下文失效（区别于同样置 invalidated 的配额耗尽）。 */
  contextInvalidated?: boolean;
}

/** 全页翻译的批次结果汇总（#261）：content 据此映射页面状态。 */
export interface PageTranslateSummary {
  /** 准入结果（#311）：未通过准入时零请求，调用方据此映射状态与提示。 */
  admission: Admission;
  /** 是否所有非中止批次均失败。 */
  allFailed: boolean;
  /**
   * 这一次被放弃（还原整页、外层运行中止，#1074）—— 不是失败，调用方不提示。
   * 失效（上下文失效、配额耗尽）不算放弃，看 invalidated。
   */
  abandoned: boolean;
  /** 上下文 / 配额失效（全局短路）。 */
  invalidated: boolean;
  /** 全失败时的致命原因（失效 / 类别化错误），供 toast 展示。 */
  fatalError: string | null;
  /** 提示语义（#313）：全失败时展示真实原因还是泛化文案。 */
  display: FailureDisplay;
}

/**
 * 翻译入口准入结果（#311）—— 总开关与站点名单判定：
 *   - allowed：放行
 *   - disabled：总开关关闭，不发请求
 *   - blocked：站点在黑名单中（或白名单未命中），不发请求
 */
export type Admission = 'allowed' | 'disabled' | 'blocked';

/**
 * 单文本翻译结果（#312）—— 逐段、划词、输入翻译共用。#1075：二选一 —— 成功带
 * 译文；没拿到译文时带要显示的提示，或 null（不提示）。提示怎么定见
 * text-notice 的 singleTextMissNotice，调用方原样显示。
 */
export type SingleTextResult =
  | {
      ok: true;
      /** 译文 —— 引擎结果逐字透传，模块不改写。 */
      translation: string;
    }
  | {
      ok: false;
      /** 要显示的提示；null 时不提示（总开关关闭、被放弃、子框架里的站点禁用）。 */
      notice: TextNotice | null;
      /** 这一次被放弃（#1074）：页面还原、调用方中止，或后台报了已中止。 */
      abandoned?: true;
    };

/**
 * 失败提示语义（#313）——「展示引擎给出的真实原因，还是展示泛化文案」
 * 的决定由失败类别映射，在模块内构造一次，整页与单文本入口共用。
 * 模块不触碰任何 UI，提示的渲染仍由调用方完成。
 */
export interface FailureDisplay {
  /** true：展示真实原因（key 无效 / 配额耗尽）；false：展示泛化文案（瞬时）。 */
  showRealReason: boolean;
  /** 引擎给出的原因文本（showRealReason=true 时）。 */
  reason?: string;
}

/** 翻译编排模块 —— 小 interface：启动 / 停止 / 翻译入口（#221）。 */
export interface TranslationOrchestrator {
  /** 启动编排（设置变更响应等初始化）。 */
  start(): void;
  /** 停止编排（清理订阅与在飞状态）。 */
  stop(): void;
  /**
   * 中止在途翻译（#262）—— 中止页面根（#1066）：在飞批次的尝试、重试与
   * 渲染回调全部放弃，过期译文不落 DOM；新翻译不受旧批次干扰。
   */
  abort(): void;
  /**
   * 全页翻译入口：按批次拆分发送，每批返回即触发渲染回调（#256）；
   * 批次级失败有界重试、失效全局短路、放弃判定都在模块内
   * （#261 / #262）。
   */
  translatePage(
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
    /**
     * #1078：onBatch 是这一次的渲染（增量补翻自己的统计）；onBatchResult 照常
     * 收到每一批的通知
     */
    pageOpts?: { onBatch?: (batch: TranslateItem<unknown>[], result: TranslateBatchResult) => void },
  ): Promise<PageTranslateSummary>;
  /**
   * 单文本翻译入口（#312）—— 供逐段翻译与划词翻译使用。
   * 复用整页入口的准入判定（#311）：站点被屏蔽、总开关关闭均零请求；
   * 请求与整页入口一样携带当前领域（#383/#384）；
   * 成功时返回译文（引擎结果逐字透传，模块不改写）。
   */
  translateText(
    text: string,
    from: string,
    to: string,
    textOpts?: SingleTextOptions,
  ): Promise<SingleTextResult>;
  /**
   * 本 frame 最近一次翻译时引擎报告的检测语言（#659），已归一化为小写
   * 语言码主段；还没有时为 null。
   *
   * 整页翻译的成功批次与声明了 recordDetectedLang 的单文本翻译（逐段翻译）
   * 会更新它；引擎不提供或给出认不出的值时保留上一次的结果。只记在本模块
   * 的内存里，不进任何存储 —— 每个 frame 各有一个编排模块实例。默认引擎
   * google-web 不返回检测语言，只有 bing-edge 与 deepl 返回。
   */
  detectedLang(): string | null;
  /**
   * 整页开关入口（#325）—— 一次调用完成「查询当前翻译态 → 决定
   * 翻译还是还原 → 执行」。#1078：翻译态查询、还原、采集、渲染、补采集、
   * 观察器都在整页翻译会话里（page），模块不触碰 DOM；这里保留在飞互斥、
   * 准入、页面级闸门的调用、切批与发送。
   */
  togglePage(page: PageTranslation, from: string, to: string): Promise<PageToggleResult>;
}

/** 单文本入口的选项（#659）。 */
export interface SingleTextOptions {
  /**
   * 成功后记下引擎报告的检测语言。逐段翻译送的是页面上的文字，声明为
   * true；输入翻译送的是用户自己写的文字，检测出来的是用户自己的语言，
   * 不能记 —— 所以默认不记录。
   */
  recordDetectedLang?: boolean;
  /**
   * 不走翻译缓存（#642）：既不查也不写。输入翻译声明为 true —— 发出去的
   * 句子几乎不会重复，缓存只会挤占阅读侧的额度；逐段翻译与划词翻译不声明。
   */
  noCache?: boolean;
  /**
   * 这次运行从哪个根派生（#1072，取代 #1044 的 keepOnRestore）。缺省 page：
   * 逐段与划词随页面还原作废，并通知后台中止。输入翻译声明 input —— 用户在
   * 输入框里点的翻译与页面的翻译态无关，还原整页时它照常翻完、照常写回。
   */
  root?: RunRoot;
  /**
   * 调用方自己的放弃信号（#1044）：划词又发起了新一轮，旧一轮的结果整条丢弃，
   * 由它通知后台中止。叠加在根上，任一中止这一次就报 abandoned。
   */
  signal?: AbortSignal;
}

/** 整页开关入口的结果（#325）。 */
export interface PageToggleResult {
  /** 实际执行的动作。 */
  status: PageToggleStatus;
  /** 准入结果（翻译分支）。 */
  admission: Admission;
  /** 翻译分支的批次汇总（错误提示 / display 决策用）。 */
  summary?: PageTranslateSummary;
  /** 页面级闸门命中时的判定、原因与依据（#792、#857，status 为 same-language）。 */
  gate?: Extract<PageGateDecision, { translate: false }>;
}

/**
 * 整页开关入口状态（#325/#326/#327 演进）：
 *   - translated：整页翻译完成
 *   - restored：已还原
 *   - disabled / blocked：准入拦截（零请求）
 *   - abandoned：翻译中被放弃（还原整页；不计失败，#1074 前叫 aborted）
 *   - error：全部引擎失败
 *   - no-elements：本页没有可翻译的内容
 *   - same-language：页面级闸门命中，本页已经是目标语言（#792，零请求）
 */
export type PageToggleStatus =
  | 'translated'
  | 'restored'
  | 'disabled'
  | 'blocked'
  | 'busy'
  | 'abandoned'
  | 'error'
  | 'no-elements'
  | 'same-language';

export interface OrchestratorOptions {
  /** 消息发送层（测试注入假层；content 注入 translateViaBackground）。 */
  send: SendTranslate;
  /** 切批闸值（#1005），缺省 FULL_PAGE_BATCH_LIMITS。整页与增量补翻共用。 */
  batchLimits?: BatchLimits;
  /** 注入 sleep 以便测试推进虚拟时钟；缺省共享实现。 */
  sleep?: (ms: number) => Promise<void>;
  /**
   * 每批结果的通知（#256 渐进渲染：每批返回即触发，首屏不等待最慢段）。#1078：
   * 渲染在整页翻译会话与增量补翻各自的 onBatch 里做，这里只是通知；没传
   * onBatch 的 translatePage 仍由它渲染。
   */
  onBatchResult?: (
    batchIndex: number,
    batch: TranslateItem<unknown>[],
    result: TranslateBatchResult,
  ) => void;
  /**
   * 设置变更订阅注入（#265）：content 传 storage 的 onSettingsChanged；
   * 模块在 start 时订阅、stop 时退订。
   * #310：回调携带真实设置类型，装配方不再需要强制转型。
   */
  subscribeSettings?: (fn: (s: Settings) => void) => () => void;
  /** 设置变更响应（#265）：样式应用与 UI 启停由调用方实现（经注册表）。 */
  onSettingsChange?: (s: Settings) => void;
  /**
   * 读取当前设置（#310）：模块自身不直接访问存储 ——
   * 准入判定等后续逻辑经此注入读取，装配方注入 storage 的 getSettings。
   */
  getSettings?: () => Settings;
  /**
   * 读取当前主机名（#311）：准入判定经此注入取得页面地址，
   * 模块不直接访问 location。
   */
  getHostname?: () => string;
  /**
   * 读取顶层页面的主机名（#471）：当前领域按顶层页面判定，一个标签页里
   * 所有 frame 得到同一个领域。站点名单的准入判定不用它，仍按
   * getHostname。未注入时回落到 getHostname（主文档二者相同）。
   */
  getTopHostname?: () => string;
  /**
   * 读取生效领域列表（#379）：全页翻译按当前主机名与目标语言从中
   * 选出当前领域，把领域 ID 放进翻译请求；未注入视同没有领域。
   */
  getDomains?: () => readonly Domain[];
  /**
   * 读取本标签页的临时领域选择（#400）：用户在 popup 里切换的领域或
   * “无领域”。未注入视同自动选择。
   */
  getDomainChoice?: () => DomainChoice;
  /**
   * 状态推送（#327）：悬浮球等视觉状态由模块单向推送 —— 模块不直接
   * 操作 UI。推送值见 PageToggleVisual；主框架标志为 false 时不推送。
   */
  pushStatus?: (status: PageToggleVisual) => void;
  /**
   * 主框架标志（#327）：子框架不推送状态、不产生提示，但照常执行翻译。
   */
  isMainFrame?: () => boolean;
  /**
   * 本 frame 页面的语言声明（`<html lang>` 的原值，#792）：页面级闸门的
   * 取数之一，经注入读取 —— 模块不触碰 DOM。未注入或没有声明时为 null。
   */
  getPageLang?: () => string | null;
  /**
   * 本地内容识别（#843）：对翻译单元的文字样本给出各语言占比，页面级闸门的
   * 第一级取数。调用方用浏览器自带的语言识别实现，零网络请求 —— 模块不碰
   * 浏览器接口。给不出结果时为 null（或抛错）：闸门当识别器拿不准，照常
   * 翻译（#889）；未注入时闸门回落到检测语言与声明。
   */
  detectContentLang?: (sample: string) => Promise<ContentLang | null>;
  /**
   * 页面级闸门每判一次就报一次判定（#857），带依据，照常翻译时也报。调用方
   * 拿来写控制台，排查时看得出走的是判定链的哪一级；不影响翻译流程。
   */
  onGateDecision?: (decision: PageGateDecision) => void;
}

/**
 * 整页开关的视觉状态（#327）—— 经 pushStatus 注入回调推送：
 *   - idle：空闲（还原完成 / 中止后回到空闲，不是错误）
 *   - loading：翻译在飞
 *   - done：已完成
 *   - error：全部引擎失败 / 全部渲染被拒
 */
export type PageToggleVisual = 'idle' | 'loading' | 'done' | 'error';

/**
 * 切批的两道闸（#1004）：一批的文字总长不超过 maxChars，条目数不超过 maxItems，
 * 谁先到按谁切。字符预算防的是少量长段落挤成一个巨大请求；个数上限防的是成千
 * 上万个一两个字的表格格子挤进同一批（引擎对单次条目数也有自己的限制）。
 * 文字长度按 String.length 计。
 */
export interface BatchLimits {
  maxItems: number;
  maxChars: number;
}

/**
 * 按两道闸切分翻译项（#245、#1004）。纯函数：不读设置、不碰 DOM。
 * 按原顺序贪心装批：当前批再装下一项会超过任一道闸就先收批。单个单元本身就
 * 超过字符预算时自成一批，绝不丢弃 —— 丢单元就是静默漏翻。
 */
export function splitBatches<T>(
  items: TranslateItem<T>[],
  limits: BatchLimits,
): TranslateItem<T>[][] {
  const batches: TranslateItem<T>[][] = [];
  let current: TranslateItem<T>[] = [];
  let chars = 0;
  for (const item of items) {
    const len = item.text.length;
    if (current.length > 0 && (current.length >= limits.maxItems || chars + len > limits.maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}


export function createOrchestrator(opts: OrchestratorOptions): TranslationOrchestrator {
  const batchLimits = opts.batchLimits ?? FULL_PAGE_BATCH_LIMITS;
  const sleepFn = opts.sleep ?? defaultSleep;
  const onBatchResult = opts.onBatchResult;
  let started = false;
  // #1066：翻译运行 —— 整页、补采集、到顶交接、逐段、划词从页面根派生信号，
  // 输入翻译从输入根派生。还原整页中止页面根：在飞翻译据此放弃尝试、重试与
  // 渲染，并通知后台中止（#1001）；之后的新翻译从新的页面根派生，不受旧批次
  // 干扰（取代 #262 的纪元计数）
  const runs = createTranslationRuns();
  // #326: 整页开关入口在飞互斥 —— 在飞期间页面尚无译文时忽略新触发
  let toggleInFlight = false;
  // #1007: content 侧在飞批次闸门 —— 同时在飞的批次不超过并发数设置。原先所有
  // 批次一次性发出，每批发出那一刻就开始走单次响应超时，而后台引擎闸门只放
  // 并发数那么多：排在队尾的批次还没轮到引擎，计时器已经走完。排队挪到这里，
  // 没轮到的批次还没发消息、不计时。整页与增量补翻共用这一道（一个页面一份）。
  // 复用引擎侧同一个闸门模块；上限沿用并发数设置，每次翻译开始时按当时的值调
  const sendGate = createGate(DEFAULT_SETTINGS.maxConcurrency);
  // #265: 设置变更订阅（start 订阅 / stop 退订）
  let unsubscribeSettings: (() => void) | null = null;
  // #659: 引擎报告的检测语言，只在内存里
  let detectedLang: string | null = null;
  const recordDetectedLang = (raw: string | undefined): void => {
    detectedLang = normalizeLangCode(raw) ?? detectedLang;
  };

  // #325: 全页翻译流水线本体（translatePage 与 togglePage 共用）
  const translatePageImpl = async (
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
    // #1011：补采集是整页翻译的延续，准入在整页入口已经判过，不重判
    // #1073：signal 是外层运行（整页开关的这一次）的信号；没有时从页面根派生
    // #1077：onBatch 是这一次的渲染回调（整页翻译会话），缺省 onBatchResult
    {
      admitted = false,
      signal,
      onBatch = onBatchResult,
    }: { admitted?: boolean; signal?: AbortSignal; onBatch?: OrchestratorOptions['onBatchResult'] } = {},
  ): Promise<PageTranslateSummary> => {
    if (!started) throw new Error('[PT] 编排未启动');

    // #311: 准入判定是翻译入口的前置步骤 —— 总开关关闭或站点被
    // 名单禁用时零请求，以结构化状态说明拦截原因
    const admission = admitted ? 'allowed' : admissionFrom(opts);
    if (admission !== 'allowed') {
      return {
        admission,
        allFailed: false,
        abandoned: false,
        invalidated: false,
        fatalError: null,
        display: { showRealReason: false },
      };
    }

    const maxConcurrency = opts.getSettings?.()?.maxConcurrency;
    if (maxConcurrency !== undefined) sendGate.setMax(maxConcurrency);
    // 批次拆分（#245、#1005）：字符预算与个数上限双闸，每批独立发送
    const batches = splitBatches(items, batchLimits);
    // #379: 当前领域在翻译开始时定一次，各批次一致；没有则不携带字段
    const domainId = currentDomainIdFrom(opts, to);

    let allFailed = true;
    // 有批次报了“已中止”（后台按信号中止了引擎调用）
    let sawAborted = false;
    // #111/#247: 失效 / 类别化致命原因 —— 全失败时优先展示
    let fatalError: string | null = null;
    // #313: 真实原因提示决策（key 无效 / 配额 → 展示真实原因）
    let realReason: string | null = null;

    // #1073：这一次的运行。还原整页（页面根中止）与外层运行中止都会让它中止；
    // 某一批判了失效时由这里以 RunInvalidated 中止它（#111 的全局短路）。信号
    // 交给发送层（#1001：在飞的批次通知后台中止，不翻完再丢）与切批重试，结果
    // 回来时再看一次，中止了就不渲染
    const run = runs.begin('page', signal);

    await Promise.all(
      batches.map(async (batch, i) => {
        // 批次级失败有界重试（#91 语义由 batch-retry 承接）：
        // 运行的信号在每次尝试前后检查（还原、失效短路）
        // #1007: 每次尝试都过闸门（重试退避期间不占名额）。放行的那一刻重判
        // 中止：批次可能在队列里待了十几秒，期间用户点了还原、或别的批次判了
        // 失效 —— 这时直接作废，消息一条都不发
        const result = await attemptBatchWithRetry(
          () =>
            sendGate(async (): Promise<TranslateBatchResult> => {
              if (run.signal.aborted) return { ok: false, aborted: true };
              const resp = (await opts.send(
                {
                  texts: batch.map((item) => item.text),
                  from,
                  to,
                  ...(domainId !== undefined && { domainId }),
                },
                { signal: run.signal },
              )) as TranslateBatchResult;
              // 失效要在让出名额之前中止运行：名额一让出，队首的批次在同一轮里
              // 就被放行，等这一批的记账走到，它已经发出去了。这一批自己的结果
              // 不受影响（切批重试照旧报失效）；#1001：别的在飞批次的结果反正要
              // 作废，信号一中止，发送层通知后台中止它们
              if (resp?.invalidated) run.abort(new RunInvalidated(resp.error ?? ''));
              return resp;
            }),
          {
            sleep: sleepFn,
            // #1065：重试之间的等待可被还原、失效短路打断
            signal: run.signal,
          },
        );

        if (result.ok) {
          // #157: 本批在飞期间被放弃或别的批次判了失效 —— 不渲染，否则还原后
          // 会把内容翻回来（#91 的渲染侧补漏）；后台没理会中止、照样送回译文
          // 时同样丢弃（#1001 的兜底）
          if (run.signal.aborted) return;
          allFailed = false;
          // #659: 记下引擎报告的检测语言（引擎不提供时不动）
          recordDetectedLang(result.data.detectedFrom);
          // #440: 部分段落因 key 无效、配额耗尽失败 —— 同样展示真实原因。
          // 有意不置 invalidated：其他批次照常翻译，已成功的段落照常渲染
          const failure = result.data.failure;
          if (failure) {
            const decision = displayDecision(failure.category, failure.error);
            if (decision.showRealReason) realReason = decision.reason ?? failure.error;
          }
        } else {
          // #157: 中止（还原）与失败分开记账 —— 中止不算失败
          if (result.aborted) {
            sawAborted = true;
            return;
          }
          // #579: 扩展上下文失效是预期情况（提示已让用户刷新页面），
          // 不按错误记录，免得堆积在扩展管理页的“错误”里
          if (result.error && !result.contextInvalidated) {
            console.error('[PT] 批次翻译失败:', result.error);
          }
          // 失效（上下文/配额）→ 全局短路（运行已在闸门里中止），失效原因进汇总
          if (result.invalidated) fatalError = result.error;
          // #313: 提示语义映射（整页与单文本共用同一份）——
          // key 无效 / 配额耗尽展示真实原因，瞬时故障展示泛化文案
          const decision = displayDecision(result.category, result.error);
          if (decision.showRealReason) {
            fatalError = result.error;
            realReason = decision.reason ?? result.error ?? null;
          }
        }

        // #256 渐进渲染：每批返回即触发渲染回调，互不等待
        onBatch?.(i, batch, result);
      }),
    );

    run.end();
    // #1073：失效不算放弃 —— 失效原因要提示给用户（扩展上下文失效提示刷新页面、
    // 配额耗尽显示引擎原因）。此前失效与放弃共用一个谓词，汇总同时报放弃，
    // 切换入口按放弃收尾、一个字都不提示。#157: 还原恰在最后一批与返回之间
    // 发生 —— 信号已中止，同样报放弃
    const invalidated = run.signal.reason instanceof RunInvalidated;
    const abandoned = !invalidated && (sawAborted || run.signal.aborted);

    return {
      admission: 'allowed',
      allFailed,
      abandoned,
      invalidated,
      fatalError,
      // #313: 全失败时是否展示真实原因（失效原因也算真实原因）
      display:
        realReason || (invalidated ? fatalError : null)
          ? { showRealReason: true, reason: realReason ?? fatalError ?? undefined }
          : { showRealReason: false },
    };
  };

  // #327: 状态推送 —— 仅主框架推送（子框架不推送状态、不产生提示，
  // 但照常执行翻译）
  const pushVisual = (status: PageToggleVisual): void => {
    if (opts.isMainFrame?.() === false) return;
    opts.pushStatus?.(status);
  };

  /**
   * 整页开关的翻译分支（#325）：闸门识别 → 交给整页翻译会话（首轮、补采集、到顶
   * 交接、观察器）。signal 是这一次开关的运行（#1073），还原整页让它中止；中止
   * 时不再推状态 —— 还原那一下已经推过空闲态、停了观察器。
   */
  const translateToggle = async (
    signal: AbortSignal,
    page: PageTranslation,
    from: string,
    to: string,
    admission: Admission,
  ): Promise<PageToggleResult> => {
    // #862：等识别的这段时间里用户可以还原（逐段翻译过一段之后再点，还原分支
    // 不受在飞互斥拦）或被 abort 中止，两者都中止这次运行，闸门以“被放弃”结束：
    // 不翻译、不推送状态 —— 还原那一下已经推过未翻译态。中止不算失败，不提示。
    // #1076：取样、超时竞速、识别都在闸门模块里，这里只调用一次。等它的这段
    // 时间算在飞（#326），否则连点两下会各自开一轮翻译
    toggleInFlight = true;
    let gate: PageGateDecision | 'abandoned';
    try {
      gate = await judgePage({
        to,
        detectedLang,
        pageLang: opts.getPageLang?.() ?? null,
        // #843：样本取自只读采集 —— 照常翻译的那次采集会切块，闸门命中时页面
        // 就不是一个字不动了
        units: () => page.readUnits(),
        ...(opts.detectContentLang && { detect: opts.detectContentLang }),
        signal,
      });
    } finally {
      toggleInFlight = false;
    }
    if (gate === 'abandoned') return { status: 'abandoned', admission };
    opts.onGateDecision?.(gate);
    if (!gate.translate) {
      // #793：悬浮球推到未翻译态 —— 推成完成态是在骗人，用户再点一次
      // 也会困惑。子框架不推（pushVisual 已按 #327 拦下）
      pushVisual('idle');
      return { status: 'same-language', admission, gate };
    }

    // 闸门命中、准入拦截、还原时不采集；到这里才开始这一次整页翻译
    const session = page.begin();
    toggleInFlight = true;
    try {
      const outcome = await session.run({
        translate: (items, { signal: s, onBatch, admitted }) =>
          translatePageImpl(items, from, to, {
            signal: s,
            admitted,
            onBatch: (i, batch, result) => {
              onBatch(batch, result);
              onBatchResult?.(i, batch, result);
            },
          }),
        signal,
        sleep: sleepFn,
        onState: pushVisual,
      });
      return outcome.status === 'no-elements'
        ? { status: 'no-elements', admission }
        : { status: outcome.status, admission, summary: outcome.summary };
    } finally {
      toggleInFlight = false;
    }
  };

  return {
    start(): void {
      started = true;
      // #265: 设置变更订阅由模块持有 —— content 不再各自订阅，
      // 初始化与变更共用同一响应路径
      if (!unsubscribeSettings && opts.subscribeSettings) {
        unsubscribeSettings = opts.subscribeSettings((s) => {
          // #1008: 翻译途中改并发数，在飞上限跟着变。用闸门自带的 setMax，不重建：
          // 重建的话旧闸门里的批次照旧占着名额，新批次进新闸门再占一份，在飞翻倍。
          // 调大时排队的批次立刻放行到新上限；调小时已在飞的照常跑完，只是不再放新的
          sendGate.setMax(s.maxConcurrency);
          opts.onSettingsChange?.(s);
        });
      }
    },

    stop(): void {
      started = false;
      unsubscribeSettings?.();
      unsubscribeSettings = null;
    },

    abort(): void {
      runs.restorePage();
    },

    async translatePage(items, from, to, pageOpts): Promise<PageTranslateSummary> {
      const onBatch = pageOpts?.onBatch;
      return translatePageImpl(items, from, to, {
        onBatch: onBatch
          ? (i, batch, result) => {
              onBatch(batch, result);
              onBatchResult?.(i, batch, result);
            }
          : onBatchResult,
      });
    },

    async togglePage(page, from, to): Promise<PageToggleResult> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #326: 在飞互斥 —— 在飞期间页面尚无译文时忽略新触发并返回
      // 忙碌状态（忙碌不是错误，调用方不应当作失败）；已有译文则
      // 放行还原（下方还原分支中止在飞批次）
      if (toggleInFlight && !page.hasTranslated()) {
        return { status: 'busy', admission: 'allowed' };
      }

      // 准入判定先行（#311）：拦截时零请求、不执行任何动作
      const admission = admissionFrom(opts);
      if (admission !== 'allowed') {
        return {
          status: admission === 'disabled' ? 'disabled' : 'blocked',
          admission,
        };
      }

      // #325: 翻译态查询经注入 —— 页面已有译文则还原，否则翻译
      if (page.hasTranslated()) {
        // #326: 还原中止在飞批次（页面根中止，在飞翻译放弃重试与渲染）；
        // #1001：在飞的批次通知后台中止，不翻完再丢
        runs.restorePage();
        // #328/#1078: 整页翻译会话停观察器、撤回页面上全部渲染
        page.restore();
        // #327: 还原后推送空闲态（不是错误）
        pushVisual('idle');
        return { status: 'restored', admission };
      }

      // #792：页面级闸门 —— 本页已经是目标语言就一个请求都不发，页面一个
      // 字不动（连采集都不做：采集会把超长段落切成切块）。排在准入与还原
      // 之后：站点被禁用照旧是准入拦截，已翻译的页面照旧能还原。
      // 只接在整页开关入口上，不进 admissionFrom —— 它被单文本入口共用，
      // 放进去会把逐段与划词一起拦下；那两条靠渲染层的单元级兜底（#783）。
      // 增量补翻（translatePage）也不判：观察器只在整页翻译成功后启动，
      // 命中闸门时它不启动，后来的新节点不会被补翻。
      // 检测语言不随还原清掉：换了目标语言再点，闸门可能按检测语言命中，
      // 这一页确实就是新目标语言
      // #843：第一级是本地内容识别，取样与识别都在闸门模块里（#1076）
      // #1073：这一次整页开关的运行，从页面根派生 —— 识别、首轮、补采集共用；
      // 到顶交接在开关返回之后才翻完，自己从页面根派生
      const run = runs.begin('page');
      try {
        return await translateToggle(run.signal, page, from, to, admission);
      } finally {
        run.end();
      }
    },

    detectedLang(): string | null {
      return detectedLang;
    },

    async translateText(text, from, to, textOpts): Promise<SingleTextResult> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #311: 与整页入口同一份准入判定 —— 拦截时零请求
      // #1075：没拿到译文时直接给出要显示的提示（或不提示），判定在 text-notice
      const miss = (m: SingleTextMiss, abandoned?: true): SingleTextResult => ({
        ok: false,
        notice: singleTextMissNotice(m),
        ...(abandoned && { abandoned }),
      });
      const admission = admissionFrom(opts);
      if (admission === 'blocked') return miss({ kind: 'blocked', mainFrame: opts.isMainFrame?.() !== false });
      if (admission === 'disabled') return miss({ kind: 'disabled' });
      // #794：这里不判页面级闸门。逐段与划词是用户点名要翻的一段，中文页面
      // 上划中一段英文引文单独翻译完全合理；目标语言的文字由渲染层与划词
      // 共用的单元级兜底（#783、#786、#787）各自说明

      // 单文本单请求，与整页入口共用注入的消息层（#312）。逐段翻译与
      // 划词翻译同样携带当前领域，术语译法与全页翻译一致（#383/#384）
      const domainId = currentDomainIdFrom(opts, to);
      // #1044：这一条被放弃时通知后台中止，与整页批次同一条路（#1001）——
      // 中止信号交给消息层，消息层把这次发送的批次身份发给后台。#1072：放弃
      // 只看这次运行的信号 —— 页面还原（从页面根派生时）与调用方自己的信号
      // #1053/#1074：被放弃只有一种表示（abandoned），不提示
      const abandoned = (): SingleTextResult => miss({ kind: 'abandoned' }, true);
      const run = runs.begin(textOpts?.root ?? 'page', textOpts?.signal);
      if (run.signal.aborted) {
        run.end();
        return abandoned();
      }
      let result: TranslateBatchResult;
      try {
        result = (await opts.send(
          {
            texts: [text],
            from,
            to,
            ...(domainId !== undefined && { domainId }),
            ...(textOpts?.noCache && { noCache: true }),
          },
          { signal: run.signal },
        )) as TranslateBatchResult;
      } finally {
        run.end();
      }

      // 在飞期间被放弃（页面还原、调用方中止）—— 不返回译文。后台没理会中止、
      // 照样送回译文时同样丢弃（#1001 的兜底）
      // 后台报了已中止（中止消息之外的途径）同样是放弃，不是失败
      if (run.signal.aborted || result.category === 'aborted') return abandoned();

      if (result.ok) {
        if (textOpts?.recordDetectedLang) recordDetectedLang(result.data?.detectedFrom);
        // 译文逐字透传引擎结果，模块不改写（#312）
        return { ok: true, translation: result.data?.translations?.[0] ?? '' };
      }
      // #313: key 无效 / 配额展示真实原因，瞬时故障展示泛化文案（与整页入口同一份）；
      // 失效与整页汇总同样展示真实原因
      return miss({
        kind: 'failed',
        category: result.category,
        error: result.error,
        invalidated: result.invalidated,
      });
    },
  };
}

/**
 * 准入判定（#311）—— 总开关 + 站点黑白名单，发生在任何请求之前。
 * 当前主机名经注入提供（getHostname），模块不直接访问页面地址。
 */
function admissionFrom(opts: OrchestratorOptions): Admission {
  const s = opts.getSettings?.();
  if (!s) return 'allowed';
  if (!s.enabled) return 'disabled';
  const host = opts.getHostname?.() ?? '';
  if (isSiteBlocked(host, s.siteList)) return 'blocked';
  return 'allowed';
}

/**
 * 当前领域 ID（#379）—— 生效领域与主机名均经注入提供。
 * #471: 按顶层页面的主机名判定，iframe 里与主文档得到同一个领域。
 * #400: 用户在 popup 里临时切换过领域时以它为准。
 */
function currentDomainIdFrom(
  opts: OrchestratorOptions,
  to: string,
): string | undefined {
  const domains = opts.getDomains?.();
  if (!domains) return undefined;
  const host = (opts.getTopHostname ?? opts.getHostname)?.() ?? '';
  return currentDomain(domains, host, to, opts.getDomainChoice?.())?.id;
}
