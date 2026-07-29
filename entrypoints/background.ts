// Service Worker 入口。阶段 0 为空实现。
// 阶段 1 起处理 storage 事件，阶段 2 起处理翻译请求。

export default defineBackground(() => {
  console.log('[PT] Background service worker started');
});
