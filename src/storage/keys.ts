// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

import type { EngineId } from './schema';

const KEY = 'pt-keys';

interface KeyRecord {
  [engine: string]: string;
}

/**
 * 读取 BYOK 密钥。返回 undefined 表示未设置。
 * 密钥单独存 local，不进 sync，不随账号在云端流转。
 */
export async function getKey(engine: EngineId): Promise<string | undefined> {
  const result = await chrome.storage.local.get(KEY);
  const keys: KeyRecord = (result[KEY] as KeyRecord | undefined) ?? {};
  return keys[engine];
}

/**
 * 写入 BYOK 密钥。
 */
export async function setKey(engine: EngineId, value: string): Promise<void> {
  const result = await chrome.storage.local.get(KEY);
  const keys: KeyRecord = (result[KEY] as KeyRecord | undefined) ?? {};
  keys[engine] = value;
  await chrome.storage.local.set({ [KEY]: keys });
}

/**
 * 删除指定引擎的密钥。
 */
export async function removeKey(engine: EngineId): Promise<void> {
  const result = await chrome.storage.local.get(KEY);
  const keys: KeyRecord = (result[KEY] as KeyRecord | undefined) ?? {};
  delete keys[engine];
  await chrome.storage.local.set({ [KEY]: keys });
}
