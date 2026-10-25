// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 高级分区：并发数、缓存管理、设置导入/导出。

import {
  getSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { IMPORT_BAD_JSON, importSettings as applyImport } from '~/src/storage/settings-import';
import { cacheClear } from '~/src/storage/cache';
import { resetSettings as resetAllSettings } from '~/src/storage/settings-reset';
import { tf } from '~/src/i18n';
import { showToast } from '../main';
import { downloadFile, importFile, wireFileImport } from '../file-io';
import { savePatch } from '../save-settings';

/**
 * 导出设置，显式剔除 API key。
 * pt-keys 存在 chrome.storage.local 中，与 settings 分离，所以直接
 * JSON.stringify(getSettings()) 本身就不含 key。这里做显式兜底以防未来
 * schema 变更引入密钥字段。
 */
async function exportSettings(): Promise<string> {
  const s = getSettings();
  // Deep clone and strip any potential key leakage
  const clean = JSON.parse(JSON.stringify(s)) as typeof s;
  // models 中可能存有自定义端点 URL（含 token），也一并清除
  delete (clean as any).apiKeys;
  // 确保 models 不含敏感信息（仅保留模型名）
  return JSON.stringify(clean, null, 2);
}

/** 文件不是能导入的设置（JSON 无效、自定义 CSS 校验不过）：配置保持不变，message 是原因。 */
class InvalidSettingsFile extends Error {}

/**
 * 导入设置（#1124：读文件、读取失败与存储配额的提示走设置页共用函数）。#324：
 * 导入走整体替换语义（与恢复默认一致）—— 解析校验在 settings-import 模块，失败时
 * 配置保持不变。
 */
async function importSettings(file: File): Promise<void> {
  const result = await importFile(
    file,
    async (json) => {
      const r = await applyImport(json);
      if (!r.ok) throw new InvalidSettingsFile(r.reason);
    },
    {
      what: '导入设置',
      // JSON 无效给本地化的固定文案；别的原因（自定义 CSS 校验不过）照原样说出来 ——
      // 原先一律显示“JSON 格式无效”，用户找不到真正的问题
      failure: (e) => {
        if (!(e instanceof InvalidSettingsFile)) return null;
        if (e.message === IMPORT_BAD_JSON) return tf('toastImportFail', '导入失败：JSON 格式无效');
        return tf('importFailed', `导入失败：${e.message}`, e.message);
      },
    },
  );
  showToast(result.ok ? tf('toastImported', '设置已导入') : result.message, result.ok ? 2000 : 4000);
}

async function resetSettings(): Promise<void> {
  // #612: 清缓存、清全部自带 key 引擎的 key、设置整体替换为默认值，
  // 都在存储模块里
  await resetAllSettings();
  showToast(tf('toastReset', '已恢复默认设置'));
}

export function initAdvanced(): void {
  const selectConcurrency = document.getElementById('pt-select-concurrency') as HTMLSelectElement;
  const toggleCache = document.getElementById('pt-toggle-cache')!;
  const cacheStats = document.getElementById('pt-cache-stats')!;
  const clearCacheBtn = document.getElementById('pt-clear-cache-btn')!;
  const exportBtn = document.getElementById('pt-export-settings-btn')!;
  const importBtn = document.getElementById('pt-import-settings-btn')!;
  const importInput = document.getElementById('pt-import-file') as HTMLInputElement;
  const resetBtn = document.getElementById('pt-reset-settings-btn')!;

  function syncUI(): void {
    const s = getSettings();
    selectConcurrency.value = String(s.maxConcurrency);
    toggleCache.classList.toggle('pt-on', s.useCache);
  }

  async function updateCacheStats(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('pt-cache-index');
      const index: string[] = (result['pt-cache-index'] as string[] | undefined) ?? [];
      cacheStats.textContent = tf('cacheEntries', `缓存条目：${index.length}`, String(index.length));
    } catch {
      cacheStats.textContent = tf('cacheUnknown', '缓存条目：未知');
    }
  }

  selectConcurrency.addEventListener('change', () => {
    savePatch({ maxConcurrency: Number(selectConcurrency.value) });
  });

  toggleCache.addEventListener('click', () => {
    savePatch({ useCache: !getSettings().useCache });
  });

  clearCacheBtn.addEventListener('click', async () => {
    await cacheClear();
    await updateCacheStats();
    showToast(tf('toastCacheCleared', '缓存已清空'));
  });

  exportBtn.addEventListener('click', async () => {
    const json = await exportSettings();
    downloadFile(json, 'parallel-translation-settings.json', 'application/json');
    showToast(tf('toastExported', '设置已导出（不含 API key）'));
  });

  // #1124：选完清空 value（允许重复导入同一文件）、读文件与失败提示都在共用函数里
  wireFileImport(importBtn, importInput, (file) => {
    importSettings(file).catch((e) => console.error('[PT] 导入设置之后更新界面失败:', e));
  });

  resetBtn.addEventListener('click', () => {
    if (confirm(tf('confirmReset', '确定要恢复所有设置为默认值并清除所有缓存和 API key 吗？此操作不可撤销。'))) {
      resetSettings().catch((e) => console.error('[PT] 重置失败:', e));
    }
  });

  syncUI();
  updateCacheStats();
  onSettingsChanged(() => {
    syncUI();
    updateCacheStats();
  });
}
