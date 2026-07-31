// Phase 7 — 站点分区：黑/白名单模式切换 + 域名列表增删。

import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

export function initSites(): void {
  const selectMode = document.getElementById('pt-select-site-mode') as HTMLSelectElement;
  const input = document.getElementById('pt-site-input') as HTMLInputElement;
  const addBtn = document.getElementById('pt-site-add-btn')!;
  const listEl = document.getElementById('pt-site-list')!;

  function render(): void {
    const s = getSettings();
    selectMode.value = s.siteList.mode;

    listEl.innerHTML = s.siteList.list
      .map(
        (domain) => `
        <li class="pt-site-item">
          <span>${domain}</span>
          <button class="pt-site-remove" data-domain="${domain}">×</button>
        </li>`,
      )
      .join('');

    // Bind remove buttons
    listEl.querySelectorAll('.pt-site-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const domain = (btn as HTMLElement).dataset.domain;
        if (!domain) return;
        const updated = getSettings().siteList.list.filter((d) => d !== domain);
        savePatch({ siteList: { ...getSettings().siteList, list: updated } });
      });
    });
  }

  selectMode.addEventListener('change', () => {
    savePatch({
      siteList: {
        ...getSettings().siteList,
        mode: selectMode.value as 'blacklist' | 'whitelist',
      },
    });
  });

  function addDomain(): void {
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;
    // Basic domain validation
    if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(domain)) {
      input.classList.add('pt-error');
      return;
    }
    input.classList.remove('pt-error');

    const s = getSettings();
    if (s.siteList.list.includes(domain)) {
      input.value = '';
      return;
    }
    savePatch({
      siteList: {
        ...s.siteList,
        list: [...s.siteList.list, domain],
      },
    });
    input.value = '';
  }

  addBtn.addEventListener('click', addDomain);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
    input.classList.remove('pt-error');
  });

  render();
  onSettingsChanged(() => render());
}
