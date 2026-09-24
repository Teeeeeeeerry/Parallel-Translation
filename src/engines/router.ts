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
import { getEffectiveDomains } from '~/src/storage/domains';
import type { Term } from '~/src/storage/domains';
import { matchTerms, uniqueTerms, maskNoTranslate, unmaskNoTranslate } from './terms';
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

/**
 * 请求里每段原文命中的术语（#380）。请求不带领域 ID、或领域已不存在
 * （例如刚被删除）时，每段都视为没有命中。
 */
async function termHits(req: TranslateRequest): Promise<Term[][]> {
  const domain = req.domainId
    ? (await getEffectiveDomains()).find((d) => d.id === req.domainId)
    : undefined;
  return req.texts.map((text) => (domain ? matchTerms(domain.terms, text) : []));
}

/**
 * 该引擎实际生效的术语（#419）：AI 引擎注入全部命中术语；Google 等机翻
 * 引擎只用占位符落实“不翻译”术语（#386）；其余引擎不处理术语。缓存 key
 * 的术语哈希只算这些术语 —— 不生效的术语改了也不该让缓存失效。
 * 机翻引擎“指定译法”开关（#390）打开后，占位符引擎也要算上指定译法的
 * 术语，开关状态一并进哈希。
 */
function effectiveTerms(engine: TranslateEngine, terms: readonly Term[]): Term[] {
  if (engine.injectsTerms) return [...terms];
  if (engine.masksNoTranslate) return terms.filter((t) => t.noTranslate === true);
  return [];
}

