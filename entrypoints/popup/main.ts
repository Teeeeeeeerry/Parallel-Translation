// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

import '~/src/styles/popup.css';
import {
  type EngineId,
  ENGINE_LABELS,
  LANG_LIST,
} from '~/src/storage/schema';
import { applyI18n, tf } from '~/src/i18n';
import { logoMarkSvg } from '~/src/ui/logo';
import {
  settingsReady,
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

// ---- DOM refs ----
const toggle = document.getElementById('pt-toggle-master')!;
const translatePageBtn = document.getElementById('pt-translate-page-btn')!;
const engineSelect = document.getElementById('pt-engine-select') as HTMLSelectElement;
const fromSelect = document.getElementById('pt-from-select') as HTMLSelectElement;
const toSelect = document.getElementById('pt-to-select') as HTMLSelectElement;
const modeSelect = document.getElementById('pt-mode-select') as HTMLSelectElement;
const styleSelect = document.getElementById('pt-style-select') as HTMLSelectElement;
const settingsBtn = document.getElementById('pt-settings-btn')!;
const reportBtn = document.getElementById('pt-report-btn')!;

/** 汇报问题的落点。GitHub 的新建 issue 页，带模板选择。 */
const ISSUE_URL = 'https://github.com/Teeeeeeeerry/Parallel-Translation/issues/new';

// 头部标识与扩展图标、悬浮球同源（src/ui/logo.ts）。标记框 32px，
// 走 compact 字形 —— regular 在这个尺寸下笔画会糊在一起。
document.getElementById('pt-logo')!.innerHTML = logoMarkSvg(32, { compact: true });

// ---- Lang / engine option lists ----

function buildLangOptions(selected: string, includeAuto: boolean): string {
  return LANG_LIST
    .filter((l) => includeAuto || l.code !== 'auto')
    .map(
      (l) =>
        `<option value="${l.code}"${l.code === selected ? ' selected' : ''}>${l.label}</option>`,
    )
    .join('');
}

function buildEngineOptions(priority: EngineId[]): string {
  const engines: EngineId[] = [
    'google-web',
    'bing-edge',
    'openai',
    'deepl',
    'gemini',
  ];
  return engines
    .map(
      (e) =>
        `<option value="${e}"${e === priority[0] ? ' selected' : ''}>${ENGINE_LABELS[e]}</option>`,
    )
    .join('');
}

// ---- Sync UI from settings ----

function syncUI(): void {
  const s = getSettings();

  // Toggle
  toggle.classList.toggle('pt-on', s.enabled);

  // Engine
  engineSelect.innerHTML = buildEngineOptions(s.enginePriority);

  // From / To
  fromSelect.innerHTML = buildLangOptions(s.from, true);
  toSelect.innerHTML = buildLangOptions(s.to, false);

  // Display mode
  modeSelect.value = s.displayMode;

  // Style
  styleSelect.value = s.style;
}

// ---- Event handlers ----

/** 写设置失败（配额、sync 不可用）不应变成未处理拒绝。 */
function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => {
    console.error('[PT] 设置写入失败:', e);
    showHint(tf('hintSaveFail', '设置保存失败'));
  });
}

function onToggleClick(): void {
  const s = getSettings();
  savePatch({ enabled: !s.enabled });
}

async function onTranslatePageClick(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId == null) return;

    // 必须广播到所有 frame（不带 frameId），否则 all_frames 注入的 iframe
    // content script 收不到指令，iframe 内文本永远不会被翻译。
    // 提示文案的准确性由 content script 保证：只有主文档那份会 sendResponse，
    // 子 frame 照常翻译但不占用响应通道，因此这里拿到的必定是主文档的结果。
    const resp = await chrome.tabs.sendMessage(tabId, {
      type: 'pt:toggle-translate',
    });
    if (resp?.status === 'disabled') {
      showHint(tf('hintDisabled', '总开关已关闭'));
    } else if (resp?.status === 'no-elements') {
      showHint(tf('hintNoElements', '本页没有可翻译的内容'));
    }
  } catch {
    // 页面可能不支持内容脚本（如 chrome:// 页）。
    // tabs.query 也要罩在里面 —— 它抛出的 rejection 会变成 popup 里的
    // 未处理拒绝，同样被记成事件处理器错误。
    showHint(tf('hintCantTranslate', '当前页面无法翻译'));
  }
}

function showHint(msg: string): void {
  const hint = document.getElementById('pt-hint');
  if (hint) {
    hint.textContent = msg;
    hint.style.display = '';
    clearTimeout((hint as any)._timeout);
    (hint as any)._timeout = setTimeout(() => {
      hint.style.display = 'none';
    }, 2000);
  }
}

function onEngineChange(): void {
  const engine = engineSelect.value as EngineId;
  // enginePriority 数组按所选引擎调整 —— 所选引擎排最前，其余保持顺序
  const prev = getSettings().enginePriority;
  const updated: EngineId[] = [
    engine,
    ...prev.filter((e) => e !== engine),
  ];
  savePatch({ enginePriority: updated });
}

function onFromChange(): void {
  savePatch({ from: fromSelect.value });
}

function onToChange(): void {
  savePatch({ to: toSelect.value });
}

function onModeChange(): void {
  savePatch({ displayMode: modeSelect.value as 'bilingual' | 'translation-only' });
}

function onStyleChange(): void {
  savePatch({ style: styleSelect.value as any });
}

// ---- Init ----

async function init(): Promise<void> {
  // 版本号从 manifest 读取 —— 手工同步页脚已连续三个阶段出现漂移
  const versionEl = document.getElementById('pt-version');
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  // 静态文案本地化
  applyI18n();

  // 加载设置
  await settingsReady();

  // 填充选项并同步 UI
  syncUI();

  // 监听
  toggle.addEventListener('click', onToggleClick);
  translatePageBtn.addEventListener('click', onTranslatePageClick);
  engineSelect.addEventListener('change', onEngineChange);
  fromSelect.addEventListener('change', onFromChange);
  toSelect.addEventListener('change', onToChange);
  modeSelect.addEventListener('change', onModeChange);
  styleSelect.addEventListener('change', onStyleChange);

  // 跨上下文同步：别处改了设置 → 自动刷新 UI
  onSettingsChanged(() => syncUI());

  // 打开 options 页
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 汇报问题 —— 新标签页打开 GitHub issue。popup 会在失焦时关闭，
  // 用 window.open 会连 popup 一起没掉，故走 tabs.create
  reportBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: ISSUE_URL }).catch((e) =>
      console.error('[PT] 打开 issue 页失败:', e),
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    console.error('[PT] popup 初始化失败:', e);
    showHint(tf('hintInitFail', '初始化失败，请重新打开'));
  });
});
