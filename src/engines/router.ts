// Phase 2 — 引擎路由器。
// 按设置的 enginePriority 依次尝试，retryable 失败才切下一个引擎。
// 集成翻译缓存：先查后写，二次请求不碰网络。

import { getSettings } from '~/src/storage/settings';
import { cacheGet, cacheSet, cacheKey } from '~/src/storage/cache';
import { googleWeb } from './google-web';
import { bingEdge } from './bing-edge';
import { EngineError } from './types';
import type { TranslateEngine, TranslateRequest, TranslateResponse } from './types';

const REGISTRY: Record<string, TranslateEngine> = {
  'google-web': googleWeb,
  'bing-edge': bingEdge,
  // 阶段 7 追加 openai / deepl / gemini
};

export async function route(req: TranslateRequest): Promise<TranslateResponse> {
  const { enginePriority, useCache, from, to } = getSettings();
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
      for (let i = 0; i < req.texts.length; i++) {
        if (translations[i] !== null) continue;
        const k = await cacheKey(id, from, to, req.texts[i]!);
        const cached = await cacheGet(k);
        if (cached !== null) {
          translations[i] = cached;
        } else {
          uncached.push({ idx: i, text: req.texts[i]! });
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
        from,
        to,
      };
      const resp = await engine.translate(subReq);

      // 将译文放回正确槽位
      for (let j = 0; j < uncached.length; j++) {
        translations[uncached[j]!.idx] = resp.translations[j]!;
      }

      // 写缓存
      if (useCache) {
        for (let j = 0; j < uncached.length; j++) {
          const k = await cacheKey(id, from, to, uncached[j]!.text);
          await cacheSet(k, resp.translations[j]!);
        }
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
