// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 引擎公共模块 —— #222 架构评审候选 3。
//
// 状态分类与编号提示词模板此前在各引擎里各写一遍：401/403 → key 无效
// 在两家引擎重复、HTTP 状态 → 失败类别映射写了四遍、编号提示词模板
// 逐字重复。本模块收拢两件事：
//   1. classifyStatus —— 统一状态分类（#239）
//   2. buildNumberedPrompt —— 编号提示词模板唯一来源（#240）
// 适配器只保留请求构造与响应解析；引擎特例（错误体明示认证失败、
// 等）留在适配器内显式处理，不再各自发明分类规则。

import { EngineError, type FailureCategory } from './types';
import { ENGINE_CATALOG, isByokEngine } from '~/src/storage/schema';
import type { Term } from '~/src/storage/domains';
import { normalizeText } from '~/src/dom/normalize';
import { fetchWithTimeout } from './fetch-timeout';

/** 自带 key 的引擎 —— 401/403 才可能意味着「key 无效」。取自引擎清单（#608）。 */
const KEYED_ENGINES: ReadonlySet<string> = new Set(
  ENGINE_CATALOG.filter(isByokEngine).map((e) => e.id),
);

/**
 * 统一状态分类（#239）：状态码 → 失败类别。
 *
 * 口径：
 * - 自带 key 引擎（引擎清单里带 byok 的）且请求携带 key：
 *   401/403 → invalid-key；429 → quota；其余非 2xx → transient
 * - 免 key 引擎（google-web / bing-edge）或请求未携带 key：
 *   一律 transient
 *
 * 引擎特例（如 gemini 错误体明示认证失败）由
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

// ── 错误分类（#1146）──

/**
 * 一次失败的分类结果：类别、给用户的文案、能否重试、配额是否失效。每个引擎
 * 只写一个分类器产出它；翻译骨架把它包成引擎错误（toEngineError），测试连接
 * 骨架包成测试结果（probeConnection），两边不再各自判断。
 */
export interface ErrorVerdict {
  category: FailureCategory;
  message: string;
  retryable: boolean;
  invalidated: boolean;
}

/**
 * “类别 → 文案 / 能否重试 / 配额失效”的默认对应关系，只在这一处（#1146）。
 * 引擎有特殊情况时只换文案（message），类别的语义不变：
 * - invalid-key：不重试，提示检查 key
 * - quota：不重试，配额失效（不必等退避序列）
 * - too-large：可重试（router 照常换下一个引擎，#1026）
 * - aborted：不重试，调用方不记成失败
 * - transient：可重试
 */
export function verdictOf(
  category: FailureCategory,
  status: number,
  message?: string,
): ErrorVerdict {
  switch (category) {
    case 'invalid-key':
      return { category, message: message ?? 'API key 无效', retryable: false, invalidated: false };
    case 'quota':
      return { category, message: message ?? '配额已用尽', retryable: false, invalidated: true };
    case 'too-large':
      return { category, message: message ?? `HTTP ${status} 请求过大`, retryable: true, invalidated: false };
    case 'aborted':
      return { category, message: message ?? '已中止', retryable: false, invalidated: false };
    case 'transient':
      return { category, message: message ?? `HTTP ${status}`, retryable: true, invalidated: false };
  }
}

/**
 * 引擎的错误分类器：读非 2xx 响应（状态码与错误体）定类别与文案；返回 null
 * 表示没有特殊情况，交回按状态码的默认分类（classifyStatus + verdictOf）。
 */
export type ErrorClassifier = (resp: Response) => Promise<ErrorVerdict | null>;

/** 分类一个非 2xx 响应：引擎分类器优先，没有意见时按状态码。 */
export async function classifyResponse(
  engineId: string,
  resp: Response,
  classify?: ErrorClassifier,
): Promise<ErrorVerdict> {
  const special = classify ? await classify(resp) : null;
  return special ?? verdictOf(classifyStatus(engineId, resp, true), resp.status);
}

