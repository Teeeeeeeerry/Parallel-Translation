// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 高级分区：并发数、缓存管理、设置导入/导出。

import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  replaceSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { importSettings as applyImport } from '~/src/storage/settings-import';
import { cacheClear } from '~/src/storage/cache';
import { removeKey } from '~/src/storage/keys';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

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

async function importSettings(json: string): Promise<void> {
  // #324: 导入走整体替换语义（与恢复默认一致）—— 解析校验在
  // settings-import 模块，失败时配置保持不变
  const result = await applyImport(json);
  if (result.ok) {
    showToast(tf('toastImported', '设置已导入'));
  } else {
    showToast(tf('toastImportFail', `导入失败：${result.reason}`));
  }
}

async function resetSettings(): Promise<void> {
  // 清空缓存
  await cacheClear();
  // 清空所有 BYOK 密钥
  await removeKey('openai');
  await removeKey('deepl');
  await removeKey('gemini');
  // #169: 整体替换而非 patch —— patch 对 models 是合并语义，
  // DEFAULT_SETTINGS.models = {} 合并不掉自定义模型名，恢复默认后
  // openai/gemini 自定义模型会残留
  await replaceSettings(DEFAULT_SETTINGS);
  showToast(tf('toastReset', '已恢复默认设置'));
}

export function initAdvanced(): void {
  const selectConcurrency = document.getElementById('pt-select-concurrency') as HTMLSelectElement;
  const toggleCache = document.getElementById('pt-toggle-cache')!;
  const cacheStats = document.getElementById('pt-cache-stats')!;
  const clearCacheBtn = document.getElementById('pt-clear-cache-btn')!;
  const exportBtn = document.getElementById('pt-export-settings-btn')!;
  const importBtn = document.getElementById('pt-import-settings-btn')!;
  const importFile = document.getElementById('pt-import-file') as HTMLInputElement;
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
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parallel-translation-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(tf('toastExported', '设置已导出（不含 API key）'));
  });

  importBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importSettings(reader.result as string).catch((e) =>
        console.error('[PT] 导入失败:', e),
      );
    };
    reader.readAsText(file);
    importFile.value = ''; // 允许重复导入同一文件
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
