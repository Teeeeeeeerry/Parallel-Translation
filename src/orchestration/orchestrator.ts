// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译编排模块 —— #221 架构评审候选 1。
//
// content 入口（约 585 行）一个闭包同时承担：翻译编排（批次拆分、
// epoch 中止、渐进渲染）、UI 生命周期、消息路由 —— 编排逻辑完全
// 没有单元测试，e2e 之外无法触达。本模块把编排收在小 interface
// 后面（启动 / 停止 / 翻译入口），消息发送与渲染以回调注入，不直接
// 触碰 chrome 全局，测试用假消息层即可断言批次拆分、回调次数与
// 渐进渲染节奏。
//
// 演进：骨架与批次拆分（#245）→ 渐进渲染回调（#256）→ content
// 装配切换（#261）→ epoch 中止语义迁入（#262）。

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
import {
  decidePageGate,
  sampleUnitTexts,
  longestUnitTexts,
  CONTENT_SAMPLE_MIN_CHARS,
  CONTENT_UNDETERMINED,
  type ContentLang,
  type UnitLang,
  type PageGateDecision,
} from './page-gate';
import { normalizeLangCode } from './lang-code';
import { attemptBatchWithRetry } from '~/src/runtime/batch-retry';
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
  /** 是否有批次被中止（还原 / 导航）。 */
  aborted: boolean;
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

/** 单文本翻译结果（#312）—— 逐段翻译 / 划词翻译共用。 */
export interface SingleTextResult {
  /** 准入结果：未通过准入时零请求。 */
  admission: Admission;
  /** 是否成功。 */
  ok: boolean;
  /** 译文（成功时）—— 引擎结果逐字透传，模块不改写。 */
  translation?: string;
  /** 失败类别（失败时）。 */
  category?: FailureCategory;
  /** 失败原因文本（引擎给出的真实原因）。 */
  error?: string;
  /** 提示语义（#313）：失败时展示真实原因还是泛化文案。 */
  display?: FailureDisplay;
}

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

/**
 * 失败类别 → 提示语义映射（#313）。
 * key 无效 / 配额耗尽 → 展示真实原因；瞬时故障 → 泛化文案。
 */
export function displayDecision(
  category: FailureCategory | undefined,
  error: string | undefined,
): FailureDisplay {
  if (category === 'invalid-key' || category === 'quota') {
    return { showRealReason: true, reason: error };
  }
  return { showRealReason: false };
}


