// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// storage.local 配额（#510）—— 用户数据写入遇到存储空间不足时的错误。
//
// 扩展申请了 unlimitedStorage，正常情况下不会遇到配额；翻译缓存另有字节
// 上限（cache.ts）。仍然遇到时，给设置页一个说得清原因与办法的错误。

/** 写入失败是因为存储空间不足：Chrome 报 “QUOTA_BYTES quota exceeded”，Firefox 报 QuotaExceededError。 */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  return name === 'QuotaExceededError' || (typeof message === 'string' && /quota/i.test(message));
}

/** 用户数据因存储空间不足没有保存（#510）。cause 是原始错误。 */
export class StorageQuotaError extends Error {
  constructor(cause: unknown) {
    super('[PT] 存储空间不足，可以在“高级”分区清空翻译缓存后重试', { cause });
    this.name = 'StorageQuotaError';
  }
}
