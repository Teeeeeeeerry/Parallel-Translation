// Phase 6 — Background service worker。
// 代理翻译请求 + 注册右键菜单 + 转发菜单事件。

import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { settingsReady, patchSettings, onSettingsChanged } from '~/src/storage/settings';
import { route } from '~/src/engines/router';
import { EngineError } from '~/src/engines/types';
import { ensureE2EMock, applyE2EMock, getE2EMockStats } from '~/src/engines/e2e-mock';
import { initContextMenu } from '~/src/ui/context-menu';
import { claimShow, markFreshInstall } from '~/src/changelog/claim';
import { markSeen } from '~/src/changelog/state';

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
  // E2E fixtures 的 mock 注入入口（#90，与上同理的调试面）
  (self as any).applyE2EMock = applyE2EMock;
  // mock 统计探针 —— TC-E2E-47/48 断言一次性故障确实被触发（#91）
  (self as any).getE2EMockStats = getE2EMockStats;

  // 右键菜单 + 首次安装引导
  chrome.runtime.onInstalled.addListener((details) => {
    initContextMenu().catch(() => {});

    if (details.reason === 'install') {
      // 首装用户没有「更新」可看 —— 更新提示只服务老用户（ADR-0001），
      // 新用户看到的是 welcome 页。
      //
      // 两道闸：先同步置位内存标志（立即生效，先于任何 claim 消息抵达），
      // 再异步落盘。只靠落盘会留下竞态窗口 —— 详见 claim.ts 的说明。
      markFreshInstall();
      markSeen(chrome.runtime.getManifest().version).catch((e) =>
        console.error('[PT] 首装标记更新提示已读失败：', e),
      );

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
      // #166: 无 content script 的页面（chrome://、PDF 查看器、扩展更新前
      // 已打开的旧标签页）sendMessage 会以 "Receiving end does not exist"
      // 拒绝 —— 不加 catch 会在 SW 内留下未处理 rejection，用户侧零反馈。
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'pt:translate-selection',
          text: info.selectionText ?? '',
        })
        .catch(() => {
          console.debug(
            '[PT] 右键翻译：目标标签页无 content script，忽略（请刷新页面后使用）',
          );
        });
    }
  });

  // #177: welcome 页「关闭」按钮 —— 页面脚本的 window.close() 会被
  // 浏览器静默忽略（标签页由 background 打开），由这里移除标签页
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'pt:close-welcome' && sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {
        console.debug('[PT] 关闭 welcome 标签页失败或已关闭');
      });
    }
  });

  // 更新提示的显示权仲裁（ADR-0001）——
  // 扩展更新后每个新页面的 content script 都会来问，串行判定只放行一个，
  // 避免同时打开多个标签页时弹出多个弹窗
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'pt:changelog-claim') return;
    // 跨进程载荷不做类型假设 —— 字段不对就当没收到，不去写存储
    if (typeof msg.version !== 'string' || !msg.version) return;

    claimShow(msg.version)
      .then((granted) => sendResponse({ ok: true, granted }))
      .catch((e) => {
        console.error('[PT] 更新提示仲裁失败：', e);
        sendResponse({ ok: false, granted: false });
      });
    return true; // 异步响应
  });

  // 健康检查（E2E 测试用于验证消息通道就绪）
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'pt:ping') {
      sendResponse({ ok: true });
      return true;
    }
  });

  // 翻译代理
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'pt:translate') return;

    try {
      settingsReady()
        // #90：路由前确保 E2E mock 已从 storage 安装 —— SW 实例被替换后，
        // 实例内存里的 stub 消失，此步让 mock 随每次翻译自愈
        .then(() => ensureE2EMock())
        .then(() => route(msg.payload))
        .then((r) => sendResponse({ ok: true, data: r }))
        .catch((e) => {
          // #263: 纯透传 —— background 不再重算可重试性；引擎产出的
          // 类型化字段（category / retryable / invalidated / aborted）
          // 原样透出，语义判定只在错误发生的唯一地点做一次
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            retryable: e instanceof EngineError ? e.retryable : true,
            category: e instanceof EngineError ? e.category : 'transient',
            invalidated: e instanceof EngineError ? e.invalidated : false,
            aborted: e instanceof EngineError ? e.aborted : false,
          });
        });
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        retryable: e instanceof EngineError ? e.retryable : true,
        category: e instanceof EngineError ? e.category : 'transient',
        invalidated: e instanceof EngineError ? e.invalidated : false,
        aborted: e instanceof EngineError ? e.aborted : false,
      });
    }

    return true;
  });
});
