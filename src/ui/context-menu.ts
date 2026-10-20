// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 6 — 划词右键菜单。
// 注册在 background service worker，用户在页面上选中文本后右键出现。

import { tf } from '../i18n';

const MENU_ID = 'pt-translate-selection';

const menuTitle = () => tf('ctxTranslateSelection', '翻译所选文本');

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
      id: MENU_ID,
      title: menuTitle(),
      contexts: ['selection'],
    });
  } catch (e) {
    console.warn('[PT] 右键菜单初始化失败:', e);
  }
}

/**
 * 按当前扩展语言更新菜单标题（#1101）。菜单还没建时（首装的 onInstalled
 * 之前）update 会失败，忽略即可：之后建菜单时取的就是当时的语言。
 */
export async function refreshContextMenuTitle(): Promise<void> {
  try {
    await chrome.contextMenus.update(MENU_ID, { title: menuTitle() });
  } catch {
    // 菜单还没建
  }
}

/**
 * 监听右键菜单点击，转发到当前标签页的 content script。
 */
export function onContextMenuClick(
  handler: (tabId: number, text: string) => void,
): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && tab?.id) {
      handler(tab.id, info.selectionText ?? '');
    }
  });
}
