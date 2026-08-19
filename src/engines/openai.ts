// Phase 7 — OpenAI 兼容翻译引擎（BYOK）。
// 端点默认 api.openai.com/v1，也可用于任何兼容的 OpenAI API 代理。
// 批量策略：编号后整批送，一次往返拿回全部译文，避免逐段请求的高延迟和高费用。

import { getKey } from '~/src/storage/keys';
import { getSettings } from '~/src/storage/settings';
import { normalizeText } from '~/src/dom/normalize';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import type { TranslateEngine } from './types';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

/**
 * 解析 LLM 编号输出为译文数组。
 * LLM 有概率漏行、多输出或改变编号格式，必须建 Map 后按预期长度回填 ——
 * 长度不匹配会导致译文整体错位挂到错误段落上，比翻译失败更糟。
 */
export function parseNumbered(raw: string, expected: number): string[] {
  const map = new Map<number, string>();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m?.[1] && m?.[2]) map.set(Number(m[1]), m[2].trim());
  }
  return Array.from({ length: expected }, (_, i) => map.get(i + 1) ?? '');
}

export const openai: TranslateEngine = {
  id: 'openai',
  displayName: 'OpenAI',
  requiresKey: true,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    // #159: 整个请求体过闸门，限制并发在飞请求数
    return getGate()(async () => {
      const key = await getKey('openai');
      if (!key) throw new EngineError('openai', false, '未配置 API key');

      const model = getSettings().models?.openai ?? 'gpt-4o-mini';

      // 纵深防御：编号结构靠 \n 分隔，文本自带的换行会把编号撑破导致错位。
      // 即便入口采集漏了归一化，这里也必须兜住，拼 prompt 前再压一次。
      const numbered = texts
        .map((t, i) => `${i + 1}. ${normalizeText(t)}`)
        .join('\n');
      const prompt =
        `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言：${from}）`}。` +
        `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}`;

      const resp = await fetchWithTimeout('openai', DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        }),
      });

      if (resp.status === 401 || resp.status === 403) {
        throw new EngineError('openai', false, 'API key 无效');
      }
      if (!resp.ok) {
        throw new EngineError('openai', true, `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      const out = parseNumbered(raw, texts.length);
      return { translations: out };
    });
  },
};
