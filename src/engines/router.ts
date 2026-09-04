// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 2 — 引擎路由器。
// 按设置的 enginePriority 依次尝试，retryable 失败才切下一个引擎。
// 集成翻译缓存：先查后写，二次请求不碰网络。

import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import { cacheGet, cacheSet, cacheKey } from '~/src/storage/cache';
import { googleWeb } from './google-web';
import { bingEdge } from './bing-edge';
import { openai } from './openai';
import { deepl } from './deepl';
import { gemini } from './gemini';
import { EngineError, AllEnginesFailedError } from './types';
import type { TranslateEngine, TranslateRequest, TranslateResponse } from './types';

const REGISTRY: Record<string, TranslateEngine> = {
  'google-web': googleWeb,
  'bing-edge': bingEdge,
  'openai': openai,
  'deepl': deepl,
  'gemini': gemini,
};

export async function route(req: TranslateRequest): Promise<TranslateResponse> {
  const { enginePriority, useCache } = getSettings();
  const errors: EngineError[] = [];

  // 结果槽位，null 表示尚未取得
  const translations: (string | null)[] = new Array(req.texts.length).fill(
    null,
  );

  for (const id of enginePriority) {
    const engine = REGISTRY[id];
    if (!engine) continue;

    // #175: BYOK 引擎的模型名参与缓存 key —— 切换模型后不命中旧译文
    const model = getSettings().models?.[id] ?? DEFAULT_MODELS[id] ?? '';

    if (
      engine.supportedLangs !== 'all' &&
      !engine.supportedLangs.includes(req.to)
    ) {
      continue;
    }

    // 收集尚未翻译的位置
    const uncached: { idx: number; text: string }[] = [];

    if (useCache) {
      // 并行查询缓存 —— cacheKey 内的 crypto.subtle.digest 是纯 CPU 操作，
      // N 条可以并行计算，消除串行 for-await 的 2N 次往返延迟。
      const cacheChecks = await Promise.all(
        req.texts.map(async (text, i) => {
          if (translations[i] !== null) return { i, cached: null, text };
          const k = await cacheKey(id, req.from, req.to, text, model);
          const cached = await cacheGet(k);
          return { i, cached, text };
        }),
      );

      for (const { i, cached, text } of cacheChecks) {
        if (translations[i] !== null) continue;
        if (cached !== null) {
          translations[i] = cached;
        } else {
          uncached.push({ idx: i, text: text! });
        }
      }
    } else {
      for (let i = 0; i < req.texts.length; i++) {
        // 必须跳过已填充槽位：上一引擎部分失败后，下一引擎只补
        // 失败槽位，否则会重翻全部并覆盖已成功的译文（#120 TC-E2E-33）
        if (translations[i] !== null) continue;
        uncached.push({ idx: i, text: req.texts[i]! });
      }
    }

    // 全部命中缓存，直接返回
    if (uncached.length === 0) {
      return { translations: translations as string[] };
    }

    try {
      const subReq: TranslateRequest = {
        texts: uncached.map((u) => u.text),
        from: req.from,
        to: req.to,
      };
      const resp = await engine.translate(subReq);

      // #171: 引擎可能返回短于请求长度的译文数组（第三方 API 异常形状）。
      // 短出的槽位若填 undefined，content 侧 restorePreserves 会抛
      // TypeError —— 一律置 null 并记入失败，交给下一个引擎补齐。
      const failed = [...(resp.failedIndices ?? [])];
      for (let j = 0; j < uncached.length; j++) {
        const text = resp.translations[j];
        if (text === undefined || text === null) {
          translations[uncached[j]!.idx] = null;
          failed.push(j);
        } else {
          translations[uncached[j]!.idx] = text;
        }
      }

      // 处理部分失败：将失败槽位重置为 null，交给下一个引擎重试
      if (failed.length > 0) {
        for (const j of resp.failedIndices ?? []) {
          translations[uncached[j]!.idx] = null;
        }

        // 并行写缓存（仅成功的条目）
        if (useCache) {
          const succeeded = uncached.filter((_, j) => !failed.includes(j));
          if (succeeded.length > 0) {
            await Promise.all(
              succeeded.map(async (u) => {
                const k = await cacheKey(id, req.from, req.to, u.text, model);
                const idx = uncached.indexOf(u);
                const val = resp.translations[idx];
                // #171: 短数组下成功槽位必然有值，这里再做一次防御
                if (val !== undefined && val !== null) {
                  await cacheSet(k, val);
                }
              }),
            );
          }
        }

        errors.push(
          new EngineError(
            id,
            true,
            `${failed.length}/${uncached.length} 条失败，尝试下一个引擎`,
          ),
        );
        continue; // 下一个引擎自动拾取 translations[i] === null 的槽位
      }

      // 全部成功 → 并行写缓存
      if (useCache) {
        await Promise.all(
          uncached.map(async (u) => {
            const k = await cacheKey(id, req.from, req.to, u.text, model);
            const idx = uncached.indexOf(u);
            await cacheSet(k, resp.translations[idx]!);
          }),
        );
      }

      return {
        translations: translations as string[],
        detectedFrom: resp.detectedFrom,
      };
    } catch (e) {
      const err =
        e instanceof EngineError ? e : new EngineError(id, true, e instanceof Error ? e.message : String(e));
      errors.push(err);
      if (!err.retryable) throw err;
      // retryable → 下一个引擎重试
    }
  }

  // #237: 聚合失败显式构造类型化结果（瞬时、可重试）—— 不再抛裸普通
  // Error，消除「普通 Error 即隐式可重试」的启发式
  throw new AllEnginesFailedError(
    errors.map((e) => `${e.engineId}(${e.message})`).join(', '),
    errors,
  );
}
