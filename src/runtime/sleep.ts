// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 共享 sleep —— #136：收敛 content.ts / messaging.ts / batch-retry.ts 三份复制。
//
// 用 globalThis.setTimeout 而非裸 setTimeout：content script（self 作用域）
// 与 service worker、Node 测试环境均可用，无环境绑定。

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * 可被中止信号打断的等待（#1065）：睡满 ms 或信号中止，先到先结束；不区分是
 * 哪一种，调用方醒来后自己看 signal.aborted。sleepFn 可注入虚拟时钟。
 */
export function sleepUnlessAborted(
  ms: number,
  signal: AbortSignal | undefined,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  if (!signal) return sleepFn(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done);
    sleepFn(ms).then(done, done);
  });
}
