// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 1 — 全局 Settings 类型定义与默认值。
// 此文件为全局唯一真相来源。后续所有阶段新增配置项都改这里，
// 不要在别处另开定义。

/** 递归 Partial：嵌套字段也可部分提供。数组保持原类型，不递归到索引。 */
export type DeepPartial<T> = T extends Array<infer U>
  ? Array<U>
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;

export type DisplayMode = 'bilingual' | 'translation-only';

export type StyleId =
  | 'default'
  | 'dim'
  | 'underline'
  | 'bold'
  | 'italic'
  | 'border';

/** 全部有效样式 id —— migrateStyle 据此判断存储里的值还认不认得。 */
const STYLE_IDS = new Set<string>([
  'default',
  'dim',
  'underline',
  'bold',
  'italic',
  'border',
]);

/**
 * 把存储里的样式 id 迁到当前有效值。
 *
 * 'fade'（纯半透明）的效果已成为新的 default，选过它的老用户迁过去
 * 观感不变；认不出的值一律回落 default —— 否则 applyStyle 会挂上一个
 * 没有任何 CSS 规则的类名，译文变成完全无样式，用户只会觉得设置失灵。
 */
export function migrateStyle(style: unknown): StyleId {
  if (typeof style !== 'string') return 'default';
  if (style === 'fade') return 'default';
  return STYLE_IDS.has(style) ? (style as StyleId) : 'default';
}

/**
 * 引擎清单（#608）—— 全部引擎的唯一来源，顺序即设置页“未启用”区与 popup
 * 引擎下拉框的展示顺序。带 byok 的是自带 key 引擎：设置页为它渲染 key
 * 卡片（说明文案 key 与回落文案在这里），恢复默认时清掉它的 key，状态分类
 * 把它的 401/403 判为 key 无效，测试连接为它分派探测。
 *
 * byok.optionalOrigin 是走可选权限的端点（#609）：manifest 把它声明为可选
 * host 权限，设置页在保存 key 的点击里申请。现有引擎的端点是必需权限，没有这一项。
 *
 * 新增引擎只改这份清单，再补上引擎自己的配置：显示名（ENGINE_LABELS）、
 * 默认模型（DEFAULT_MODELS，有模型概念时，同时是设置页模型名的占位）、
 * 适配器（router 的引擎表）与探测规格（测试连接的探测表）。
 */
export const ENGINE_CATALOG = [
  { id: 'google-web' },
  { id: 'bing-edge' },
  {
    id: 'openai',
    byok: {
      descKey: 'descOpenai',
      fallbackDesc: '支持 OpenAI API 及其兼容端点（如 Azure、本地模型）。',
    },
  },
  {
    id: 'deepl',
    byok: { descKey: 'descDeepl', fallbackDesc: '免费版 key 以 :fx 结尾，请确认端点正确。' },
  },
  {
    id: 'gemini',
    byok: {
      descKey: 'descGemini',
      fallbackDesc: 'Google Gemini API，key 可从 Google AI Studio 获取。',
    },
  },
  {
    id: 'deepseek',
    byok: {
      descKey: 'descDeepseek',
      fallbackDesc: 'DeepSeek API，key 可从 DeepSeek 开放平台获取。点“测试连接”时浏览器会询问是否允许访问 api.deepseek.com，测试成功后保存 key。',
      // #609: 端点走可选权限，在保存 key 的点击里申请，升级时不弹新的权限提示
      optionalOrigin: 'https://api.deepseek.com/*',
    },
  },
  {
    id: 'grok',
    byok: {
      descKey: 'descGrok',
      fallbackDesc: 'xAI Grok API，key 可从 xAI 控制台获取，需要为 key 授权 chat 端点与所选模型。点“测试连接”时浏览器会询问是否允许访问 api.x.ai，测试成功后保存 key。',
      optionalOrigin: 'https://api.x.ai/*',
    },
  },
] as const;

type EngineEntry = (typeof ENGINE_CATALOG)[number];

export type EngineId = EngineEntry['id'];

/** 自带 key 的引擎。 */
export type ByokEngineId = Extract<EngineEntry, { byok: object }>['id'];

/** 清单里的自带 key 引擎条目。 */
export type ByokEngineEntry = Extract<EngineEntry, { byok: object }>;

