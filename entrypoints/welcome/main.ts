import './welcome.css';
import { applyI18n } from '~/src/i18n';
import { detectOS, formatHotkey } from '~/src/hotkeys/platform';
import { settingsReady, getSettings, patchSettings } from '~/src/storage/settings';
import { DEFAULT_SETTINGS, LANG_LIST, type HotkeyAction } from '~/src/storage/schema';

// ---- 快捷键渲染 ----

const HOTKEY_ACTIONS: { action: HotkeyAction; i18nKey: string }[] = [
  { action: 'toggle-translate', i18nKey: 'actionToggleTranslate' },
  { action: 'toggle-mode', i18nKey: 'actionToggleMode' },
  { action: 'translate-paragraph', i18nKey: 'actionTranslateParagraph' },
  { action: 'toggle-extension', i18nKey: 'actionToggleExtension' },
];

function renderHotkeys(os: Awaited<ReturnType<typeof detectOS>>): void {
  const container = document.getElementById('pt-welcome-hotkeys');
  if (!container) return;

  const hotkeys = DEFAULT_SETTINGS.hotkeys;

  container.innerHTML = HOTKEY_ACTIONS.map(({ action, i18nKey }) => {
    const label = chrome.i18n.getMessage(i18nKey) || action;
    const combo = formatHotkey(hotkeys[action], os);
    return `<div class="pt-welcome-hotkey-row">
      <span class="pt-welcome-hotkey-label">${label}</span>
      <kbd class="pt-welcome-kbd">${combo}</kbd>
    </div>`;
  }).join('');
}

// ---- 语言选择 ----

function renderLangSelect(currentTo: string): void {
  const select = document.getElementById('pt-welcome-lang-select') as HTMLSelectElement;
  if (!select) return;

  // 排除 'auto'，欢迎页只选目标语言
  const targets = LANG_LIST.filter((l) => l.code !== 'auto');

  select.innerHTML = targets.map((l) => {
    const selected = l.code === currentTo ? ' selected' : '';
    return `<option value="${l.code}"${selected}>${l.label}</option>`;
  }).join('');

  select.addEventListener('change', () => {
    patchSettings({ to: select.value }).catch((e) =>
      console.error('[PT] 保存目标语言失败:', e),
    );
  });
}

// ---- 按钮事件 ----

function bindButtons(): void {
  document.getElementById('pt-welcome-settings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.() ??
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  });

  document.getElementById('pt-welcome-close')?.addEventListener('click', () => {
    window.close();
  });
}

// ---- 初始化 ----

async function init(): Promise<void> {
  await settingsReady();
  const settings = getSettings();
  const os = await detectOS();

  applyI18n();
  renderHotkeys(os);
  renderLangSelect(settings.to);
  bindButtons();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => console.error('[PT] 欢迎页初始化失败:', e));
});
