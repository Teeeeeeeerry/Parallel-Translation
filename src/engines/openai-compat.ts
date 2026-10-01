// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// OpenAI 兼容引擎的通用构造（#608）。
//
// 兼容 OpenAI Chat Completions 格式的引擎共用同一套请求与解析：
//   - Bearer 请求头
//   - messages 请求体：编号提示词走公共模板，本批命中的术语追加在
//     user 消息末尾（#258/#381）
//   - choices[0].message.content 的编号解析，按预期长度回填
//   - 连通性探测规格（#321）：默认 GET 探测地址，凭据走请求头
// 骨架（闸门 / 取 key / 分类抛错）仍由 createByokEngine 提供。各引擎
// 只保留配置：端点、默认模型（DEFAULT_MODELS）、探测地址与错误分类特例。

import { getSettings } from '~/src/storage/settings';
import { DEFAULT_MODELS } from '~/src/storage/schema';
import type { ByokEngineId } from '~/src/storage/schema';
import { buildNumberedPrompt } from './shared';
import type { ProbeSpec } from './shared';
import { createByokEngine } from './byok';
import type { ByokEngineSpec } from './byok';
import type { TranslateEngine } from './types';

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

/** OpenAI 兼容引擎的配置。 */
export interface OpenAICompatConfig {
  id: ByokEngineId;
  displayName: string;
  /** Chat Completions 端点。 */
  endpoint: string;
  /** 连通性探测地址（GET，凭据走请求头）。 */
  probeUrl: string;
  /** 翻译路径的错误分类特例（见 ByokEngineSpec.classifyError）。 */
  classifyError?: ByokEngineSpec['classifyError'];
  /** 探测的错误分类特例（见 ProbeSpec.classifyError）。 */
  classifyProbeError?: ProbeSpec['classifyError'];
}

/** OpenAI 兼容引擎及其探测规格。 */
export interface OpenAICompatEngine {
  engine: TranslateEngine;
  probe: ProbeSpec;
}

export function createOpenAICompatEngine(config: OpenAICompatConfig): OpenAICompatEngine {
  const { id } = config;

  /** 当前生效的模型名（设置优先，缺省回落到 schema 默认）。 */
  const currentModel = (): string => getSettings().models?.[id] ?? DEFAULT_MODELS[id]!;

  const engine = createByokEngine({
    id,
    displayName: config.displayName,
    supportedLangs: 'all',
    injectsTerms: true,
    model: currentModel,
    ...(config.classifyError && { classifyError: config.classifyError }),

    buildRequest: ({ texts, from, to, terms }, key) => ({
      url: config.endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: currentModel(),
        // #258: 编号提示词走公共模板（模板唯一来源）；
        // #381: 本批命中的术语追加在 user 消息末尾，消息结构不变
        messages: [{ role: 'user', content: buildNumberedPrompt(to, from, texts, terms) }],
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

  const probe: ProbeSpec = {
    engineId: id,
    buildRequest: ({ key }) => ({
      url: config.probeUrl,
      headers: { Authorization: `Bearer ${key}` },
    }),
    ...(config.classifyProbeError && { classifyError: config.classifyProbeError }),
  };

  return { engine, probe };
}