export function isByokEngine(e: EngineEntry): e is ByokEngineEntry {
  return 'byok' in e;
}

/** 主机匹配模式里的主机名（#610）：'https://api.deepseek.com/*' → 'api.deepseek.com'。 */
export function originHost(origin: string): string {
  return new URL(origin.replace(/\*$/, '')).host;
}

/** 引擎走可选权限的端点（#609）；端点是必需权限的引擎返回 undefined。 */
export function optionalOriginOf(id: EngineId): string | undefined {
  const byok = ENGINE_CATALOG.filter(isByokEngine).find((e) => e.id === id)?.byok;
  return byok && 'optionalOrigin' in byok ? byok.optionalOrigin : undefined;
}

export type HotkeyAction =
  | 'toggle-translate'    // 全页翻译开关
  | 'toggle-mode'         // 对照 ↔ 仅译文
  | 'translate-paragraph' // 翻译光标所在段
  | 'toggle-extension';   // 扩展总开关

export interface SiteListConfig {
  mode: 'blacklist' | 'whitelist';
  list: string[];
}

export interface Settings {
  enabled: boolean;

  /** 引擎优先级列表。router 按序尝试，前一个失败切下一个。 */
  enginePriority: EngineId[];

  /** 源语言：'auto' 或 BCP-47 语言码 */
  from: string;

  /** 目标语言：BCP-47 语言码 */
  to: string;

  displayMode: DisplayMode;

  /**
   * 单段翻译的显示模式。'follow' 表示跟随全局 displayMode。
   * 默认 'follow'，升级后现有用户行为完全不变。
   */
  paraDisplayMode: DisplayMode | 'follow';

  style: StyleId;

  /** 自定义 CSS 声明块（不含选择器）。阶段 4 校验。 */
  customCss: string;

  /** 平台无关的组合键，形如 'Mod+Shift+Y'。阶段 6 使用。 */
  hotkeys: Record<HotkeyAction, string>;

  /** 站点名单。mode 决定 list 是黑名单还是白名单。 */
  siteList: SiteListConfig;

  showFloatingBall: boolean;
  showParagraphBtn: boolean;
  maxConcurrency: number;
  useCache: boolean;

  /** BYOK 引擎的自定义模型名。阶段 7 使用。 */
  models: Partial<Record<EngineId, string>>;

  /**
   * 机翻引擎应用指定译法的术语（#390）。关闭时机翻引擎只落实“不翻译”
   * 术语；打开后指定了译法的术语也经占位符替换，回填为指定译法。
   */
  mtApplyTermTargets: boolean;

  /**
   * 输入翻译（#633）：输入框文字末尾浮出圆点，点它把框里的文字译成对方的语言。
   * 目标语言取 from，不另设（ADR-0005）。
   */
  inputTranslate: boolean;

  /** 悬浮球尺寸（px，#966）。默认 44 与原来的硬编码相同，范围见 BALL_SIZE_MIN/MAX。 */
  floatingBallSize: number;

  /**
   * 逐段翻译按钮尺寸（px，#970）：按钮的最小边长，字号按它等比折算。
   * 默认 24 与原来的点击下限相同，范围见 PARA_BTN_SIZE_MIN/MAX。
   */
  paraBtnSize: number;

  /**
   * 鼠标离开段落后逐段翻译按钮停留多久（ms，#972）。默认 1500 与原来的固定
   * 延迟相同，范围见 PARA_BTN_HIDE_DELAY_MIN/MAX。浮出前的悬停延迟不在此列。
   */
  paraBtnHideDelay: number;
}

export const ENGINE_LABELS: Record<EngineId, string> = {
  'google-web': 'Google 翻译',
  'bing-edge': 'Bing 翻译',
  'openai': 'OpenAI (BYOK)',
  'deepl': 'DeepL (BYOK)',
  'gemini': 'Gemini (BYOK)',
  'deepseek': 'DeepSeek (BYOK)',
  'grok': 'Grok (BYOK)',
};

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  'bilingual': '对照',
  'translation-only': '仅译文',
};

/** 常用语言列表，用于 popup / options 下拉菜单。 */
export const LANG_LIST: { code: string; label: string }[] = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '中文（繁体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'it', label: 'Italiano' },
];

/** maxConcurrency 合法范围（UI 下拉允许 2-10，#172）。 */
export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 10;

