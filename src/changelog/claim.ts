// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 更新提示的显示权仲裁（background 侧）。
//
// 扩展更新后，用户打开的每个新页面都会有一个 content script 启动并来问
// 「该我弹吗」。它们彼此不知情，各自读存储会同时读到「未读」，于是同时
// 弹出多个弹窗。Service Worker 是单实例单线程的，把「查已读 → 占住显示权」
// 收到这里串行执行，第一个来问的占住，后来者得到 busy 或已读。

import { hasSeen } from './state';

/**
 * 串行队列。只用于排队，不关心每次的结果与异常 ——
 * 某次申请失败不该卡住后续申请。
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * 首装闸门。
 *
 * 首装靠 markInstalled 挡住更新提示，但那是异步的：storage 还没写完时，
 * content script 的 claim 会读到「未读」而拿到显示权，新用户于是在
 * 装完打开的第一个页面上看到一个「更新内容」弹窗 —— 全屏遮罩还会挡住
 * 页面。窗口很窄，但机器负载一变就会翻转，属于查起来很痛的偶发问题。
 *
 * onInstalled 的监听器同步置位此标志，而 SW 是单线程的，同步部分必然
 * 跑在任何 claim 消息之前，窗口因此归零。SW 回收后标志丢失，但那时
 * markInstalled 早已落盘，storage 判定接手。
 */
let freshInstall = false;

/** 标记本次为首次安装 —— 必须在 onInstalled 里同步调用。 */
export function markFreshInstall(): void {
  freshInstall = true;
}

/** 申请结果：拿到显示权 / 这个版本已读过 / 别的页面正占着显示权。 */
export type ClaimOutcome = 'granted' | 'seen' | 'busy';

/**
 * 正占着显示权的页面（#1172）。
 *
 * 显示权发出去时不再当场标记已读 —— 拿到的页面可能用户根本看不到（后台
 * 标签页、预渲染、马上跳走），当场标记会让这个上架版本的提示永久丢失。
 * 改为先占住：占用期间别的页面申请得到 busy，不会同时弹出多个；占用者在
 * 用户看到之后自己写入已读再释放，没看到就直接释放，下一个可见页面再弹。
 *
 * SW 回收时占用随内存丢失，最坏是另一个可见页面也弹一次；已读以存储为准，
 * 不会漏弹。
 */
let holder: object | null = null;

/**
 * 申请显示权。owner 标识申请方（后台用连接端口），同一个 owner 重复申请
 * 照样拿到。
 */
export function claimShow(version: string, owner: object): Promise<ClaimOutcome> {
  // 首装一律不发放：更新提示只服务老用户，新用户看到的是欢迎页
  if (freshInstall) return Promise.resolve('seen');

  const result = queue.then(async (): Promise<ClaimOutcome> => {
    if (await hasSeen(version)) return 'seen';
    if (holder && holder !== owner) return 'busy';
    holder = owner;
    return 'granted';
  });
  queue = result.catch(() => {});
  return result;
}

/** 释放显示权。只有占用者本人释放才生效；连接断开时后台也调这里。 */
export function releaseShow(owner: object): void {
  if (holder === owner) holder = null;
}
