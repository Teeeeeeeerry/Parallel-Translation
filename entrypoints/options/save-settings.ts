// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 设置页各分区共用的“保存设置”（#1124）：原先 6 个分区各定义一份相同的函数，
// 写入失败只打日志，用户看不到。

import { patchSettings } from '~/src/storage/settings';
import { tf } from '~/src/i18n';
import { failReason } from './file-io';
import { showToast } from './main';

/** 改几项设置；写入失败时提示原因（存储空间不足时说明办法）。 */
export function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => {
    console.error('[PT] 设置写入失败:', e);
    const reason = failReason(e);
    showToast(tf('settingsSaveFailed', `保存设置失败：${reason}`, reason), 4000);
  });
}
