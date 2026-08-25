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
  /** 是否所有非中止批次均失败。 */
  allFailed: boolean;
  /** 是否有批次被中止（还原 / 导航）。 */
  aborted: boolean;
  /** 上下文 / 配额失效（全局短路）。 */
  invalidated: boolean;
  /** 全失败时的致命原因（失效 / 类别化错误），供 toast 展示。 */
  fatalError: string | null;
}

/** 翻译编排模块 —— 小 interface：启动 / 停止 / 翻译入口（#221）。 */
export interface TranslationOrchestrator {
  /** 启动编排（设置变更响应等初始化）。 */
  start(): void;
  /** 停止编排（清理订阅与在飞状态）。 */
  stop(): void;
  /**
   * 全页翻译入口：按批次拆分发送，每批返回即触发渲染回调（#256）；
   * 批次级失败有界重试、失效全局短路、中止判定都在模块内（#261）。
   */
  translatePage(
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
    opts?: PageTranslateOptions,
  ): Promise<PageTranslateSummary>;
}

export interface PageTranslateOptions {
  /**
   * 中止谓词（#261 由调用方注入还原/导航状态；#262 迁入模块内部）。
   * 每次尝试前后与渲染前检查，返回 true 则放弃该批与剩余重试。
   */
  shouldAbort?: () => boolean;
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

  return {
    start(): void {
      started = true;
    },

    stop(): void {
      started = false;
    },

    async translatePage(items, from, to, pageOpts = {}): Promise<PageTranslateSummary> {
      if (!started) throw new Error('[PT] 编排未启动');
      const shouldAbort = pageOpts.shouldAbort;
      // 批次拆分（#245）：与现状一致，每批独立发送
      const batches = splitBatches(items, batchSize);

      let allFailed = true;
      let aborted = false;
      // #111/#247: 失效 / 类别化致命原因 —— 全失败时优先展示
      let invalidated = false;
      let fatalError: string | null = null;

      await Promise.all(
        batches.map(async (batch, i) => {
          // 批次级失败有界重试（#91 语义由 batch-retry 承接）：
          // 失效全局短路 + 调用方中止谓词在每次尝试前后检查
          const result = await attemptBatchWithRetry(
            () =>
              opts.send({
                texts: batch.map((item) => item.text),
                from,
                to,
              }) as Promise<TranslateBatchResult>,
            {
              sleep: sleepFn,
              shouldAbort: () => invalidated || (shouldAbort?.() ?? false),
            },
          );

          if (result.ok) {
            // #157: 本批在飞期间用户已还原（中止谓词命中）—— 放弃
            // 渲染，否则还原后会把内容翻回来（#91 的渲染侧补漏）
            if (shouldAbort?.()) {
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
      if (shouldAbort?.()) aborted = true;

      return { allFailed, aborted, invalidated, fatalError };
    },
  };
}