/** BYOK 引擎的默认模型名（缓存 key 的模型维度用，单一来源，#175）。 */
export const DEFAULT_MODELS: Partial<Record<EngineId, string>> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  deepseek: 'deepseek-flash',
  // 非推理的低价模型（#613，按 xAI 模型列表核对）
  grok: 'grok-4.20-0309-non-reasoning',
};

/** 钳制并发数到合法范围 —— 导入/存储/写入口共用，防 0 或负数饿死闸门。 */
export function clampConcurrency(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : CONCURRENCY_MIN;
  return Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, v));
}

/**
 * 悬浮球尺寸合法范围（px，#966）。下限 32 仍比逐段翻译按钮的 24px 点击下限大一圈；
 * 上限 72 约是默认的 1.6 倍，球不至于压住网页右下角一大块。
 */
export const BALL_SIZE_MIN = 32;
export const BALL_SIZE_MAX = 72;
const BALL_SIZE_DEFAULT = 44;

/**
 * 钳制悬浮球尺寸 —— 与 clampConcurrency 同形，写入口单点生效。
 * 非数字、NaN、Infinity 回落默认值而不是钳到某一端：脏值说明不出用户想要多大，
 * 回到原来的尺寸最不意外。
 */
export function clampBallSize(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return BALL_SIZE_DEFAULT;
  return Math.min(BALL_SIZE_MAX, Math.max(BALL_SIZE_MIN, Math.round(n)));
}

/**
 * 逐段翻译按钮尺寸合法范围（px，#970）。下限就是原来的 24px 点击下限，不许再低：
 * 8px 字号那版实测约 20×15px，指针要瞄准才点得中（见 injected.css 的注释）。
 * 上限 40 时字号 20px，按钮仍只占段落右上角一小块。
 */
export const PARA_BTN_SIZE_MIN = 24;
export const PARA_BTN_SIZE_MAX = 40;
const PARA_BTN_SIZE_DEFAULT = 24;

/** 钳制逐段翻译按钮尺寸 —— 与 clampBallSize 同形，脏值回落默认。 */
export function clampParaBtnSize(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return PARA_BTN_SIZE_DEFAULT;
  return Math.min(PARA_BTN_SIZE_MAX, Math.max(PARA_BTN_SIZE_MIN, Math.round(n)));
}

/**
 * 逐段翻译按钮显示时长合法范围（ms，#972）。默认 1.5 秒是用户实机试用后定的：
 * 它要覆盖指针从段落边缘跨过间隙、移到按钮上的全程（见 paragraph-btn.ts）。
 * 下限 0.5 秒手快的人仍够得着，上限 3 秒再长就成了长期压在正文上的按钮；
 * “不自动隐藏”一档不做（#964 的排除清单）。
 */
export const PARA_BTN_HIDE_DELAY_MIN = 500;
export const PARA_BTN_HIDE_DELAY_MAX = 3000;
const PARA_BTN_HIDE_DELAY_DEFAULT = 1500;

/** 钳制逐段翻译按钮显示时长 —— 与 clampBallSize 同形，脏值回落默认。 */
export function clampParaBtnHideDelay(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return PARA_BTN_HIDE_DELAY_DEFAULT;
  return Math.min(PARA_BTN_HIDE_DELAY_MAX, Math.max(PARA_BTN_HIDE_DELAY_MIN, Math.round(n)));
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enginePriority: ['google-web', 'bing-edge'],
  from: 'auto',
  to: 'zh-CN',
  displayMode: 'bilingual',
  paraDisplayMode: 'follow',
  style: 'default',
  customCss: '',
  hotkeys: {
    'toggle-translate': 'Mod+Shift+Y',
    'toggle-mode': 'Mod+Shift+M',
    'translate-paragraph': 'Mod+Shift+D',
    'toggle-extension': 'Mod+Shift+E',
  },
  siteList: { mode: 'blacklist', list: [] },
  showFloatingBall: true,
  showParagraphBtn: true,
  maxConcurrency: 6,
  useCache: true,
  models: {},
  mtApplyTermTargets: false,
  inputTranslate: true,
  floatingBallSize: BALL_SIZE_DEFAULT,
  paraBtnSize: PARA_BTN_SIZE_DEFAULT,
  paraBtnHideDelay: PARA_BTN_HIDE_DELAY_DEFAULT,
};
