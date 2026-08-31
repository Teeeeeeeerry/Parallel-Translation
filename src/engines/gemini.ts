// Phase 7 — Google Gemini 翻译引擎（BYOK）。
// 与 OpenAI 相同的编号批量策略，复用 parseNumbered。

import { getKey } from '~/src/storage/keys';
import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import {
  classifyStatus,
  buildNumberedPrompt,
  type ProbeResult,
  type ProbeSpec,
} from './shared';
import type { TranslateEngine } from './types';
import { parseNumbered } from './openai';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

/**
 * 按 Gemini 错误响应区分失败类别 —— #161 / #236 / #257。
 *
 * Gemini 的 400 覆盖多种情况：key 无效、上下文过长（input too large）、
 * 内容被安全拦截；403 也不只来自 key。此前一律判「key 无效」且
 * retryable=false，router 直接抛错不尝试后续引擎，超长文本/模型名错误
 * 会让整页翻译失败。这里只对确凿的认证错误置 invalid-key（不重试），
 * 其余 400/404（超长、模型名、安全拦截）与 5xx 归为瞬时，交给下一
 * 引擎降级或批次重试。
 *
 * 状态码维度走公共判定 classifyStatus（#257）；错误体明示认证失败
 * （#161 的 400 + API key 文案）是 gemini 特有特例，保留在适配器内。
 */
async function classifyError(resp: Response): Promise<EngineError> {
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

  // 引擎特例（#257 保留在适配器内）：错误体明示认证失败 → key 无效
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
  // router 降级到下一引擎，页面翻译不中断
  const detail = message ? `：${message}` : '';
  return new EngineError('gemini', true, `HTTP ${resp.status}${detail}`, 'transient');
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
  // 情况交回公共状态码分类（瞬时）。
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
    return null;
  },
};

export const gemini: TranslateEngine = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresKey: true,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    // #159: 整个请求体过闸门，限制并发在飞请求数
    return getGate()(async () => {
      const key = await getKey('gemini');
      if (!key)
        throw new EngineError('gemini', false, '未配置 API key', 'invalid-key');

      const model = getSettings().models?.gemini ?? DEFAULT_MODELS.gemini!;
      // key 走 x-goog-api-key 请求头而非 ?key= query。
      // URL 会进浏览器网络日志、DevTools 记录与任何中间层的访问日志，请求头不会；
      // 另两个引擎也都是走头，保持一致。
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      // #257: 编号提示词走公共模板（模板唯一来源）—— 格式与现状逐字一致
      const prompt = buildNumberedPrompt(to, from, texts);

      const resp = await fetchWithTimeout('gemini', endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 },
        }),
      });

      if (!resp.ok) {
        throw await classifyError(resp);
      }

      const data = await resp.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const out = parseNumbered(raw, texts.length);
      return { translations: out };
    });
  },
};
