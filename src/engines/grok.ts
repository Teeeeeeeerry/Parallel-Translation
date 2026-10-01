// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Grok 翻译引擎（xAI，BYOK，#613）。
// 兼容 OpenAI Chat Completions 格式，请求构造、响应解析与探测规格来自
// OpenAI 兼容引擎的通用构造；本文件只保留配置：端点与 401/403 的授权提示
// （默认模型在 DEFAULT_MODELS）。
//
// xAI 的 key 默认没有任何权限，要逐个授权端点和模型：
//   - 测试连接发最小 chat 请求（不给探测地址），不测 /v1/models —— 有
//     chat 权限、没有 models 权限的 key 会被误判为无效
//   - 401/403 的原因补上“或 key 没有 chat 端点、所选模型的权限”

import { tf } from '~/src/i18n';
import { createOpenAICompatEngine } from './openai-compat';
import { EngineError } from './types';

const isAuthFailure = (resp: Response) => resp.status === 401 || resp.status === 403;

const keyInvalidReason = () =>
  tf(
    'grokKeyInvalid',
    'API key 无效，或 key 没有 chat 端点、所选模型的权限，请在 xAI 控制台授权',
  );

const compat = createOpenAICompatEngine({
  id: 'grok',
  displayName: 'Grok',
  endpoint: 'https://api.x.ai/v1/chat/completions',
  classifyError: async (resp) =>
    isAuthFailure(resp) ? new EngineError('grok', false, keyInvalidReason(), 'invalid-key') : null,
  classifyProbeError: async (resp) =>
    isAuthFailure(resp) ? { ok: false, category: 'invalid-key', message: keyInvalidReason() } : null,
});

export const grok = compat.engine;
export const grokProbe = compat.probe;
