// Phase 6 — 划词右键菜单。
// 注册在 background service worker，用户在页面上选中文本后右键出现。

import { tf } from '../i18n';

/**
 * 初始化右键菜单。必须在 onInstalled 中调用。
 *
 * #178: onInstalled 在扩展 update 时同样触发 —— 右键菜单跨更新持久
 * 存在（尤其 Firefox），同 id 重复 create 会报错（Chrome 控制台噪音、
 * Firefox 报错）。创建前先 removeAll 清掉旧菜单，保证幂等。
 */
export async function initContextMenu(): Promise<void> {
  try {
    // removeAll 只清本扩展的菜单；await 保证 create 时旧菜单已清空
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'pt-translate-selection',
      title: tf('ctxTranslateSelection', '翻译所选文本'),
      contexts: ['selection'],
    });
  } catch (e) {
    console.warn('[PT] 右键菜单初始化失败:', e);
  }
}

/**
 * 监听右键菜单点击，转发到当前标签页的 content script。
 */
export function onContextMenuClick(
  handler: (tabId: number, text: string) => void,
): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'pt-translate-selection' && tab?.id) {
      handler(tab.id, info.selectionText ?? '');
    }
  });
}
