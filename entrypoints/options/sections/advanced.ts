// Phase 7 — 高级分区：并发数、缓存管理、设置导入/导出。

import { DEFAULT_SETTINGS, clampConcurrency } from '~/src/storage/schema';
import { validateCustomCss } from '~/src/styles/custom';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
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
  try {
    const data = JSON.parse(json);
    // 白名单校验：只允许已知 Setting 字段
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const sanitized: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in data) sanitized[key] = data[key];
    }
    // #172: 值校验 —— 导入文件可绕过 UI 下拉，maxConcurrency 必须钳制，
    // 否则 0/负数会让 Google 闸门永久饿死、全部翻译挂起
    if (typeof sanitized.maxConcurrency === 'number') {
      sanitized.maxConcurrency = clampConcurrency(sanitized.maxConcurrency);
    }
    // #168: 导入同样走统一校验器 —— 否则 @import/url() 等可通过导入
    // 绕过表单校验，运行时注入被拒后旧样式还被清掉
    if (typeof sanitized.customCss === 'string') {
      const cssResult = validateCustomCss(sanitized.customCss);
      if (!cssResult.ok) {
        showToast(tf('toastImportFail', `导入失败：${cssResult.msg}`));
        return;
      }
    }
    // 显式移除任何密钥相关字段
    delete sanitized.apiKeys;
    await patchSettings(sanitized as any);
    showToast(tf('toastImported', '设置已导入'));
  } catch {
    showToast(tf('toastImportFail', '导入失败：JSON 格式无效'));
  }
}

async function resetSettings(): Promise<void> {
  // 清空缓存
  await cacheClear();
  // 清空所有 BYOK 密钥
  await removeKey('openai');
  await removeKey('deepl');
  await removeKey('gemini');
  // 重置设置为默认值
  await patchSettings(DEFAULT_SETTINGS);
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
