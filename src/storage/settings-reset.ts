// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 恢复默认设置（#612）—— 设置页“恢复默认”的存储侧，可独立单测。
//   1. 清翻译缓存
//   2. 清掉全部自带 key 引擎的 key —— 范围取自引擎清单（#608），新增的
//      引擎（DeepSeek 等）自动在内
//   3. 设置整体替换为默认值 —— 不用 patch：patch 对 models 是合并语义，
//      合并不掉自定义模型名（#169）

import { DEFAULT_SETTINGS } from './schema';
import { replaceSettings } from './settings';
import { removeByokKeys } from './keys';
import { cacheClear } from './cache';

export async function resetSettings(): Promise<void> {
  await cacheClear();
  await removeByokKeys();
  await replaceSettings(DEFAULT_SETTINGS);
}
