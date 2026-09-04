// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — OpenAI 兼容翻译引擎（BYOK）。
// 端点默认 api.openai.com/v1，也可用于任何兼容的 OpenAI API 代理。
// 批量策略：编号后整批送，一次往返拿回全部译文，避免逐段请求的高延迟和高费用。
//
// #333: 骨架（闸门 / 取 key / 分类抛错）收敛到公共构造 createByokEngine，
// 本文件只保留端点、请求头、请求体构造、响应解析。

import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import { buildNumberedPrompt } from './shared';
import { createByokEngine } from './byok';
import type { ProbeSpec } from './shared';
import type { TranslateEngine } from './types';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

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

/** 当前生效的模型名（设置优先，缺省回落到 schema 默认）。 */
function currentModel(): string {
  return getSettings().models?.openai ?? DEFAULT_MODELS.openai!;
}

export const openai: TranslateEngine = createByokEngine({
  id: 'openai',
  displayName: 'OpenAI',
  supportedLangs: 'all',
  model: currentModel,

  // 请求格式与改造前完全一致（#333）
  buildRequest: ({ texts, from, to }, key) => ({
    url: DEFAULT_ENDPOINT,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: currentModel(),
      // #258: 编号提示词走公共模板（模板唯一来源）—— 格式与现状逐字一致
      messages: [{ role: 'user', content: buildNumberedPrompt(to, from, texts) }],
      temperature: 0,
    }),
  }),

  parseResponse: (data, expected) => {
    const raw =
      (
        data as {
          choices?: Array<{ message?: { content?: string } }>;
        }
      ).choices?.[0]?.message?.content ?? '';
    return { translations: parseNumbered(raw, expected) };
  },
});
