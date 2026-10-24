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
import { applyI18n, loadUiLocale, tf } from '~/src/i18n';
import { logoMarkSvg } from '~/src/ui/logo';
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

// ---- Init ----

async function init(): Promise<void> {
  // #605: 侧栏品牌头的标识与 popup 头部、悬浮球、扩展图标同源（src/ui/logo.ts），
  // 尺寸与字形变体同 popup：标记框 32px，compact 字形。不依赖设置，先画
  document.getElementById('pt-logo')!.innerHTML = logoMarkSvg(32, { compact: true });

  await settingsReady();
  // #1100: 选了扩展语言时先载入取文表，载完再渲染任何文案
  const uiLocaleChoice = getSettings().uiLocale;
  await loadUiLocale(uiLocaleChoice);
  // 扩展语言变了就整页重新载入，静态与动态文案一次换齐；本页改的和别处
  // （另一个设置页、导入、恢复默认）改的都走这里。载入后立刻订阅，不漏掉初始化期间的变化
  onSettingsChanged((s) => {
    if (s.uiLocale !== uiLocaleChoice) location.reload();
  });
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
