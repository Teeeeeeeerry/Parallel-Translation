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
 * 申请显示权。返回 true 表示调用方应当弹出更新提示，
 * 且该版本已被标记为已读（共识：显示出来即算已读）。
 */
export function claimShow(version: string): Promise<boolean> {
  const result = queue.then(async () => {
    if (await hasSeen(version)) return false;
    await markSeen(version);
    return true;
  });
  queue = result.catch(() => {});
  return result;
}
