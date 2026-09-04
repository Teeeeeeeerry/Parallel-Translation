// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 2 — 翻译引擎统一接口与错误类型。

export interface TranslateRequest {
  /** 待翻译文本列表，顺序敏感。 */
  texts: string[];
  /** 源语言，'auto' 表示自动检测。 */
  from: string | 'auto';
  /** 目标语言。 */
  to: string;
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
   */
  failedIndices?: number[];
}

export interface TranslateEngine {
  id: string;
  displayName: string;
  requiresKey: boolean;
  /** 该引擎支持的语言码列表，'all' 表示不做限制。 */
  supportedLangs: string[] | 'all';
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
 * router 的「所有引擎均失败」聚合错误 —— #237。
 * 显式构造类型化结果（瞬时、可重试），不再抛裸普通 Error ——
 * 消除「普通 Error 即隐式可重试」的启发式：聚合失败的可重试性
 * 由这里显式声明，各消费层无需再自行推断。
 */
export class AllEnginesFailedError extends EngineError {
  /** 各引擎的原始失败（调试与透传用）。 */
  public readonly engineErrors: readonly EngineError[];

  constructor(detail: string, engineErrors: readonly EngineError[] = []) {
    super('router', true, `所有引擎均失败: ${detail}`, 'transient');
    this.name = 'AllEnginesFailedError';
    this.engineErrors = engineErrors;
  }
}
