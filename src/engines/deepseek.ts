// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// DeepSeek 翻译引擎（BYOK，#609）。
// 兼容 OpenAI Chat Completions 格式，请求构造、响应解析与探测规格来自
// OpenAI 兼容引擎的通用构造；本文件只保留配置：端点、探测地址与 402 特例
// （翻译与测试连接各一处；默认模型在 DEFAULT_MODELS）。

import { createOpenAICompatEngine } from './openai-compat';
import { EngineError } from './types';

const compat = createOpenAICompatEngine({
  id: 'deepseek',
  displayName: 'DeepSeek',
  endpoint: 'https://api.deepseek.com/chat/completions',
  probeUrl: 'https://api.deepseek.com/models',
  // DeepSeek 用 402 表示余额不足：按配额处理，不重试。只在本适配器里
  // 认 402，公共状态分类对其他引擎的口径不变
  classifyError: async (resp) =>
    resp.status === 402 ? new EngineError('deepseek', false, '余额不足', 'quota', true) : null,
  // 测试连接与翻译路径同一口径（#611）：402 报配额问题（余额不足）
  classifyProbeError: async (resp) =>
    resp.status === 402 ? { ok: false, category: 'quota', message: '余额不足' } : null,
});

export const deepseek = compat.engine;
export const deepseekProbe = compat.probe;
