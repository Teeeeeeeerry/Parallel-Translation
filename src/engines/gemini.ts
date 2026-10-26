// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — Google Gemini 翻译引擎（BYOK）。
// 与 OpenAI 相同的编号批量策略，复用 parseNumbered。
//
// #335: 骨架（闸门 / 取 key / 分类抛错）走公共构造 createByokEngine。
// 错误体特例（读响应体才能定类别）保留在适配器内（classifyError），
// 未搬进公共构造；请求格式与凭据传递方式（x-goog-api-key 请求头）
// 与改造前一致。

import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import {
  classifyStatus,
  buildNumberedPrompt,
  verdictOf,
  type ErrorVerdict,
  type ProbeSpec,
} from './shared';
import { createByokEngine } from './byok';
import type { TranslateEngine } from './types';
import { parseNumbered } from './openai-compat';

/**
 * Gemini 的错误分类器 —— #161 / #236 / #257 / #335，翻译与测试连接共用（#1147）。
 *
 * Gemini 的 400 覆盖多种情况：key 无效、上下文过长（input too large）、
 * 内容被安全拦截；403 也不只来自 key。此前一律判「key 无效」且
 * retryable=false，router 直接抛错不尝试后续引擎，超长文本/模型名错误
 * 会让整页翻译失败。这里只对确凿的认证错误置 invalid-key（不重试），
 * 其余 400/404（超长、模型名、安全拦截）与 5xx 归为瞬时，交给下一
 * 引擎降级或批次重试；瞬时错误带上错误体里的原因（#323：测试连接时模型名
 * 填错的用户看得到真实原因）。
 *
 * 状态码维度走公共判定 classifyStatus（#239）。错误体不是 JSON 时没有可读的
 * 原因，交回按状态码的默认分类 —— 原先测试连接这时另走一条路，与翻译不一致。
 */
async function classifyGeminiError(resp: Response): Promise<ErrorVerdict | null> {
  let status = '';
  let message = '';
  try {
    // Gemini 错误体形如 { error: { code, message, status } }
    const body = (await resp.json()) as {
      error?: { status?: string; message?: string };
    };
    status = body.error?.status ?? '';
    message = body.error?.message ?? '';
  } catch {
    // 非 JSON 错误体，按状态码兜底
    return null;
  }

  // 引擎特例（#257/#335）：错误体明示认证失败 → key 无效
  const isAuthByBody =
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    /API key/i.test(message) ||
    /API_KEY_INVALID/i.test(message);
  if (isAuthByBody) return verdictOf('invalid-key', resp.status);

  // 401/403 → key 无效、429 → 配额照默认；其余（上下文过长 / 模型名错误 /
  // 安全拦截 / 5xx 等）→ 瞬时，携带错误体原因
  if (message && classifyStatus('gemini', resp) === 'transient') {
    return verdictOf('transient', resp.status, `HTTP ${resp.status}：${message}`);
  }
  return null;
}

/** 当前生效的模型名（设置优先，缺省回落到 schema 默认）。 */
function currentModel(): string {
  return getSettings().models?.gemini ?? DEFAULT_MODELS.gemini!;
}

/** 连通性探测规格（#321）：GET /v1beta/models/{model}，凭据走请求头。 */
export const geminiProbe: ProbeSpec = {
  engineId: 'gemini',
  buildRequest: ({ key, model }) => ({
    url:
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      (model ?? DEFAULT_MODELS.gemini),
    headers: { 'x-goog-api-key': key },
  }),
  // 与翻译路径同一个分类器（#1147）
  classifyError: classifyGeminiError,
};

export const gemini: TranslateEngine = createByokEngine({
  id: 'gemini',
  displayName: 'Gemini',
  supportedLangs: 'all',
  termHandling: 'inject',
  model: currentModel,

  // 请求格式与凭据传递方式（走请求头而非查询串）与改造前一致（#335）；
  // 本批命中的术语沿用 #381 的格式追加在编号文本之后（#382）
  buildRequest: ({ texts, from, to, terms }, key, model) => ({
    url:
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildNumberedPrompt(to, from, texts, terms) }] }],
      generationConfig: { temperature: 0 },
    }),
  }),

  // 读错误体才能区分认证失败与模型名错误 / 内容过长（#335）；与测试连接共用
  classifyError: classifyGeminiError,

  parseResponse: (data, expected) => {
    const raw =
      (
        data as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        }
      ).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { translations: parseNumbered(raw, expected) };
  },
});
