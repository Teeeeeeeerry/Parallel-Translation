// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 更新提示的显示权仲裁（background 侧）。
//
// 扩展更新后，用户打开的每个新页面都会有一个 content script 启动并来问
// 「该我弹吗」。它们彼此不知情，各自读存储会同时读到「未读」，于是同时
// 弹出多个弹窗。Service Worker 是单实例单线程的，把「查已读 → 标已读」
// 这一对操作收到这里串行执行，第一个来问的拿到显示权并立即标记，
// 后来者读到的就是已读。
//
// SW 被回收时队列随内存消失，但那之前 markSeen 已经落到 storage，
// 重建后的实例第一次查询即返回已读 —— 回收不会导致重复弹出。

import { hasSeen, markSeen } from './state';

/**
 * 串行队列。只用于排队，不关心每次的结果与异常 ——
 * 某次申请失败不该卡住后续申请。
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * 首装闸门。
 *
 * 首装靠 markSeen 挡住更新提示，但那是异步的：storage 还没写完时，
 * content script 的 claim 会读到「未读」而拿到显示权，新用户于是在
 * 装完打开的第一个页面上看到一个「更新内容」弹窗 —— 全屏遮罩还会挡住
 * 页面。窗口很窄，但机器负载一变就会翻转，属于查起来很痛的偶发问题。
 *
 * onInstalled 的监听器同步置位此标志，而 SW 是单线程的，同步部分必然
 * 跑在任何 claim 消息之前，窗口因此归零。SW 回收后标志丢失，但那时
 * markSeen 早已落盘，storage 判定接手。
 */
let freshInstall = false;

/** 标记本次为首次安装 —— 必须在 onInstalled 里同步调用。 */
export function markFreshInstall(): void {
  freshInstall = true;
}

/**
 * 申请显示权。返回 true 表示调用方应当弹出更新提示，
 * 且该版本已被标记为已读（共识：显示出来即算已读）。
 */
export function claimShow(version: string): Promise<boolean> {
  // 首装一律不发放：更新提示只服务老用户，新用户看到的是欢迎页
  if (freshInstall) return Promise.resolve(false);

  const result = queue.then(async () => {
    if (await hasSeen(version)) return false;
    await markSeen(version);
    return true;
  });
  queue = result.catch(() => {});
  return result;
}
