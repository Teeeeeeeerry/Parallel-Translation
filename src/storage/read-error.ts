// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 存储读取失败（#537、#549）—— 领域与站点页面规则两个存储模块共用。
//
// 设置页的失败提示显示去掉“[PT] ”前缀的原因。只描述读取本身：列表与
// 导出不改动数据，写入路径另外说明未作改动。

/** 设置页用的只读入口读不到存储（#537）。cause 是原始错误。 */
export class StorageReadError extends Error {
  constructor(cause: unknown) {
    super('[PT] 暂时读不到存储里的数据，请稍后重试', { cause });
    this.name = 'StorageReadError';
  }
}
