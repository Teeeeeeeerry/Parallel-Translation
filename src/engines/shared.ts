// 引擎公共模块 —— #222 架构评审候选 3。
//
// 状态分类与编号提示词模板此前在各引擎里各写一遍：401/403 → key 无效
// 在两家引擎重复、HTTP 状态 → 失败类别映射写了四遍、编号提示词模板
// 逐字重复。本模块收拢两件事：
//   1. classifyStatus —— 统一状态分类（#239）
//   2. buildNumberedPrompt —— 编号提示词模板唯一来源（#240）
// 适配器只保留请求构造与响应解析；引擎特例（错误体明示认证失败、
// 401 会话失效清 JWT 等）留在适配器内显式处理，不再各自发明分类规则。

import type { FailureCategory } from './types';

/** 自带 key 的引擎 —— 401/403 才可能意味着「key 无效」。 */
const KEYED_ENGINES: ReadonlySet<string> = new Set(['openai', 'deepl', 'gemini']);

/**
 * 统一状态分类（#239）：状态码 → 失败类别。
 *
 * 口径：
 * - 自带 key 引擎（openai / deepl / gemini）且请求携带 key：
 *   401/403 → invalid-key；429 → quota；其余非 2xx → transient
 * - 免 key 引擎（google-web / bing-edge）或请求未携带 key：
 *   一律 transient（bing-edge 的 401 是会话失效，仍瞬时可重试）
 *
 * 引擎特例（如 gemini 错误体明示认证失败、bing-edge 401 清 JWT）由
 * 适配器在调用前后显式处理，不混入本函数。
 *
 * @param engineId 引擎 id
 * @param resp 响应（调用方保证非 2xx 才调用）
 * @param hasKey 本次请求是否携带了 key
 */
export function classifyStatus(
  engineId: string,
  resp: { status: number },
  hasKey: boolean,
): FailureCategory {
  if (!hasKey || !KEYED_ENGINES.has(engineId)) return 'transient';
  if (resp.status === 401 || resp.status === 403) return 'invalid-key';
  if (resp.status === 429) return 'quota';
  return 'transient';
}
