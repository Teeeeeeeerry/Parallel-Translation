import '~/src/styles/popup.css';
import {
  type EngineId,
  ENGINE_LABELS,
  LANG_LIST,
} from '~/src/storage/schema';
import {
  settingsReady,
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

// ---- DOM refs ----
const toggle = document.getElementById('pt-toggle-master')!;
const engineSelect = document.getElementById('pt-engine-select') as HTMLSelectElement;
const fromSelect = document.getElementById('pt-from-select') as HTMLSelectElement;
const toSelect = document.getElementById('pt-to-select') as HTMLSelectElement;
const modeSelect = document.getElementById('pt-mode-select') as HTMLSelectElement;
const settingsBtn = document.getElementById('pt-settings-btn')!;

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
}

// ---- Event handlers ----

function onToggleClick(): void {
  const s = getSettings();
  patchSettings({ enabled: !s.enabled });
}

function onEngineChange(): void {
  const engine = engineSelect.value as EngineId;
  // enginePriority 数组按所选引擎调整 —— 所选引擎排最前，其余保持顺序
  const prev = getSettings().enginePriority;
  const updated: EngineId[] = [
    engine,
    ...prev.filter((e) => e !== engine),
  ];
  patchSettings({ enginePriority: updated });
}

function onFromChange(): void {
  patchSettings({ from: fromSelect.value });
}

function onToChange(): void {
  patchSettings({ to: toSelect.value });
}

function onModeChange(): void {
  patchSettings({ displayMode: modeSelect.value as 'bilingual' | 'translation-only' });
}

// ---- Init ----

async function init(): Promise<void> {
  // 加载设置
  await settingsReady();

  // 填充选项并同步 UI
  syncUI();

  // 监听
  toggle.addEventListener('click', onToggleClick);
  engineSelect.addEventListener('change', onEngineChange);
  fromSelect.addEventListener('change', onFromChange);
  toSelect.addEventListener('change', onToChange);
  modeSelect.addEventListener('change', onModeChange);

  // 跨上下文同步：别处改了设置 → 自动刷新 UI
  onSettingsChanged(() => syncUI());

  // 打开 options 页
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

document.addEventListener('DOMContentLoaded', init);
