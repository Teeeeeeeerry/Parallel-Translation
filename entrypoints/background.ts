import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { route } from '~/src/engines/router';

// Service Worker 入口。
// 阶段 1 暴露 cache / keys 供 DoD 验证。
// 阶段 2 代理翻译请求并触发 content script。

export default defineBackground(() => {
  console.log('[PT] Background service worker started');

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
    if (msg.type !== 'pt:translate') return;
    route(msg.payload)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // 保持通道开启，否则 sendResponse 静默失效
  });
});
