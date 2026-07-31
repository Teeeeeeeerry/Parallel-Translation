// Phase 7 — Google Gemini 翻译引擎（BYOK）。
// 与 OpenAI 相同的编号批量策略，复用 parseNumbered。

import { getKey } from '~/src/storage/keys';
import { getSettings } from '~/src/storage/settings';
import { EngineError } from './types';
import { parseNumbered } from './openai';
import type { TranslateEngine } from './types';

export const gemini: TranslateEngine = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresKey: true,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const key = await getKey('gemini');
    if (!key) throw new EngineError('gemini', false, '未配置 API key');

    const model = getSettings().models?.gemini ?? 'gemini-2.0-flash';
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const prompt =
      `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言：${from}）`}。` +
      `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}`;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    if (resp.status === 400 || resp.status === 403) {
      // 400 可能是无效 key（Gemini 把 auth 错误也打成 400）
      throw new EngineError('gemini', false, 'API key 无效');
    }
    if (!resp.ok) {
      throw new EngineError('gemini', true, `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const out = parseNumbered(raw, texts.length);
    return { translations: out };
  },
};
