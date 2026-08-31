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
  type ProbeResult,
  type ProbeSpec,
} from './shared';
import { createByokEngine } from './byok';
import { EngineError } from './types';
import type { TranslateEngine } from './types';
import { parseNumbered } from './openai';

/**
 * 按 Gemini 错误响应区分失败类别 —— #161 / #236 / #257 / #335。
 *
 * Gemini 的 400 覆盖多种情况：key 无效、上下文过长（input too large）、
 * 内容被安全拦截；403 也不只来自 key。此前一律判「key 无效」且
 * retryable=false，router 直接抛错不尝试后续引擎，超长文本/模型名错误
 * 会让整页翻译失败。这里只对确凿的认证错误置 invalid-key（不重试），
 * 其余 400/404（超长、模型名、安全拦截）与 5xx 归为瞬时，交给下一
 * 引擎降级或批次重试。
 *
 * 状态码维度走公共判定 classifyStatus（#239）；错误体明示认证失败
 * （#161 的 400 + API key 文案）是 gemini 特有特例，保留在适配器内。
 */
async function classifyGeminiError(resp: Response): Promise<EngineError> {
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
  }

  // 引擎特例（#257/#335 保留在适配器内）：错误体明示认证失败 → key 无效
  const isAuthByBody =
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    /API key/i.test(message) ||
    /API_KEY_INVALID/i.test(message);

  // 状态码维度走公共判定（#257）：401/403 → invalid-key；429 → quota；
  // 其余非 2xx → transient
  const category = classifyStatus('gemini', resp, true);
  if (isAuthByBody || category === 'invalid-key') {
    return new EngineError('gemini', false, 'API key 无效', 'invalid-key');
  }
  if (category === 'quota') {
    return new EngineError('gemini', false, '配额已用尽', 'quota', true);
  }
  // 其余错误（上下文过长 / 模型名错误 / 安全拦截 / 5xx 等）→ 瞬时，
  // 携带错误体原因（与改造前文案一致，既有用例断言）
  const detail = message ? `：${message}` : '';
  return new EngineError('gemini', true, `HTTP ${resp.status}${detail}`, 'transient');
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
  // 引擎特例（#321/#257 保留在适配器内）：Gemini 的 400 覆盖多种情况，
  // 只有错误体明示认证失败才是 key 问题；模型名错误 / 内容过长等其余
  // 情况报告真实原因（#323 —— 此前任意非 2xx 一律报「API key 无效」，
  // 模型名填错的用户被误导去重新申请 key）。
  classifyError: async (resp): Promise<ProbeResult | null> => {
    let status = '';
    let message = '';
    try {
      const body = (await resp.json()) as {
        error?: { status?: string; message?: string };
      };
      status = body.error?.status ?? '';
      message = body.error?.message ?? '';
    } catch {
      // 非 JSON 错误体，交回公共状态码分类
      return null;
    }
    const isAuthByBody =
      status === 'UNAUTHENTICATED' ||
      status === 'PERMISSION_DENIED' ||
      /API key/i.test(message) ||
      /API_KEY_INVALID/i.test(message);
    if (isAuthByBody) {
      return { ok: false, category: 'invalid-key', message: 'API key 无效' };
    }
    // 模型名错误 / 内容过长 / 安全拦截 / 5xx 等：与翻译路径同一分类
    const category = classifyStatus('gemini', resp, true);
    if (category === 'quota') {
      return { ok: false, category: 'quota', message: '配额已用尽' };
    }
    const detail = message ? `：${message}` : '';
    return {
      ok: false,
      category: 'transient',
      message: `HTTP ${resp.status}${detail}`,
    };
  },
};

export const gemini: TranslateEngine = createByokEngine({
  id: 'gemini',
  displayName: 'Gemini',
  supportedLangs: 'all',
  model: currentModel,

  // 请求格式与凭据传递方式（走请求头而非查询串）与改造前一致（#335）
  buildRequest: ({ texts, from, to }, key, model) => ({
    url:
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildNumberedPrompt(to, from, texts) }] }],
      generationConfig: { temperature: 0 },
    }),
  }),

  // 错误体特例保留在适配器内（#335）：读错误体才能区分认证失败与
  // 模型名错误 / 内容过长；公共构造未为此新增特例扩展点
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