/** 翻译骨架：分类结果包成引擎错误。 */
export function toEngineError(engineId: string, v: ErrorVerdict): EngineError {
  return new EngineError(engineId, v.retryable, v.message, v.category, v.invalidated, v.category === 'aborted');
}

/**
 * 编号提示词模板唯一来源（#240）。
 *
 * 产出格式与 openai / gemini 现有的逐字实现完全一致：
 *   - 每条文本归一化（折叠换行）后按「序号. 文本」编号，\n 分隔
 *   - 头部指令固定：翻译成 {to}、可选源语言、严格保持编号与行数
 *
 * 编号结构靠 \n 分隔，文本自带换行会把编号撑破导致 LLM 重编号、
 * parseNumbered 回填错位，因此拼 prompt 前必须压一次（#160）。
 */
export function buildNumberedPrompt(
  to: string,
  from: string | 'auto',
  texts: string[],
  terms: readonly Term[] = [],
): string {
  const numbered = texts
    .map((t, i) => `${i + 1}. ${normalizeText(t)}`)
    .join('\n');
  return (
    `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言：${from}）`}。` +
    `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}` +
    termSection(terms)
  );
}

/** “不翻译”的显式标记。 */
const NO_TRANSLATE_MARK = '“不翻译”';

/**
 * 术语段（#381）—— 追加在编号文本之后，每行一条“原词 → 译法”，
 * “不翻译”用显式标记。没有术语时为空串，提示词与引入术语前逐字节相同。
 */
function termSection(terms: readonly Term[]): string {
  if (terms.length === 0) return '';
  // 术语文本与段落文本同样归一化 —— 自带换行会撑破编号结构（#160）
  const lines = terms.map(
    (t) =>
      `${normalizeText(t.source)} → ${t.noTranslate ? NO_TRANSLATE_MARK : normalizeText(t.target ?? '')}`,
  );
  return (
    `\n\n术语（必须使用以下译法；${NO_TRANSLATE_MARK}表示原词原样出现在译文里）：\n` +
    lines.join('\n')
  );
}

// ── 连通性探测入口（#321）──

/**
 * 连通性探测结果 —— 与翻译路径同一份状态分类（#321）。
 * ok=false 时携带失败类别与展示文案，调用方按类别决定提示语义。
 */
export type ProbeResult =
  | { ok: true; message: string }
  | { ok: false; category: FailureCategory; message: string };

/**
 * 适配器提供的探测规格（#321）：端点、凭据传递方式与引擎的错误分类器。
 * 公共骨架只做「构造请求 → 发送 → 分类」；分类器与翻译路径是同一个
 * （#1146），不再为测试连接另写一份。
 */
export interface ProbeSpec {
  engineId: string;
  /**
   * 构造最小探测请求。凭据一律走请求头，不进查询串 ——
   * URL 会进浏览器网络日志、DevTools 记录与任何中间层的访问日志。
   * model 仅在引擎有模型概念时传入（openai / gemini）。
   */
  buildRequest(ctx: { key: string; model?: string }): {
    url: string;
    headers: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
  };
  /** 引擎的错误分类器（与翻译路径同一个，见 ErrorClassifier）。 */
  classifyError?: ErrorClassifier;
}

/**
 * 连通性探测入口（#321）：接受引擎标识与待测 key（+ 可选模型名），
 * 走与翻译路径同一份状态分类，返回同构的类型化结果。
 * 纯查询：不产生任何存储写入，key 由调用方显式传入。
 */
export async function probeConnection(
  spec: ProbeSpec,
  ctx: { key: string; model?: string },
): Promise<ProbeResult> {
  const { url, headers, method = 'GET', body } = spec.buildRequest(ctx);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(spec.engineId, url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });
  } catch (e) {
    // 网络 / 超时 → 瞬时（与翻译路径同一口径）
    return {
      ok: false,
      category: 'transient',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (resp.ok) return { ok: true, message: '连接成功' };

  // 与翻译路径同一个分类器、同一份默认对应关系（#1146）
  const { category, message } = await classifyResponse(spec.engineId, resp, spec.classifyError);
  return { ok: false, category, message };
}
