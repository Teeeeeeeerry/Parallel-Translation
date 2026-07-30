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
 * 翻译引擎错误。
 * router 依 retryable 决定是否尝试下一个引擎：
 * - true  = 换个引擎可能成功（网络/限流/端点变更）
 * - false = 换了也没用（语言不支持等永久失败）
 */
export class EngineError extends Error {
  constructor(
    public engineId: string,
    public retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
