import { cacheSet, cacheKey, cacheGet, cacheClear } from '~/src/storage/cache';
import { getKey, setKey, removeKey } from '~/src/storage/keys';

// Service Worker 入口。阶段 1 暴露 cache / keys 供 DoD 验证。
// 阶段 2 起处理翻译请求。

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
});
