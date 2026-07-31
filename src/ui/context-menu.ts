// Phase 6 — 划词右键菜单。
// 注册在 background service worker，用户在页面上选中文本后右键出现。

/**
 * 初始化右键菜单。必须在 onInstalled 中调用以避免重复注册报错。
 */
export function initContextMenu(): void {
  chrome.contextMenus.create({
    id: 'pt-translate-selection',
    title: '翻译所选文本',
    contexts: ['selection'],
  });
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
