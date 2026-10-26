// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 2 — 翻译引擎统一接口与错误类型。

import type { Term } from '~/src/storage/domains';
import type { TermHandling } from './term-strategy';

export interface TranslateRequest {
  /** 待翻译文本列表，顺序敏感。 */
  texts: string[];
  /** 源语言，'auto' 表示自动检测。 */
  from: string | 'auto';
  /** 目标语言。 */
  to: string;
  /** 当前领域 ID（#379）；页面没有当前领域时不携带。 */
  domainId?: string;
  /**
   * 本批文本命中的术语（#381）—— router 填写，已去重；没有命中时不携带。
   * 引擎按类别注入，不需要的引擎忽略。
   */
  terms?: Term[];
  /**
   * 不走翻译缓存（#642）：router 见到它既不查也不写。输入翻译设上 ——
   * 发出去的句子几乎不会重复，写进缓存只会挤占阅读侧的额度；阅读侧的
   * 请求一律不携带。
   */
  noCache?: boolean;
  /**
   * 批次身份（#1001）：content 每次发送一条翻译消息时取一个新值，后台据此把
   * 这次引擎调用登记进在飞表；content 放弃这一批时凭它通知后台中止。只在
   * content → 后台的消息里出现，后台收到后取下，不往引擎传。
   */
  batchId?: string;
  /**
   * 中止信号（#1001）：后台在飞表给这次调用的。只在后台内部传（消息里传不了），
   * 引擎把它接到 fetch 上；中止后排队中的请求不再发出，在飞的 fetch 被取消。
   */
  signal?: AbortSignal;
  /**
   * 拿到引擎闸门许可时调用（#1083，观测用）：后台据此把一批的耗时分成“后台引擎
   * 闸门排队”与“引擎调用”两段。与 signal 一样只在后台内部传；一批里有多个请求
   * （google-web 一条文本一个）时每拿到一次许可调一次。
   */
  onGateStart?: () => void;
}

export interface TranslateResponse {
  /** 译文列表，长度与顺序必须与 texts 严格对应。 */
  translations: string[];
  /** 检测到的源语言（可选）。 */
  detectedFrom?: string;
  /**
   * 翻译失败的槽位索引（可选）。
   * router 根据此字段将失败槽位交给下一个引擎重试，
   * 已成功的译文保留在 translations 中不被丢弃。
   * route() 的返回值也用它标记所有引擎都失败的段落（#416），槽位为空串。
   */
  failedIndices?: number[];
  /**
   * failedIndices 段落的失败原因（#440）：route() 遇到不可重试的错误
   * （key 无效、配额耗尽等）而已有段落成功时，不再抛出，改为返回已成功
   * 的段落并在这里带上该错误的类别与原因文本，供调用方展示真实原因。
   * 带有此字段的结果不应再重试。
   */
  failure?: { category: FailureCategory; error: string };
}

export interface TranslateEngine {
  id: string;
  displayName: string;
  requiresKey: boolean;
  /** 该引擎支持的语言码列表，'all' 表示不做限制。 */
  supportedLangs: string[] | 'all';
  /**
   * 怎么处理术语（#1155，见 term-strategy.ts）：AI 引擎 'inject'，把本批命中的
   * 术语注入请求（#381/#382）；机翻引擎 'mask'，用占位符落实“不翻译”与开关
   * 打开后的指定译法（#386/#390）；不声明即不处理。缓存 key 的术语哈希、
   * 发送前改写、收到后还原都由对应的策略决定。
   */
  termHandling?: TermHandling;
  translate(req: TranslateRequest): Promise<TranslateResponse>;
}

/**
 * 失败类别（显式枚举）—— #219 架构评审候选 2 的类型化结果核心。
 * 失败在发生的唯一地点分类一次，后续各层只读透传，不再各自重推导。
 */
export type FailureCategory =
  /** key 无效（401/403 等认证失败）—— 不重试，提示用户检查 key。 */
  | 'invalid-key'
  /** 配额失效（429 配额耗尽等）—— 不重试，提示配额问题。 */
  | 'quota'
  /** 瞬时故障（5xx / 超时 / 网络）—— 默认可重试。 */
  | 'transient'
  /**
   * 请求超过引擎的单次上限（#1026）—— 确定性失败，同样的请求重发多少次都一样，
   * 批次重试不再重发。别的引擎上限不同，router 照常换下一个引擎。
   */
  | 'too-large'
  /** 已中止（用户还原 / 页面切换）—— 调用方不应记成失败。 */
  | 'aborted';

/**
 * 每次翻译尝试的类型化结果（#232）。
 * 失败类别 + 可重试 + 配额失效 + 已中止 在错误发生的唯一地点构造一次。
 */
export interface AttemptOutcome {
  /** 失败类别（显式枚举）。 */
  category: FailureCategory;
  /** 是否可重试：不可重试仅由引擎显式判定，默认瞬时故障可重试。 */
  retryable: boolean;
  /** 配额失效（免费额度耗尽等）—— 不可恢复，无需等待退避序列。 */
  invalidated: boolean;
  /** 已中止（还原 / 导航）—— 不应记成真失败。 */
  aborted: boolean;
}

/**
 * 翻译引擎错误。
 * router 依 retryable 决定是否尝试下一个引擎：
 * - true  = 换个引擎可能成功（网络/限流/端点变更）
 * - false = 换了也没用（语言不支持等永久失败）
 *
 * 扩张阶段（#232）：新增 category / invalidated / aborted 字段，
 * 旧构造签名（engineId, retryable, message）在兼容期保持可用，
 * 旧调用方不破坏。
 */
export class EngineError extends Error implements AttemptOutcome {
  constructor(
    public engineId: string,
    public retryable: boolean,
    message: string,
    public category: FailureCategory = 'transient',
    public invalidated = false,
    public aborted = false,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * 引擎当前不可用（#610）—— 走可选权限的引擎没有访问端点的权限（用户在
 * 浏览器扩展管理里撤销了）。不发请求，按不可重试的配置问题失败（类别
 * 同 key 无效：要用户到设置页重新保存 key），但与 key 无效不同，router
 * 照常按优先级切到下一个引擎；只有它出了错时，失败结果带上它的原因。
 */
export class EngineUnavailableError extends EngineError {
  constructor(engineId: string, message: string) {
    super(engineId, false, message, 'invalid-key');
    this.name = 'EngineUnavailableError';
  }
}

/**
 * router 的「所有引擎均失败」聚合错误 —— #237。
 * 显式构造类型化结果（瞬时、可重试），不再抛裸普通 Error ——
 * 消除「普通 Error 即隐式可重试」的启发式：聚合失败的可重试性
 * 由这里显式声明，各消费层无需再自行推断。
 */
export class AllEnginesFailedError extends EngineError {
  /** 各引擎的原始失败（调试与透传用）。 */
  public readonly engineErrors: readonly EngineError[];

  constructor(detail: string, engineErrors: readonly EngineError[] = []) {
    // #1026：每个引擎都报请求过大时，整体也是请求过大 —— 重发同一批没有意义；
    // 只要有一个引擎是别的失败，整体仍按瞬时处理
    const tooLarge = engineErrors.length > 0 && engineErrors.every((e) => e.category === 'too-large');
    super('router', true, `所有引擎均失败: ${detail}`, tooLarge ? 'too-large' : 'transient');
    this.name = 'AllEnginesFailedError';
    this.engineErrors = engineErrors;
  }
}
