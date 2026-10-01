// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — OpenAI 翻译引擎（BYOK）。
// 批量策略：编号后整批送，一次往返拿回全部译文，避免逐段请求的高延迟和高费用。
//
// #608: 请求构造、响应解析与探测规格来自 OpenAI 兼容引擎的通用构造，
// 本文件只保留配置：端点与探测地址（默认模型在 DEFAULT_MODELS）。

import { createOpenAICompatEngine } from './openai-compat';

export { parseNumbered } from './openai-compat';

const compat = createOpenAICompatEngine({
  id: 'openai',
  displayName: 'OpenAI',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  // 连通性探测规格（#321）：GET /v1/models，凭据走请求头
  probeUrl: 'https://api.openai.com/v1/models',
});

export const openai = compat.engine;
export const openaiProbe = compat.probe;
