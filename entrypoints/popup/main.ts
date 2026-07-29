import '~/src/styles/popup.css';

// Popup 入口。阶段 0 仅挂载静态 UI，toggle 和 settings 按钮的交互。
// 阶段 1 起接真实 settings。

function init() {
  const toggle = document.getElementById('pt-toggle-master');
  const settingsBtn = document.getElementById('pt-settings-btn');

  // Toggle 切换动画（仅 UI 效果，阶段 1 接真实状态）
  toggle?.addEventListener('click', () => {
    toggle.classList.toggle('pt-on');
  });

  // 打开 options 页
  settingsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

document.addEventListener('DOMContentLoaded', init);