/** 翻译编排模块 —— 小 interface：启动 / 停止 / 翻译入口（#221）。 */
export interface TranslationOrchestrator {
  /** 启动编排（设置变更响应等初始化）。 */
  start(): void;
  /** 停止编排（清理订阅与在飞状态）。 */
  stop(): void;
  /**
   * 中止在途翻译（#262）—— 递增还原纪元：在飞批次的尝试、重试与
   * 渲染回调全部放弃，过期译文不落 DOM；新翻译不受旧批次干扰。
   */
  abort(): void;
  /**
   * 全页翻译入口：按批次拆分发送，每批返回即触发渲染回调（#256）；
   * 批次级失败有界重试、失效全局短路、epoch 中止判定都在模块内
   * （#261 / #262）。
   */
  translatePage(
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
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
   * 翻译还是还原 → 执行」。翻译态查询与还原动作以注入方式提供
   * （OrchestratorOptions.hasTranslated / restore），模块不触碰 DOM。
   * 翻译分支与 translatePage 同一条流水线（准入 / 批次 / 中止 / 提示语义）。
   */
  togglePage(items: PageItemsSource, from: string, to: string): Promise<PageToggleResult>;
}

/**
 * 整页开关入口的翻译项来源：现成的数组，或按需采集的函数（#792）。函数收到
 * `{ readOnly: true }` 时只读采集，供页面级闸门取样（#843）：不切块、不登记
 * 隐藏单元，页面一个字不动；不带参数时是照常翻译的那一次采集。
 */
export type PageItemsSource =
  | TranslateItem<unknown>[]
  | ((mode?: { readOnly: boolean }) => TranslateItem<unknown>[]);

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
 *   - aborted：翻译中还原（中止不计失败）
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
  | 'aborted'
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
  /** 渲染回调（#256 渐进渲染）：每批返回即触发，首屏不等待最慢段。 */
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
   * 翻译态查询（#325）：页面是否已有译文 —— 开关入口据此决定翻译
   * 还是还原，模块不直接访问 DOM。
   */
  hasTranslated?: () => boolean;
  /** 还原动作（#325）：开关入口在页面已有译文时调用（调用方实现 DOM 还原）。 */
  restore?: () => void;
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
   * 渲染结果查询（#327）：引擎返回结果但全部渲染被拒时，状态机不推送
   * 已完成状态 —— 调用方经 onBatchResult 统计渲染成败后在此报告。
   */
  allRenderRejected?: () => boolean;
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
  /**
   * 增量补翻观察器启动钩子（#328）：只在整页翻译成功后调用 ——
   * 调用方接线到生命周期注册表（启停幂等，未启动为空操作）。
   */
  onObserverStart?: () => void;
  /** 增量补翻观察器停止钩子（#328）：还原时调用，幂等。 */
  onObserverStop?: () => void;
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

/**
 * 页面级闸门等本地内容识别的时间上限（毫秒，#866）。识别是纯本地的 CPU 操作，
 * 在 Chrome 上实测（2200 字符的中英混排样本，连跑 30 次）中位 0.9 毫秒、最慢
 * 1.1 毫秒，样本上限 4000 字符也只是几毫秒。这个上限是给“回调永远不来”兜底，
 * 不是给“识别慢”兜底，所以取得短：比实测高出两到三个数量级，挂死时用户最多
 * 多等一秒，随后照常翻译。
 *
 * #892：这一秒是整个识别阶段共用的，不是每次识别各一秒。全页样本与单元级
 * 识别（最多 UNIT_DETECT_COUNT 个单元）同时发出，共用同一个截止时刻：到点还
 * 没回来的那几次当拿不到，已经回来的照用。最坏情况仍是一秒，不是单元数
 * 乘一秒。#904 让短单元也进来之后仍是这样：个数上限不变，同一个截止时刻。
 */
export const CONTENT_DETECT_TIMEOUT_MS = 1000;

/**
 * 补采集的轮数上限与轮间间隔（#1013）。间隔按实测定：翻译期间滚到底之后，
 * Reddit 列表 929、1243 毫秒出现下一批，dev.to 首页 390 到 788 毫秒出现、最慢
 * 一次 1429 毫秒才渲染完（docs/research/lazy-load-window-repro.md 第 6 节）。
 * 观察器的 300 毫秒防抖一次都接不住。
 */
export const RECOLLECT_MAX_ROUNDS = 3;
export const RECOLLECT_INTERVAL_MS = 1500;

export function createOrchestrator(opts: OrchestratorOptions): TranslationOrchestrator {
  const batchLimits = opts.batchLimits ?? FULL_PAGE_BATCH_LIMITS;
  const sleepFn = opts.sleep ?? defaultSleep;
  const onBatchResult = opts.onBatchResult;
  let started = false;
  // #262: 还原纪元在模块内 —— abort() 递增，在飞翻译据此放弃
  // 尝试、重试与渲染；新翻译快照新纪元，不受旧批次干扰
  let epoch = 0;
  // #1001：纪元递增（还原）时要通知的在飞整页翻译 —— 各自中止自己发出的批次。
  // 只是通知，纪元本身的判定（isAborted、闸门放行）一行没动
  const onEpochBump = new Set<() => void>();
  const abandonInFlight = (): void => {
    for (const f of [...onEpochBump]) f();
  };
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

  // #843：页面级闸门的内容识别。没注入识别就不取样；取样出错当没做识别，
  // 闸门回落到检测语言与声明 —— 一个可选能力出错不该让整页翻译坏掉
  // #866：识别超过时间上限当拿不到结果。识别的回调不来时，没有上限的等待会
  // 让整页翻译永远停在在飞，再点只返回忙碌，只能刷新页面
  // #889：送去识别却没拿到结果（给不出、出错、超时）与识别器说拿不准同等
  // 对待，闸门照常翻译，不回落到声明
  // #892：除了全页样本，再把按文字长度排在最前面的若干个单元各自送去识别
  // （#891 的“够长的外文单元”），走同一个注入的识别函数。单元识别拿不到
  // 结果时这个单元不算外文块，不影响全页样本那一边
  // #904：不到外文块下限的单元也送去识别，给 #903“最长的若干个单元都是目标
  // 语言就拦下”那一级用。个数上限不变（UNIT_DETECT_COUNT），拿不到结果的
  // 单元在那一级算证据不足，不拦
  const detectContent = async (
    items: PageItemsSource,
  ): Promise<{ contentLang: ContentLang | null; contentUnits: UnitLang[] | null }> => {
    const none = { contentLang: null, contentUnits: null };
    const detect = opts.detectContentLang;
    if (!detect) return none;
    let texts: string[];
    try {
      const list = typeof items === 'function' ? items({ readOnly: true }) : items;
      texts = list.map((item) => item.text);
    } catch {
      return none;
    }
    const sample = sampleUnitTexts(texts);
    // #859：样本太短时占比不稳，不送去识别，当没做识别。单元也不送：全页
    // 文字不到一百个字符，谈不上哪一块是成块的外文正文
    if (sample.length < CONTENT_SAMPLE_MIN_CHARS) return none;
    const units = longestUnitTexts(texts);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CONTENT_DETECT_TIMEOUT_MS);
    });
    const once = async (text: string): Promise<ContentLang | null> => {
      try {
        return await Promise.race([detect(text), deadline]);
      } catch {
        return null;
      }
    };
    try {
      const [whole, ...each] = await Promise.all([once(sample), ...units.map((u) => once(u.text))]);
      return {
        contentLang: whole ?? CONTENT_UNDETERMINED,
        contentUnits: units.map((u, i) => {
          const result = each[i];
          const top = result?.languages[0];
          return {
            chars: u.chars,
            letters: u.letters,
            lang: top?.lang ?? null,
            reliable: Boolean(result?.reliable && top),
          };
        }),
      };
    } finally {
      clearTimeout(timer);
    }
  };

  // #325: 全页翻译流水线本体（translatePage 与 togglePage 共用）
  const translatePageImpl = async (
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
    // #1011：补采集是整页翻译的延续，准入在整页入口已经判过，不重判
    { admitted = false }: { admitted?: boolean } = {},
  ): Promise<PageTranslateSummary> => {
    if (!started) throw new Error('[PT] 编排未启动');

    // #311: 准入判定是翻译入口的前置步骤 —— 总开关关闭或站点被
    // 名单禁用时零请求，以结构化状态说明拦截原因
    const admission = admitted ? 'allowed' : admissionFrom(opts);
    if (admission !== 'allowed') {
      return {
        admission,
        allFailed: false,
        aborted: false,
        invalidated: false,
        fatalError: null,
        display: { showRealReason: false },
      };
    }

    const epochAtStart = epoch;
    const maxConcurrency = opts.getSettings?.()?.maxConcurrency;
    if (maxConcurrency !== undefined) sendGate.setMax(maxConcurrency);
    // 批次拆分（#245、#1005）：字符预算与个数上限双闸，每批独立发送
    const batches = splitBatches(items, batchLimits);
    // #379: 当前领域在翻译开始时定一次，各批次一致；没有则不携带字段
    const domainId = currentDomainIdFrom(opts, to);

    let allFailed = true;
    let aborted = false;
    // #111/#247: 失效 / 类别化致命原因 —— 全失败时优先展示
    let invalidated = false;
    let fatalError: string | null = null;
    // #313: 真实原因提示决策（key 无效 / 配额 → 展示真实原因）
    let realReason: string | null = null;

    // #262: 中止谓词 —— 还原（abort 递增纪元）或他批已判失效
    const isAborted = (): boolean =>
      invalidated || epoch !== epochAtStart;
    // #1007: 某一批的响应已是失效（见闸门里的放行判定）
    let invalidationSeen = false;
    // #1001：这一次整页翻译放弃了（还原、失效短路）—— 在飞的批次通知后台中止，
    // 不翻完再丢。结果照旧按 isAborted 记账
    const abandon = new AbortController();
    const onBump = () => abandon.abort();
    onEpochBump.add(onBump);

    await Promise.all(
      batches.map(async (batch, i) => {
        // 批次级失败有界重试（#91 语义由 batch-retry 承接）：
        // 失效全局短路 + epoch 中止在每次尝试前后检查
        // #1007: 每次尝试都过闸门（重试退避期间不占名额）。放行的那一刻重判
        // 中止：批次可能在队列里待了十几秒，期间用户点了还原、或别的批次判了
        // 失效 —— 这时直接作废，消息一条都不发
        const result = await attemptBatchWithRetry(
          () =>
            sendGate(async (): Promise<TranslateBatchResult> => {
              if (isAborted() || invalidationSeen) return { ok: false, aborted: true };
              const resp = (await opts.send(
                {
                  texts: batch.map((item) => item.text),
                  from,
                  to,
                  ...(domainId !== undefined && { domainId }),
                },
                { signal: abandon.signal },
              )) as TranslateBatchResult;
              // 失效要在让出名额之前记下：名额一让出，队首的批次在同一轮里就被
              // 放行，等这一批的记账（下面的 invalidated = true）走到，它已经发出去了。
              // 单独一个标志只拦排队的批次，不改这一批自己的结果（它仍报失效）
              if (resp?.invalidated) {
                invalidationSeen = true;
                // #1001：别的在飞批次的结果反正要作废，通知后台中止它们
                abandon.abort();
              }
              return resp;
            }),
          {
            sleep: sleepFn,
            shouldAbort: isAborted,
          },
        );

        if (result.ok) {
          // #157: 本批在飞期间用户已还原（纪元递增）—— 放弃渲染，
          // 否则还原后会把内容翻回来（#91 的渲染侧补漏）
          if (isAborted()) {
            aborted = true;
            return;
          }
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
            aborted = true;
            return;
          }
          // #579: 扩展上下文失效是预期情况（提示已让用户刷新页面），
          // 不按错误记录，免得堆积在扩展管理页的“错误”里
          if (result.error && !result.contextInvalidated) {
            console.error('[PT] 批次翻译失败:', result.error);
          }
          // 失效（上下文/配额）→ 全局短路，其余批次放弃尝试
          if (result.invalidated) {
            invalidated = true;
            fatalError = result.error;
          }
          // #313: 提示语义映射（整页与单文本共用同一份）——
          // key 无效 / 配额耗尽展示真实原因，瞬时故障展示泛化文案
          const decision = displayDecision(result.category, result.error);
          if (decision.showRealReason) {
            fatalError = result.error;
            realReason = decision.reason ?? result.error ?? null;
          }
        }

        // #256 渐进渲染：每批返回即触发渲染回调，互不等待
        onBatchResult?.(i, batch, result);
      }),
    );

    onEpochBump.delete(onBump);
    // #157: 还原恰在最后一批与返回之间发生 —— 也报 aborted
    if (isAborted()) aborted = true;

    return {
      admission: 'allowed',
      allFailed,
      aborted,
      invalidated,
      fatalError,
      // #313: 全失败时是否展示真实原因（失效原因也算真实原因）
      display:
        realReason || (invalidated ? fatalError : null)
          ? { showRealReason: true, reason: realReason ?? fatalError ?? undefined }
          : { showRealReason: false },
    };
  };

  /**
   * 补采集（#1011）：再调一次整页入口的采集函数，交出来的单元走增量补翻那条
   * 批次流水线。带完成标记的单元采集本身就跳过；首轮已交出过的单元（翻译失败
   * 的、译文与原文相同没落标记的）由调用方的采集函数自己去重，不在这里认元素。
   * 还原：每轮开始前看纪元，每批放行时由闸门里的中止判定拦下（#1007）。补采集
   * 自身的失败不回写整页的结论 —— 首轮已经成功的段落照常显示。
   *
   * #1013：补完一轮再查一次，有新的接着补，最多 RECOLLECT_MAX_ROUNDS 轮；某一轮
   * 没有新单元就结束。第一轮紧接首轮，之后每轮先等 RECOLLECT_INTERVAL_MS，给
   * 懒加载留出渲染下一批的时间。到顶之后剩下的交给观察器。
   *
   * #1036：返回是否补满了 RECOLLECT_MAX_ROUNDS 轮。补满时最后一轮采集之后、它
   * 的译文回来之前进 DOM 的内容，补采集不再采、观察器启动前也看不到，由调用方
   * 在启动观察器的同一刻再采一次接上；提前结束（某轮为空、中止、失效）时没有
   * 这段窗口。
   */
  const recollect = async (
    source: (mode?: { readOnly: boolean }) => TranslateItem<unknown>[],
    from: string,
    to: string,
  ): Promise<boolean> => {
    const epochAtStart = epoch;
    for (let round = 1; round <= RECOLLECT_MAX_ROUNDS; round++) {
      if (round > 1) await sleepFn(RECOLLECT_INTERVAL_MS);
      if (epoch !== epochAtStart) return false;
      const more = source();
      if (more.length === 0) return false;
      console.info(`[PT] 补采集第 ${round} 轮：${more.length} 个新单元`);
      const summary = await translatePageImpl(more, from, to, { admitted: true });
      if (summary.aborted || summary.invalidated) return false;
    }
    return true;
  };

  // #327: 状态推送 —— 仅主框架推送（子框架不推送状态、不产生提示，
  // 但照常执行翻译）
  const pushVisual = (status: PageToggleVisual): void => {
    if (opts.isMainFrame?.() === false) return;
    opts.pushStatus?.(status);
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
      epoch++;
      abandonInFlight();
    },

    async translatePage(items, from, to): Promise<PageTranslateSummary> {
      return translatePageImpl(items, from, to);
    },

    async togglePage(items, from, to): Promise<PageToggleResult> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #326: 在飞互斥 —— 在飞期间页面尚无译文时忽略新触发并返回
      // 忙碌状态（忙碌不是错误，调用方不应当作失败）；已有译文则
      // 放行还原（下方还原分支中止在飞批次）
      if (toggleInFlight && !opts.hasTranslated?.()) {
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
      if (opts.hasTranslated?.()) {
        // #326: 还原中止在飞批次（epoch 递增，在飞翻译放弃重试与渲染）
        epoch++;
        // #1001：在飞的批次通知后台中止，不翻完再丢
        abandonInFlight();
        opts.restore?.();
        // #327: 还原后推送空闲态（不是错误）
        pushVisual('idle');
        // #328: 还原时停止增量补翻观察器（幂等 —— 重复还原为空操作）
        opts.onObserverStop?.();
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
      // #843：第一级是本地内容识别。样本取自同一个采集函数的只读模式 ——
      // 照常翻译的那次采集会切块，闸门命中时页面就不是一个字不动了。识别是
      // 异步的：等它的这段时间已经算在飞，否则连点两下会各自开一轮翻译
      // （#326）；没注入识别就不等，时序与改动前一致
      let contentLang: ContentLang | null = null;
      let contentUnits: UnitLang[] | null = null;
      if (opts.detectContentLang) {
        // #862：等识别的这段时间里用户可以还原（逐段翻译过一段之后再点，
        // 还原分支不受在飞互斥拦）或被 abort 中止，两者都递增纪元（#262、
        // #328）。识别回来时纪元变了，这次判定已经作废：不判闸门、不翻译、
        // 不推送状态 —— 还原那一下已经推过未翻译态。中止不算失败，不提示
        const epochAtToggle = epoch;
        toggleInFlight = true;
        try {
          ({ contentLang, contentUnits } = await detectContent(items));
        } finally {
          toggleInFlight = false;
        }
        if (epoch !== epochAtToggle) return { status: 'aborted', admission };
      }
      const gate = decidePageGate({
        to,
        detectedLang,
        pageLang: opts.getPageLang?.() ?? null,
        contentLang,
        contentUnits,
      });
      opts.onGateDecision?.(gate);
      if (!gate.translate) {
        // #793：悬浮球推到未翻译态 —— 推成完成态是在骗人，用户再点一次
        // 也会困惑。子框架不推（pushVisual 已按 #327 拦下）
        pushVisual('idle');
        return { status: 'same-language', admission, gate };
      }

      // 采集可以按需进行（传函数）：闸门命中、准入拦截、还原时不采集
      const list = typeof items === 'function' ? items() : items;
      if (list.length === 0) {
        return { status: 'no-elements', admission };
      }

      toggleInFlight = true;
      pushVisual('loading');
      try {
        const summary = await translatePageImpl(list, from, to);
        const status: PageToggleStatus = summary.aborted
          ? 'aborted'
          : summary.allFailed || opts.allRenderRejected?.()
            ? 'error'
            : 'translated';
        // #327: 中止（还原）→ 空闲态；失败 → 错误态；成功 → 完成态。
        // #1012：成功的完成态等补采集结束才推（见下）—— 先报完成、下半页却还在
        // 翻，正是 #1003 最让人困惑的地方
        if (status !== 'translated') {
          pushVisual(status === 'error' ? 'error' : 'idle');
          return { status, admission, summary };
        }
        // #1011：补采集一轮。采集只在开头做了一次，观察器又要等到这里才启动，
        // 整页翻译跑的这十几秒里懒加载出来的内容两边都不管，永久漏翻（#1010
        // 实测）。触发条件与观察器启动一致（只有判为成功才补），页面级闸门与
        // 准入不重判；同一个采集函数，同一条增量补翻的批次流水线
        const epochAtDone = epoch;
        const capped = typeof items === 'function' && (await recollect(items, from, to));
        // 补采集期间用户点了还原：还原分支已推空闲态、停了观察器，这里不再推
        // 完成态、不再启动
        if (epoch !== epochAtDone) return { status: 'aborted', admission, summary };
        pushVisual('done');
        // #1036：补满了轮数时，最后一轮在飞期间进 DOM 的内容两边都不管 —— 在启动
        // 观察器的同一个同步段里再采一次，交给增量补翻。采集与启动之间没有 await，
        // 页面脚本插不进来：这一刻之前进 DOM 的由这次采集接住，之后的由观察器接住，
        // 同一个节点不会两边各翻一次。观察器的启动时机不变，仍在整页翻译成功之后
        const handoff = capped && typeof items === 'function' ? items() : [];
        // #328: 观察器启停时机 —— 只在整页翻译成功后启动恰好一次；
        // 失败 / 中止（在飞还原）不启动。#1011：补采集结束之后才启动
        opts.onObserverStart?.();
        if (handoff.length > 0) {
          console.info(`[PT] 补采集到顶，交给观察器补翻：${handoff.length} 个新单元`);
          translatePageImpl(handoff, from, to, { admitted: true }).catch((e) =>
            console.error('[PT] 补采集到顶后的补翻失败:', e),
          );
        }
        return { status, admission, summary };
      } finally {
        toggleInFlight = false;
      }
    },

    detectedLang(): string | null {
      return detectedLang;
    },

    async translateText(text, from, to, textOpts): Promise<SingleTextResult> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #311: 与整页入口同一份准入判定 —— 拦截时零请求
      const admission = admissionFrom(opts);
      if (admission !== 'allowed') return { admission, ok: false };
      // #794：这里不判页面级闸门。逐段与划词是用户点名要翻的一段，中文页面
      // 上划中一段英文引文单独翻译完全合理；目标语言的文字由渲染层与划词
      // 共用的单元级兜底（#783、#786、#787）各自说明

      // 单文本单请求，与整页入口共用注入的消息层（#312）。逐段翻译与
      // 划词翻译同样携带当前领域，术语译法与全页翻译一致（#383/#384）
      const epochAtStart = epoch;
      const domainId = currentDomainIdFrom(opts, to);
      const result = (await opts.send({
        texts: [text],
        from,
        to,
        ...(domainId !== undefined && { domainId }),
        ...(textOpts?.noCache && { noCache: true }),
      })) as TranslateBatchResult;

      // 在飞期间被中止（还原递增纪元）—— 不返回译文
      if (epoch !== epochAtStart) {
        return { admission, ok: false, category: 'aborted' };
      }

      if (result.ok) {
        if (textOpts?.recordDetectedLang) recordDetectedLang(result.data?.detectedFrom);
        // 译文逐字透传引擎结果，模块不改写（#312）
        return {
          admission,
          ok: true,
          translation: result.data?.translations?.[0],
        };
      }
      return {
        admission,
        ok: false,
        category: result.category,
        error: result.error,
        // #313: 失败提示语义由类别映射（与整页入口同一份）
        display: displayDecision(result.category, result.error),
      };
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
