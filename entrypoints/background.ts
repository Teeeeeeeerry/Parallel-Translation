import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { settingsReady, onSettingsChanged } from '~/src/storage/settings';
import { route } from '~/src/engines/router';

// Service Worker 入口。
// 阶段 1 暴露 cache / keys 供 DoD 验证。
// 阶段 2 代理翻译请求并触发 content script。

export default defineBackground(() => {
  console.log('[PT] Background service worker started');

  // 首次加载设置并注册变更监听，保持内存副本与 sync 同步。
  // 这里必须吃掉 rejection —— 监听器里逃出去的异常会被 Chrome 记成
  // 「Error in event handler」，且没有可用堆栈。
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

  // Content script 无法直接 fetch 跨域翻译端点，统一在此代理
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // msg 可能是 null / 非对象（其它扩展、页面脚本、WXT 自身的内部消息都会
    // 进到这里）。直接 msg.type 解引用会抛 TypeError，异常逃出监听器后
    // Chrome 只记一条「Error in event handler」，堆栈是 :0 匿名函数。
    if (msg?.type !== 'pt:translate') return;

    try {
      // SW 休眠后重新唤醒时模块重新求值，await settingsReady()
      // 保证每次唤醒后的第一条消息也拿到真实设置
      settingsReady()
        .then(() => route(msg.payload))
        .then((r) => sendResponse({ ok: true, data: r }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    } catch (e) {
      // 同步抛错也要回给调用方，否则通道悬空到超时
      sendResponse({ ok: false, error: String(e) });
    }

    return true; // 保持通道开启，否则 sendResponse 静默失效
  });
});
