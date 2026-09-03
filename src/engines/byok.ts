// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 自带 key 引擎公共构造 —— #309 架构评审候选 6（#333）。
//
// openai / deepl / gemini 三家自带 key 引擎此前各自重复同一段骨架：
// 过并发闸门 → 取 key → 缺 key 抛不可重试错误 → 发请求 → 按公共判定
// 分类 → 按类别抛错。本模块把这段骨架收敛为 createByokEngine：
//   - 闸门保持在最外层：整个请求体（含取 key）都在闸门内
//   - 每家引擎仍持有各自的模块级惰性单例闸门（engineGate 实例）
//   - 缺 key 时不发请求，抛不可重试的 key 无效类错误
//   - 失败分类走公共判定 classifyStatus；需要读错误响应体才能定类别
//     的引擎（Gemini）由适配器经 classifyError 提供特例
// 适配器只保留：端点、请求头、请求体构造、响应解析。

import { getKey } from '~/src/storage/keys';
import type { EngineId } from '~/src/storage/schema';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import { classifyStatus } from './shared';
import type { TranslateEngine, TranslateRequest, TranslateResponse } from './types';

/** 适配器提供的引擎特例（端点 / 请求构造 / 响应解析 / 错误体特例）。 */
export interface ByokEngineSpec {
  id: EngineId;
  displayName: string;
  supportedLangs: string[] | 'all';
  /** 模型名（有模型概念的引擎）；无则省略。 */
  model?: () => string;
  /**
   * 构造请求（key 已取到，model 已计算）。凭据一律走请求头，
   * 不进查询串。
   */
  buildRequest(
    req: TranslateRequest,
    key: string,
    model?: string,
  ): { url: string; headers: Record<string, string>; body?: string };
  /** 解析成功响应为译文（长度必须与请求文本数一致）。 */
  parseResponse(data: unknown, expected: number): TranslateResponse;
  /**
   * 错误分类特例（读错误响应体才能定类别的引擎）—— 返回非 null 即
   * 采用该错误；返回 null 走公共状态码分类（#239）。
   */
  classifyError?(resp: Response): Promise<EngineError | null>;
}

/**
 * 自带 key 引擎公共构造（#333）。
 * 骨架顺序：闸门包裹整个请求体（含取 key）→ 缺 key 抛不可重试的
 * key 无效类错误 → 构造请求 → 发送 → 公共分类 / 适配器特例 → 按类别
 * 抛错 → 成功解析。
 */
export function createByokEngine(spec: ByokEngineSpec): TranslateEngine {
  // #159: 引擎级并发闸门 —— 每家引擎持有各自的模块级惰性单例
  const getGate = engineGate();

  return {
    id: spec.id,
    displayName: spec.displayName,
    requiresKey: true,
    supportedLangs: spec.supportedLangs,

    async translate(req) {
      // #333: 闸门保持在最外层 —— 整个请求体（含取 key）都在闸门内
      return getGate()(async () => {
        const key = await getKey(spec.id);
        if (!key)
          throw new EngineError(
            spec.id,
            false,
            '未配置 API key',
            'invalid-key',
          );

        const model = spec.model?.();
        const { url, headers, body } = spec.buildRequest(req, key, model);

        const resp = await fetchWithTimeout(spec.id, url, {
          method: 'POST',
          headers,
          ...(body ? { body } : {}),
        });

        if (!resp.ok) {
          // 适配器特例优先（读错误体定类别）
          if (spec.classifyError) {
            const special = await spec.classifyError(resp);
            if (special) throw special;
          }
          // 公共状态分类（#239）：401/403 → key 无效、429 → 配额、其余 → 瞬时
          const category = classifyStatus(spec.id, resp, true);
          if (category === 'invalid-key') {
            throw new EngineError(spec.id, false, 'API key 无效', 'invalid-key');
          }
          if (category === 'quota') {
            throw new EngineError(spec.id, false, '配额已用尽', 'quota', true);
          }
          throw new EngineError(spec.id, true, `HTTP ${resp.status}`, 'transient');
        }

        const data = await resp.json();
        return spec.parseResponse(data, req.texts.length);
      });
    },
  };
}
