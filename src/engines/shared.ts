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
import { normalizeText } from '~/src/dom/normalize';
import { fetchWithTimeout } from './fetch-timeout';

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
): string {
  const numbered = texts
    .map((t, i) => `${i + 1}. ${normalizeText(t)}`)
    .join('\n');
  return (
    `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言：${from}）`}。` +
    `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}`
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
 * 适配器提供的探测规格（#321）：端点、凭据传递方式与特例分类。
 * 公共骨架只做「构造请求 → 发送 → 公共状态分类」，引擎特例
 * （需要读错误响应体才能定类别的那家）由适配器在 classifyError
 * 中提供，不复制进公共模块。
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
  /**
   * 特例分类：适配器读取错误响应体后才能定类别时提供（如 Gemini）。
   * 返回 null 表示无特例意见，交回公共状态码分类（#239）。
   */
  classifyError?: (resp: Response) => Promise<ProbeResult | null>;
}

/** 公共分类的展示文案 —— 与翻译路径的错误文案同口径（#321）。 */
function probeMessage(category: FailureCategory, status: number): string {
  if (category === 'invalid-key') return 'API key 无效';
  if (category === 'quota') return '配额已用尽';
  return `HTTP ${status}`;
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

  // 适配器特例优先（读错误体定类别）；无特例则走公共状态码分类
  if (spec.classifyError) {
    const special = await spec.classifyError(resp);
    if (special) return special;
  }
  const category = classifyStatus(spec.engineId, resp, true);
  return { ok: false, category, message: probeMessage(category, resp.status) };
}
