// Phase 6 — Background service worker。
// 代理翻译请求 + 注册右键菜单 + 转发菜单事件。

import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { settingsReady, patchSettings, onSettingsChanged } from '~/src/storage/settings';
import { route } from '~/src/engines/router';
import { initContextMenu } from '~/src/ui/context-menu';

/** 将浏览器 UI 语言映射到 LANG_LIST 中可用的目标语言码 */
function deriveTargetLanguage(uiLang: string): string {
  const lang = uiLang.split('-')[0]?.toLowerCase() ?? '';
  // 中文特殊处理：繁体 → zh-TW，其余默认简体
  if (lang === 'zh') {
    return uiLang.includes('TW') || uiLang.includes('Hant') ? 'zh-TW' : 'zh-CN';
  }
  // 已知语言前缀 → 对应语言码
  const MAP: Record<string, string> = {
    en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de',
    es: 'es', pt: 'pt', ru: 'ru', ar: 'ar', th: 'th',
    vi: 'vi', it: 'it',
  };
  return MAP[lang] ?? 'en';
}

export default defineBackground(() => {
  console.log('[PT] Background service worker started');

  settingsReady().catch((e) => console.error('[PT] 设置加载失败:', e));
  onSettingsChanged(() => {});

  // 暴露给 DevTools Console 用于 DoD 验证
  (self as any).cacheSet = cacheSet;
  (self as any).cacheKey = cacheKey;
  (self as any).cacheGet = cacheGet;
  (self as any).cacheClear = cacheClear;
  (self as any).getKey = getKey;
  (self as any).setKey = setKey;
  (self as any).removeKey = removeKey;

  // 右键菜单 + 首次安装引导
  chrome.runtime.onInstalled.addListener((details) => {
    initContextMenu();

    if (details.reason === 'install') {
      // 根据浏览器 UI 语言推导默认目标语言
      settingsReady()
        .then(async () => {
          const uiLang = chrome.i18n.getUILanguage();
          const derived = deriveTargetLanguage(uiLang);
          if (derived !== 'zh-CN') {
            await patchSettings({ to: derived });
          }
        })
        .catch((e) => console.error('[PT] 设置默认语言失败:', e));

      // 打开欢迎页
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    }
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'pt-translate-selection' && tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'pt:translate-selection',
        text: info.selectionText ?? '',
      });
    }
  });

  // 翻译代理
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'pt:translate') return;

    try {
      settingsReady()
        .then(() => route(msg.payload))
        .then((r) => sendResponse({ ok: true, data: r }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }

    return true;
  });
});
