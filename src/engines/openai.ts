// Phase 7 — OpenAI 兼容翻译引擎（BYOK）。
// 端点默认 api.openai.com/v1，也可用于任何兼容的 OpenAI API 代理。
// 批量策略：编号后整批送，一次往返拿回全部译文，避免逐段请求的高延迟和高费用。

import { getKey } from '~/src/storage/keys';
import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import { classifyStatus, buildNumberedPrompt } from './shared';
import type { ProbeSpec } from './shared';
import type { TranslateEngine } from './types';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

/** 连通性探测规格（#321）：GET /v1/models，凭据走请求头。 */
export const openaiProbe: ProbeSpec = {
  engineId: 'openai',
  buildRequest: ({ key }) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
};

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
      if (!key)
        throw new EngineError('openai', false, '未配置 API key', 'invalid-key');

      const model = getSettings().models?.openai ?? DEFAULT_MODELS.openai!;

      // #258: 编号提示词走公共模板（模板唯一来源）—— 格式与现状逐字一致
      const prompt = buildNumberedPrompt(to, from, texts);

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

      // #258: 状态分类走公共判定（口径：#239）—— 401/403 → key 无效、
      // 429 → 配额、其余非 2xx → 瞬时
      const category = classifyStatus('openai', resp, true);
      if (category === 'invalid-key') {
        throw new EngineError('openai', false, 'API key 无效', 'invalid-key');
      }
      if (category === 'quota') {
        throw new EngineError('openai', false, '配额已用尽', 'quota', true);
      }
      if (!resp.ok) {
        throw new EngineError('openai', true, `HTTP ${resp.status}`, 'transient');
      }

      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      const out = parseNumbered(raw, texts.length);
      return { translations: out };
    });
  },
};
