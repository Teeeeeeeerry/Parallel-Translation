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
// 用户看过的版本存 sync：跨设备重复弹同一条更新纯属骚扰。写入极少，
// 不会触碰 sync 的写入频率限制。
//
// 首装标记存 local（#1172）：它只该挡住本机。以前也写 sync，用户在另一台
// 设备新装同一版本，这台设备升级到这个版本后就读到“已读”、不再弹出。
// 旧版本写进 sync 的首装标记分不出来，照旧按已读处理。

const KEY = 'pt-changelog';

interface ChangelogState {
  /** 最后一次被用户看过的版本号（sync） */
  lastSeenVersion?: string;
  /** 本机首装时的版本号（local） */
  installedVersion?: string;
}

/** 读一处存储。任何异常（脏数据、存储不可用）一律当未读处理。 */
async function read(area: chrome.storage.StorageArea): Promise<ChangelogState> {
  try {
    const result = await area.get(KEY);
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

/** 该版本的更新提示是否已经看过（任一设备看过，或本机首装就是这个版本）。 */
export async function hasSeen(version: string): Promise<boolean> {
  const [synced, local] = await Promise.all([
    read(chrome.storage.sync),
    read(chrome.storage.local),
  ]);
  return synced.lastSeenVersion === version || local.installedVersion === version;
}

/**
 * 标记该版本已被用户看过：在可见页面上关掉弹窗，或弹窗持续可见满阈值
 * （#1172，见 prompt.ts）。
 */
export async function markSeen(version: string): Promise<void> {
  const next: ChangelogState = { lastSeenVersion: version };
  await chrome.storage.sync.set({ [KEY]: next });
}

/** 首装时标记本机当前版本，只挡本机。 */
export async function markInstalled(version: string): Promise<void> {
  const next: ChangelogState = { installedVersion: version };
  await chrome.storage.local.set({ [KEY]: next });
}