export async function route(req: TranslateRequest): Promise<TranslateResponse> {
  const { enginePriority, useCache } = getSettings();
  const errors: EngineError[] = [];

  // 结果槽位，null 表示尚未取得
  const translations: (string | null)[] = new Array(req.texts.length).fill(
    null,
  );

  // #380: 每段原文命中的术语 —— 参与缓存 key，改了术语不命中旧译文
  const hits = await termHits(req);

  // #440: 已有段落成功后遇到的不可重试错误 —— 结束引擎循环，随部分结果返回
  let fatal: EngineError | null = null;

  for (const id of enginePriority) {
    const engine = REGISTRY[id];
    if (!engine) continue;

    // #175: BYOK 引擎的模型名参与缓存 key —— 切换模型后不命中旧译文
    const model = getSettings().models?.[id] ?? DEFAULT_MODELS[id] ?? '';
    // #419: 参与缓存 key 的只是本引擎实际生效的术语
    const keyTerms = hits.map((h) => effectiveTerms(engine, h));

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
          const k = await cacheKey(id, req.from, req.to, text, model, keyTerms[i]);
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
      // #381: 只带本批（未命中缓存的段落）命中的术语，不发送整个领域
      const batchTerms = uniqueTerms(uncached.flatMap((u) => hits[u.idx]!));
      // #386: 机翻引擎发送前把“不翻译”术语换成占位符
      const masks = engine.masksNoTranslate
        ? uncached.map((u) => maskNoTranslate(u.text, hits[u.idx]!))
        : null;
      const subReq: TranslateRequest = {
        texts: masks ? masks.map((m) => m.text) : uncached.map((u) => u.text),
        from: req.from,
        to: req.to,
        ...(batchTerms.length > 0 && { terms: batchTerms }),
      };
      const resp = await engine.translate(subReq);

      // #171: 引擎可能返回短于请求长度的译文数组（第三方 API 异常形状）。
      // 短出的槽位若填 undefined，content 侧 restorePreserves 会抛
      // TypeError —— 一律置 null 并记入失败，交给下一个引擎补齐。
      const failed = [...(resp.failedIndices ?? [])];
      // #389: 占位符被改坏的段落，稍后改用原文重译一次
      const corrupted: number[] = [];
      for (let j = 0; j < uncached.length; j++) {
        const raw = resp.translations[j];
        if (raw === undefined || raw === null || failed.includes(j)) {
          translations[uncached[j]!.idx] = null;
          if (!failed.includes(j)) failed.push(j);
          continue;
        }
        // #386: 占位符换回原词；占位符被引擎改坏 → 不采用这份译文
        const text = masks ? unmaskNoTranslate(raw, masks[j]!.originals) : raw;
        if (text === null) {
          translations[uncached[j]!.idx] = null;
          corrupted.push(j);
        } else {
          translations[uncached[j]!.idx] = text;
        }
      }

      // #389: 损坏段落用未替换术语的原文、不带术语重译一次。重译失败的
      // 段落按失败槽位处理，交给下一个引擎。
      const plain = new Set<number>();
      if (corrupted.length > 0) {
        for (const j of corrupted) {
          console.warn('[PT] “不翻译”术语占位符被引擎改坏，改用原文重译该段', {
            engine: id,
            index: uncached[j]!.idx,
          });
        }
        let retried: (string | undefined)[] = [];
        try {
          const retry = await engine.translate({
            texts: corrupted.map((j) => uncached[j]!.text),
            from: req.from,
            to: req.to,
          });
          retried = corrupted.map((_, k) =>
            retry.failedIndices?.includes(k) ? undefined : (retry.translations[k] ?? undefined),
          );
        } catch {
          // 重译出错：这些段落交给下一个引擎
        }
        corrupted.forEach((j, k) => {
          // 与首次译文同一口径：只有缺失的槽位算失败
          const text = retried[k];
          if (text !== undefined) {
            translations[uncached[j]!.idx] = text;
            plain.add(j);
          } else {
            failed.push(j);
          }
        });
      }

      // 并行写缓存（仅成功的条目）。缓存换回原词后的译文（#386），不是
      // 引擎原始输出。原文重译的译文没有遵守术语：写到不带术语哈希的
      // key 下（#389），同时写到带术语哈希的 key 下并标记“未遵守术语”，
      // 同一段原文再次翻译时直接命中，不再重走回退（#428）
      if (useCache) {
        await Promise.all(
          uncached.map(async (u, j) => {
            if (failed.includes(j)) return;
            const val = translations[u.idx];
            // #171: 短数组下成功槽位必然有值，这里再做一次防御
            if (val === undefined || val === null) return;
            const key = await cacheKey(id, req.from, req.to, u.text, model, keyTerms[u.idx]);
            if (!plain.has(j)) {
              await cacheSet(key, val);
              return;
            }
            await cacheSet(await cacheKey(id, req.from, req.to, u.text, model), val);
            await cacheSet(key, val, { ignoresTerms: true });
          }),
        );
      }

      // 处理部分失败：失败槽位保持 null，交给下一个引擎重试
      if (failed.length > 0) {
        errors.push(
          new EngineError(
            id,
            true,
            `${failed.length}/${uncached.length} 条失败，尝试下一个引擎`,
          ),
        );
        continue; // 下一个引擎自动拾取 translations[i] === null 的槽位
      }

      return {
        translations: translations as string[],
        detectedFrom: resp.detectedFrom,
      };
    } catch (e) {
      const err =
        e instanceof EngineError ? e : new EngineError(id, true, e instanceof Error ? e.message : String(e));
      errors.push(err);
      if (err.retryable) continue; // retryable → 下一个引擎重试
      // #440: 还没有任何段落取得译文（含缓存命中）时照旧抛出；否则不再
      // 尝试后面的引擎，已成功的段落随部分失败结果返回
      if (translations.every((t) => t === null)) throw err;
      fatal = err;
      break;
    }
  }

  const summary = errors.map((e) => `${e.engineId}(${e.message})`).join(', ');

  // #416: 最后一个引擎仍有失败段落时，已成功的段落照常返回，失败段落
  // 经 failedIndices 标记（槽位填空串）；全部失败才抛聚合错误。#440: 因
  // 不可重试错误提前结束时同样返回，并带上该错误的类别与原因
  const failedIndices = translations.flatMap((t, i) => (t === null ? [i] : []));
  if (failedIndices.length < translations.length) {
    console.warn('[PT] 部分段落在所有引擎上都失败', { failedIndices, errors: summary });
    return {
      translations: translations.map((t) => t ?? ''),
      failedIndices,
      ...(fatal && { failure: { category: fatal.category, error: fatal.message } }),
    };
  }

  // #237: 聚合失败显式构造类型化结果（瞬时、可重试）—— 不再抛裸普通
  // Error，消除「普通 Error 即隐式可重试」的启发式
  throw new AllEnginesFailedError(summary, errors);
}
