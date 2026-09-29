// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — Options 页主控制器。
// 管理 6 个标签页的切换，统一处理 toast 提示。

import './options.css';
import {
  settingsReady,
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { detectOS } from '~/src/hotkeys/platform';
import { StorageQuotaError } from '~/src/storage/quota';
import { applyI18n, tf } from '~/src/i18n';
import { initGeneral } from './sections/general';
import { initEngines } from './sections/engines';
import { initAppearance } from './sections/appearance';
import { initHotkeys } from './sections/hotkeys';
import { initSites } from './sections/sites';
import { initAdvanced } from './sections/advanced';
import { initDomains } from './sections/domains';
import { initSiteRules } from './sections/site-rules';

// ---- Tab navigation ----

function initTabs(): void {
  const navButtons = document.querySelectorAll<HTMLButtonElement>('.pt-nav-btn');
  const sections = document.querySelectorAll<HTMLElement>('.pt-section');

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      if (!target) return;

      navButtons.forEach((b) => b.classList.remove('pt-active'));
      btn.classList.add('pt-active');

      sections.forEach((s) => s.classList.remove('pt-active'));
      document.getElementById(`pt-section-${target}`)?.classList.add('pt-active');
    });
  });
}

// ---- Toast ----

export function showToast(msg: string, duration = 2000): void {
  const el = document.getElementById('pt-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
  clearTimeout((el as any)._tid);
  (el as any)._tid = setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}

// ---- Failure reason ----

/**
 * 给用户看的失败原因：去掉内部日志用的“[PT] ”前缀；存储空间不足时说明
 * 办法（#510）。设置页各分区的失败提示都用它（#528）。
 */
export function failReason(e: unknown): string {
  if (e instanceof StorageQuotaError) {
    return tf('domainStorageFull', '存储空间不足，可以在“高级”分区点“清空缓存”后重试');
  }
  return (e instanceof Error ? e.message : String(e)).replace(/^\[PT\]\s*/, '');
}

// ---- Download ----

/** 下载开始之后多久释放临时链接（#494）。 */
const REVOKE_DELAY_MS = 60_000;

/**
 * 把文本存成文件并触发下载（#494）。设置页的各个导出都用它。
 *
 * 临时链接延后释放：Chrome 在触发下载时已经取到文件，但 Firefox 的下载
 * 异步开始，同一时刻释放可能导致下载失败或得到空文件。FileSaver.js 同样
 * 延后几十秒才释放。
 */
export function downloadFile(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

// ---- Init ----

async function init(): Promise<void> {
  await settingsReady();
  const os = await detectOS();

  // 静态文案先本地化，再交给各 section 渲染动态内容
  applyI18n();

  initTabs();
  initGeneral();
  initEngines();
  initAppearance();
  initHotkeys(os);
  initSites();
  initAdvanced();
  initDomains();
  initSiteRules();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    console.error('[PT] options 初始化失败:', e);
    const main = document.querySelector('.pt-main');
    if (main) main.textContent = tf('optionsLoadFail', '设置加载失败，请刷新页面');
  });
});
