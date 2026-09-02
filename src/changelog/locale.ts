// 变更条目的语言选择。
//
// 骨架文案（「更新内容」标题、分组名、按钮）走 chrome.i18n，由浏览器按
// manifest 的 default_locale 回退；条目文案是结构化数据（见 data.ts），
// 语言得自己挑。两条路径的回退目标必须一致 —— default_locale 是 zh_CN，
// 所以未支持的语言在这里同样落到 zh_CN，否则日语用户会看到中文标题配
// 英文条目的混搭。

import type { LocaleId } from './data';

/** 繁体地区。zh-SG（新加坡）用简体，不在此列。 */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * 把 BCP-47 的界面语言码映射到我们有译文的三种语言之一。
 * 大小写不敏感 —— getUILanguage() 各平台的大小写并不统一。
 */
export function pickLocale(uiLang: string): LocaleId {
  const [lang = '', region = ''] = uiLang.toLowerCase().split('-');
  if (lang === 'zh') {
    return TRADITIONAL_REGIONS.has(region) ? 'zh_TW' : 'zh_CN';
  }
  if (lang === 'en') return 'en';
  return 'zh_CN';
}
