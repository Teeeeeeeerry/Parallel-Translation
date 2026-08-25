// 翻译编排模块 —— #221 架构评审候选 1（#245 骨架与批次拆分）。
//
// content 入口（约 585 行）一个闭包同时承担：翻译编排（批次拆分、
// epoch 中止、渐进渲染）、UI 生命周期、消息路由 —— 编排逻辑完全
// 没有单元测试，e2e 之外无法触达。本模块把编排收在小 interface
// 后面（启动 / 停止 / 翻译入口），消息发送以回调注入，不直接触碰
// chrome 全局，测试用假消息层即可断言批次拆分与回调次数。
//
// 本票落地骨架与批次拆分（#245）；渐进渲染回调注入与 epoch 中止
// 语义由后续票承接（#256 / #262），尚无生产调用方。

import type {
  TranslateRequest,
  TranslateResponse,
  FailureCategory,
} from '~/src/engines/types';

/** 全页翻译的批次大小 —— 与 content 现有 FULL_PAGE_BATCH_SIZE 一致（#25）。 */
export const FULL_PAGE_BATCH_SIZE = 15;

/** 翻译项：文本 + 调用方携带的渲染/还原上下文（#245 保持与现状同构）。 */
export interface TranslateItem<TCtx> {
  text: string;
  ctx: TCtx;
}

/** 消息发送回调 —— 注入假消息层即可单测，模块不直接触碰 chrome。 */
export type SendTranslate = (req: TranslateRequest) => Promise<unknown>;

/** 翻译编排模块 —— 小 interface：启动 / 停止 / 翻译入口（#221）。 */
export interface TranslationOrchestrator {
  /** 启动编排（后续承接设置变更响应等初始化）。 */
  start(): void;
  /** 停止编排（清理订阅与在飞状态）。 */
  stop(): void;
  /** 全页翻译入口：按批次拆分发送，每批返回即渲染（渐进渲染见 #256）。 */
  translatePage(
    items: TranslateItem<unknown>[],
    from: string,
    to: string,
  ): Promise<void>;
}

export interface OrchestratorOptions {
  /** 消息发送层（测试注入假层）。 */
  send: SendTranslate;
  /** 批次大小，缺省与现状一致（15）。 */
  batchSize?: number;
  /** 渲染回调（#256 渐进渲染）：每批返回即触发，首屏不等待最慢段。 */
  onBatchResult?: (batchIndex: number, result: TranslateBatchResult) => void;
}

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
  let started = false;

  return {
    start(): void {
      started = true;
    },

    stop(): void {
      started = false;
    },

    async translatePage(items, from, to): Promise<void> {
      if (!started) throw new Error('[PT] 编排未启动');
      // 批次拆分（#245）：与现状一致，每批独立发送
      const batches = splitBatches(items, batchSize);
      // #256 渐进渲染：每批返回即触发渲染回调，互不等待 ——
      // 首屏译文不必等全页最慢段（#25 行为保持）
      await Promise.all(
        batches.map(async (batch, i) => {
          const result = (await opts.send({
            texts: batch.map((item) => item.text),
            from,
            to,
          })) as TranslateBatchResult;
          opts.onBatchResult?.(i, result);
        }),
      );
    },
  };
}
