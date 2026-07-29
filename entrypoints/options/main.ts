import '~/src/styles/tokens.css';
import {
  settingsReady,
  getSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

const statusDiv = document.getElementById('pt-options-status')!;

function render(): void {
  const s = getSettings();
  statusDiv.innerHTML = `<h2>当前设置（实时）</h2>
<pre>${JSON.stringify(s, null, 2)}</pre>
<p style="color: var(--pt-forest-55); font-size: 10px;">
  在 popup 中修改设置，此处将自动更新。
</p>`;
}

async function init(): Promise<void> {
  await settingsReady();
  render();

  // 跨上下文同步：popup 改设置 → options 页即时刷新
  onSettingsChanged(() => render());
}

document.addEventListener('DOMContentLoaded', init);
