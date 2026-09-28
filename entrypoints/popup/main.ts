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
import { sleep } from '~/src/runtime/sleep';
import { parseDomainChoice } from '~/src/storage/domains';
import type { DomainChoice } from '~/src/storage/domains';
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
const domainSelect = document.getElementById('pt-domain-select') as HTMLSelectElement;

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

/**
 * #429: content script 就绪前（页面加载中打开 popup）询问会被拒绝，
 * 按这个序列有界重试，总共约 5 秒。
 */
const DOMAIN_RETRY_DELAYS_MS = [200, 400, 800, 1600, 2000];
/** 每次刷新递增；后发起的刷新开始后，先前的重试不再写界面。 */
let domainRefresh = 0;

/** 本页主文档回复的领域状态（#399、#400）。 */
interface DomainAnswer {
  /** 自动判定会选中的领域名，没有命中为 null。 */
  autoName: string | null;
  /** 本标签页的临时选择。 */
  choice: DomainChoice;
  /** 可切换到的领域：服务当前目标语言的领域，按领域列表顺序。 */
  options: { id: string; name: string }[];
}

function parseDomainAnswer(resp: unknown): DomainAnswer | null {
  const r = resp as Partial<Record<keyof DomainAnswer, unknown>> | undefined;
  const choice = parseDomainChoice(r?.choice);
  if (!r || !choice || !Array.isArray(r.options)) return null;
  return {
    autoName: typeof r.autoName === 'string' ? r.autoName : null,
    choice,
    options: r.options.filter((o) => typeof o?.id === 'string' && typeof o?.name === 'string'),
  };
}

/** 问一次当前领域；content script 未就绪或本页不支持时返回 null。 */
async function askCurrentDomain(tabId: number): Promise<DomainAnswer | null> {
  try {
    const resp = await chrome.tabs.sendMessage(
      tabId,
      { type: 'pt:current-domain', to: getSettings().to },
      { frameId: 0 },
    );
    return parseDomainAnswer(resp);
  } catch {
    return null;
  }
}

/**
 * 领域下拉（#400）：第一项“自动”带上自动判定的结果，然后是可切换到的
 * 领域，最后是“无领域”。本页不支持内容脚本时只显示禁用的“无领域”。
 * 领域名是用户输入，只走 textContent。
 */
function renderDomainSelect(answer: DomainAnswer | null): void {
  const option = (value: string, label: string) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    return el;
  };
  const none = tf('domainPopupNone', '无领域');
  if (!answer) {
    domainSelect.replaceChildren(option('auto', none));
    domainSelect.disabled = true;
    return;
  }
  const autoName = answer.autoName ?? none;
  domainSelect.replaceChildren(
    option('auto', tf('domainPopupAuto', `自动（${autoName}）`, autoName)),
    ...answer.options.map((o) => option(o.id, o.name)),
    option('none', none),
  );
  const { choice } = answer;
  const value = choice.kind === 'domain' ? choice.id : choice.kind;
  // 选中的领域已不在可选列表里（被删除、目标语言已改）：按自动显示
  domainSelect.value = [...domainSelect.options].some((o) => o.value === value) ? value : 'auto';
  domainSelect.disabled = false;
}

/**
 * 当前标签页的当前领域（#399）。问本页主文档的 content script ——
 * 与全页翻译实际携带的领域一致；页面不支持内容脚本（chrome:// 等）时
 * 显示禁用的“无领域”。
 *
 * 询问失败时有界重试（#429），重试期间界面不变（初始即为禁用的
 * “无领域”），不支持内容脚本的页面因此没有延迟也没有闪烁。
 */
async function refreshDomain(): Promise<void> {
  const refresh = ++domainRefresh;
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch {
    // 拿不到标签页：按无领域显示
  }
  let answer: DomainAnswer | null = null;
  if (tabId != null) {
    for (let attempt = 0; ; attempt++) {
      answer = await askCurrentDomain(tabId);
      if (answer || attempt >= DOMAIN_RETRY_DELAYS_MS.length) break;
      await sleep(DOMAIN_RETRY_DELAYS_MS[attempt]!);
      if (refresh !== domainRefresh) return;
    }
  }
  if (refresh !== domainRefresh) return;
  renderDomainSelect(answer);
}

/**
 * 临时切换当前标签页的领域（#400）：广播到本页全部 frame，iframe 里的
 * 翻译请求与主文档带同一个领域；主文档回复切换后的状态。只影响之后的
 * 翻译请求，已经显示的译文不变。
 */
async function onDomainChange(): Promise<void> {
  // 切换后不再采用切换前发起的询问结果
  const refresh = ++domainRefresh;
  const v = domainSelect.value;
  const choice: DomainChoice =
    v === 'auto' || v === 'none' ? { kind: v } : { kind: 'domain', id: v };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error('no active tab');
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'pt:set-domain',
      choice,
      to: getSettings().to,
    });
    if (refresh === domainRefresh) renderDomainSelect(parseDomainAnswer(resp));
  } catch {
    showHint(tf('hintCantTranslate', '当前页面无法翻译'));
    void refreshDomain();
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
  domainSelect.addEventListener('change', () => void onDomainChange());

  refreshDomain();

  // 跨上下文同步：别处改了设置 → 自动刷新 UI；目标语言变了当前领域
  // 可能随之变化（#399）
  onSettingsChanged(() => {
    syncUI();
    refreshDomain();
  });

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
