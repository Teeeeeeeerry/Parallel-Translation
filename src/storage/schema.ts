// Phase 1 — 全局 Settings 类型定义与默认值。
// 此文件为全局唯一真相来源。后续所有阶段新增配置项都改这里，
// 不要在别处另开定义。

export type DisplayMode = 'bilingual' | 'translation-only';

export type StyleId =
  | 'default'
  | 'dim'
  | 'underline'
  | 'bold'
  | 'italic'
  | 'fade';

export type EngineId =
  | 'google-web'
  | 'bing-edge'
  | 'openai'
  | 'deepl'
  | 'gemini';

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
}

export const ENGINE_LABELS: Record<EngineId, string> = {
  'google-web': 'Google 翻译',
  'bing-edge': 'Bing 翻译',
  'openai': 'OpenAI (BYOK)',
  'deepl': 'DeepL (BYOK)',
  'gemini': 'Gemini (BYOK)',
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
};
