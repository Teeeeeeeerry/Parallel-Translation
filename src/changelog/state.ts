// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 更新提示的已读状态。
//
// 独立 key `pt-changelog`，不并入 `pt-settings`：它不是设置（用户不会
// 在 options 页里改它），而 settings-import 的配置导出会把 pt-settings
// 整个带走 —— 混进去会让别人导入你的配置时连「看过哪些更新」一起继承。
//
// 存 sync 而非 local：跨设备重复弹同一条更新纯属骚扰。写入极少，
// 不会触碰 sync 的写入频率限制。

const KEY = 'pt-changelog';

interface ChangelogState {
  /** 最后一次显示过更新提示的版本号 */
  lastSeenVersion?: string;
}

/** 读状态。任何异常（脏数据、存储不可用）一律当未读处理。 */
async function read(): Promise<ChangelogState> {
  try {
    const result = await chrome.storage.sync.get(KEY);
    const raw: unknown = result[KEY];
    // 存储内容不受我们控制（旧版本残留、手工改写、同步冲突），
    // 判类型而不是直接断言 —— 脏数据只该让提示不弹，不该抛错
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as ChangelogState;
    }
  } catch {
    // 存储不可用（配额、隐私模式）→ 当未读
  }
  return {};
}

/** 该版本的更新提示是否已经显示过。 */
export async function hasSeen(version: string): Promise<boolean> {
  const state = await read();
  return state.lastSeenVersion === version;
}

/**
 * 标记该版本已显示。按共识「显示出来即算已读」——点 X 关掉也算，
 * 不需要用户点「知道了」。
 *
 * 实际调用点在 claim.ts 发放显示权时（早于渲染），这样并发的多个标签页
 * 才只有一个能拿到。代价是渲染若失败就得由调用方 clearSeen 回滚。
 */
export async function markSeen(version: string): Promise<void> {
  const next: ChangelogState = { lastSeenVersion: version };
  await chrome.storage.sync.set({ [KEY]: next });
}

/**
 * 撤销已读标记 —— 仅用于「拿到了显示权但弹窗没能显示出来」的回滚。
 * 不撤销别的版本：期间若已被更新的版本覆盖，说明有更晚的一次显示成功了，
 * 此时清掉反而会让那个版本重弹。
 */
export async function clearSeen(version: string): Promise<void> {
  const state = await read();
  if (state.lastSeenVersion !== version) return;
  await chrome.storage.sync.remove(KEY);
}
