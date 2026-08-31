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
import { isSiteBlocked } from '~/src/dom/site-filter';
import { attemptBatchWithRetry } from '~/src/runtime/batch-retry';
import { sleep as defaultSleep } from '~/src/runtime/sleep';

/** 全页翻译的批次大小 —— 与 content 现有 FULL_PAGE_BATCH_SIZE 一致（#25）。 */
export const FULL_PAGE_BATCH_SIZE = 15;

/** 翻译项：文本 + 调用方携带的渲染/还原上下文（#245 保持与现状同构）。 */
export interface TranslateItem<TCtx> {
  text: string;
  ctx: TCtx;
}

/** 消息发送回调 —— 注入假消息层即可单测，模块不直接触碰 chrome。 */
export type SendTranslate = (req: TranslateRequest) => Promise<unknown>;

/** 单批发送结果（#256）：渲染层按批消费，批次间不互相等待。 */
export interface TranslateBatchResult {
  ok: boolean;
  data?: TranslateResponse;
  error?: string;
  invalidated?: boolean;
  retryable?: boolean;
  category?: FailureCategory;
  aborted?: boolean;
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
  /** 失败类别（失败时，#313 据此决定提示语义）。 */
  category?: FailureCategory;
  /** 失败原因文本（key 无效 / 配额等展示真实原因用）。 */
  error?: string;
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
   * 成功时返回译文（引擎结果逐字透传，模块不改写）。
   */
  translateText(
    text: string,
    from: string,
    to: string,
  ): Promise<SingleTextResult>;
}

export interface OrchestratorOptions {
  /** 消息发送层（测试注入假层；content 注入 translateViaBackground）。 */
  send: SendTranslate;
  /** 批次大小，缺省与现状一致（15）。 */
  batchSize?: number;
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
}

/**
 * 按批次大小切分翻译项（#245）。
 * 与 content 现有切片逻辑一致：前 N-1 批满额，最后一批为余数。
 */
export function splitBatches<T>(
  items: TranslateItem<T>[],
  size: number,
): TranslateItem<T>[][] {
  const batches: TranslateItem<T>[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function createOrchestrator(opts: OrchestratorOptions): TranslationOrchestrator {
  const batchSize = opts.batchSize ?? FULL_PAGE_BATCH_SIZE;
  const sleepFn = opts.sleep ?? defaultSleep;
  const onBatchResult = opts.onBatchResult;
  let started = false;
  // #262: 还原纪元在模块内 —— abort() 递增，在飞翻译据此放弃
  // 尝试、重试与渲染；新翻译快照新纪元，不受旧批次干扰
  let epoch = 0;
  // #265: 设置变更订阅（start 订阅 / stop 退订）
  let unsubscribeSettings: (() => void) | null = null;

  return {
    start(): void {
      started = true;
      // #265: 设置变更订阅由模块持有 —— content 不再各自订阅，
      // 初始化与变更共用同一响应路径
      if (!unsubscribeSettings && opts.subscribeSettings) {
        unsubscribeSettings = opts.subscribeSettings((s) => {
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
    },

    async translatePage(items, from, to): Promise<PageTranslateSummary> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #311: 准入判定是翻译入口的前置步骤 —— 总开关关闭或站点被
      // 名单禁用时零请求，以结构化状态说明拦截原因
      const admission = admissionFrom(opts);
      if (admission !== 'allowed') {
        return {
          admission,
          allFailed: false,
          aborted: false,
          invalidated: false,
          fatalError: null,
        };
      }

      const epochAtStart = epoch;
      // 批次拆分（#245）：与现状一致，每批独立发送
      const batches = splitBatches(items, batchSize);

      let allFailed = true;
      let aborted = false;
      // #111/#247: 失效 / 类别化致命原因 —— 全失败时优先展示
      let invalidated = false;
      let fatalError: string | null = null;

      // #262: 中止谓词 —— 还原（abort 递增纪元）或他批已判失效
      const isAborted = (): boolean =>
        invalidated || epoch !== epochAtStart;

      await Promise.all(
        batches.map(async (batch, i) => {
          // 批次级失败有界重试（#91 语义由 batch-retry 承接）：
          // 失效全局短路 + epoch 中止在每次尝试前后检查
          const result = await attemptBatchWithRetry(
            () =>
              opts.send({
                texts: batch.map((item) => item.text),
                from,
                to,
              }) as Promise<TranslateBatchResult>,
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
          } else {
            // #157: 中止（还原）与失败分开记账 —— 中止不算失败
            if (result.aborted) {
              aborted = true;
              return;
            }
            if (result.error) {
              console.error('[PT] 批次翻译失败:', result.error);
            }
            // 失效（上下文/配额）→ 全局短路，其余批次放弃尝试
            if (result.invalidated) {
              invalidated = true;
              fatalError = result.error;
            }
            // #247: 类别化致命原因 —— key 无效 / 配额失效展示真实原因
            if (
              result.category === 'invalid-key' ||
              result.category === 'quota'
            ) {
              fatalError = result.error;
            }
          }

          // #256 渐进渲染：每批返回即触发渲染回调，互不等待
          onBatchResult?.(i, batch, result);
        }),
      );

      // #157: 还原恰在最后一批与返回之间发生 —— 也报 aborted
      if (isAborted()) aborted = true;

      return {
        admission: 'allowed',
        allFailed,
        aborted,
        invalidated,
        fatalError,
      };
    },

    async translateText(text, from, to): Promise<SingleTextResult> {
      if (!started) throw new Error('[PT] 编排未启动');

      // #311: 与整页入口同一份准入判定 —— 拦截时零请求
      const admission = admissionFrom(opts);
      if (admission !== 'allowed') return { admission, ok: false };

      // 单文本单请求，与整页入口共用注入的消息层（#312）
      const epochAtStart = epoch;
      const result = (await opts.send({
        texts: [text],
        from,
        to,
      })) as TranslateBatchResult;

      // 在飞期间被中止（还原递增纪元）—— 不返回译文
      if (epoch !== epochAtStart) {
        return { admission, ok: false, category: 'aborted' };
      }

      if (result.ok) {
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
