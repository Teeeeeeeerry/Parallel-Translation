// Phase 6 — Background service worker。
// 代理翻译请求 + 注册右键菜单 + 转发菜单事件。

import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { settingsReady, onSettingsChanged } from '~/src/storage/settings';
import { route } from '~/src/engines/router';
import { initContextMenu } from '~/src/ui/context-menu';

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

  // 右键菜单 —— onInstalled 中注册，避免每次 SW 唤醒重复创建报错
  chrome.runtime.onInstalled.addListener(() => {
    initContextMenu();
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
