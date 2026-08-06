// Phase 2 — 引擎路由器。
// 按设置的 enginePriority 依次尝试，retryable 失败才切下一个引擎。
// 集成翻译缓存：先查后写，二次请求不碰网络。

import { getSettings } from '~/src/storage/settings';
import { cacheGet, cacheSet, cacheKey } from '~/src/storage/cache';
import { googleWeb } from './google-web';
import { bingEdge } from './bing-edge';
import { openai } from './openai';
import { deepl } from './deepl';
import { gemini } from './gemini';
import { EngineError } from './types';
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
          const k = await cacheKey(id, req.from, req.to, text);
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

      // 将译文放回正确槽位
      for (let j = 0; j < uncached.length; j++) {
        translations[uncached[j]!.idx] = resp.translations[j]!;
      }

      // 处理部分失败：将失败槽位重置为 null，交给下一个引擎重试
      if (resp.failedIndices && resp.failedIndices.length > 0) {
        for (const j of resp.failedIndices) {
          translations[uncached[j]!.idx] = null;
        }

        // 并行写缓存（仅成功的条目）
        if (useCache) {
          const succeeded = uncached.filter(
            (_, j) => !resp.failedIndices!.includes(j),
          );
          if (succeeded.length > 0) {
            await Promise.all(
              succeeded.map(async (u) => {
                const k = await cacheKey(id, req.from, req.to, u.text);
                const idx = uncached.indexOf(u);
                await cacheSet(k, resp.translations[idx]!);
              }),
            );
          }
        }

        errors.push(
          new EngineError(
            id,
            true,
            `${resp.failedIndices.length}/${uncached.length} 条失败，尝试下一个引擎`,
          ),
        );
        continue; // 下一个引擎自动拾取 translations[i] === null 的槽位
      }

      // 全部成功 → 并行写缓存
      if (useCache) {
        await Promise.all(
          uncached.map(async (u) => {
            const k = await cacheKey(id, req.from, req.to, u.text);
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
        e instanceof EngineError ? e : new EngineError(id, true, String(e));
      errors.push(err);
      if (!err.retryable) throw err;
      // retryable → 下一个引擎重试
    }
  }

  throw new Error(
    `所有引擎均失败: ${errors.map((e) => `${e.engineId}(${e.message})`).join(', ')}`,
  );
}
