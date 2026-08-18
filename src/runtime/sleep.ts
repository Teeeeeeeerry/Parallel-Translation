// 共享 sleep —— #136：收敛 content.ts / messaging.ts / batch-retry.ts 三份复制。
//
// 用 globalThis.setTimeout 而非裸 setTimeout：content script（self 作用域）
// 与 service worker、Node 测试环境均可用，无环境绑定。

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
