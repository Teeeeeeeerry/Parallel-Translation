// Phase 7 — Google Gemini 翻译引擎（BYOK）。
// 与 OpenAI 相同的编号批量策略，复用 parseNumbered。

import { getKey } from '~/src/storage/keys';
import { getSettings } from '~/src/storage/settings';
import { normalizeText } from '~/src/dom/normalize';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import { parseNumbered } from './openai';
import type { TranslateEngine } from './types';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

/**
 * 按 Gemini 错误体区分错误类别 —— #161。
 *
 * Gemini 的 400 覆盖多种情况：key 无效、上下文过长（input too large）、
 * 内容被安全拦截；403 也不只来自 key。此前一律判「key 无效」且
 * retryable=false，router 直接抛错不尝试后续引擎，超长文本/模型名错误
 * 会让整页翻译失败。这里只对确凿的认证错误置 non-retryable，
 * 其余 400/404（超长、模型名、安全拦截）交给下一引擎降级。
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

  // 确凿的认证错误 → 立即提示用户，不浪费后续引擎
  const isAuth =
    resp.status === 403 ||
    status === 'UNAUTHENTICATED' ||
    status === 'PERMISSION_DENIED' ||
    /API key/i.test(message) ||
    /API_KEY_INVALID/i.test(message);
  if (isAuth) {
    return new EngineError('gemini', false, 'API key 无效');
  }

  // 其余错误（上下文过长 / 模型名错误 / 安全拦截等）→ retryable，
  // router 降级到下一引擎，页面翻译不中断
  const detail = message ? `：${message}` : '';
  return new EngineError('gemini', true, `HTTP ${resp.status}${detail}`);
}

export const gemini: TranslateEngine = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresKey: true,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    // #159: 整个请求体过闸门，限制并发在飞请求数
    return getGate()(async () => {
      const key = await getKey('gemini');
      if (!key) throw new EngineError('gemini', false, '未配置 API key');

      const model = getSettings().models?.gemini ?? 'gemini-2.0-flash';
      // key 走 x-goog-api-key 请求头而非 ?key= query。
      // URL 会进浏览器网络日志、DevTools 记录与任何中间层的访问日志，请求头不会；
      // 另两个引擎也都是走头，保持一致。
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      // 与 openai 相同（#30）：编号结构靠 \n 分隔，文本自带换行会把编号撑破
      // 导致 LLM 重编号、parseNumbered 回填错位，拼 prompt 前压一次（#160）。
      const numbered = texts
        .map((t, i) => `${i + 1}. ${normalizeText(t)}`)
        .join('\n');
      const prompt =
        `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言：${from}）`}。` +
        `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}`;

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
