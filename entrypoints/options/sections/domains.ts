// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译领域分区（#391，父 #365）：列出内置与自建领域，新建与删除自建领域。
// 内置领域在本期只读；术语、适用网址的编辑由后续 ticket 接入。

import { LANG_LIST } from '~/src/storage/schema';
import {
  getEffectiveDomains,
  createDomain,
  deleteDomain,
  onDomainsChanged,
} from '~/src/storage/domains';
import { getSettings } from '~/src/storage/settings';
import type { Domain } from '~/src/storage/domains';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

function langLabel(code: string): string {
  return LANG_LIST.find((l) => l.code === code)?.label ?? code;
}

/** 一行领域：名称、目标语言、内置标注或删除按钮。领域名是用户输入，只走 textContent。 */
function domainItem(d: Domain, onDelete: (d: Domain) => void): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'pt-site-item pt-domain-item';

  const name = document.createElement('span');
  name.className = 'pt-domain-name';
  name.textContent = d.name;

  const lang = document.createElement('span');
  lang.className = 'pt-domain-lang';
  lang.textContent = langLabel(d.targetLang);

  li.append(name, lang);

  if (d.origin === 'builtin') {
    const badge = document.createElement('span');
    badge.className = 'pt-domain-badge';
    badge.textContent = tf('domainBuiltinBadge', '内置 · 只读');
    li.append(badge);
  } else {
    const del = document.createElement('button');
    del.className = 'pt-site-remove';
    del.textContent = '×';
    del.title = tf('domainDelete', '删除');
    del.addEventListener('click', () => onDelete(d));
    li.append(del);
  }
  return li;
}

export function initDomains(): void {
  const listEl = document.getElementById('pt-domain-list')!;
  const nameInput = document.getElementById('pt-domain-name-input') as HTMLInputElement;
  const langSelect = document.getElementById('pt-domain-lang-select') as HTMLSelectElement;
  const createBtn = document.getElementById('pt-domain-create-btn')!;

  langSelect.innerHTML = LANG_LIST.filter((l) => l.code !== 'auto')
    .map((l) => `<option value="${l.code}">${l.label}</option>`)
    .join('');
  // 默认选中当前设置的目标语言 —— 新建的领域通常就是给它用的
  langSelect.value = getSettings().to;

  async function render(): Promise<void> {
    const domains = await getEffectiveDomains();
    listEl.replaceChildren(...domains.map((d) => domainItem(d, remove)));
  }

  function remove(d: Domain): void {
    if (!confirm(tf('domainDeleteConfirm', `确定删除领域“${d.name}”吗？删除后无法恢复。`, d.name))) {
      return;
    }
    deleteDomain(d.id)
      .catch((e) => console.error('[PT] 删除领域失败:', e));
  }

  function create(): void {
    if (!nameInput.value.trim()) {
      nameInput.classList.add('pt-error');
      return;
    }
    createDomain({ name: nameInput.value, targetLang: langSelect.value })
      .then(() => {
        nameInput.value = '';
        showToast(tf('domainCreated', '已新建领域'));
      })
      .catch((e) => console.error('[PT] 新建领域失败:', e));
  }

  createBtn.addEventListener('click', create);
  nameInput.addEventListener('input', () => nameInput.classList.remove('pt-error'));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
  });

  const refresh = () => render().catch((e) => console.error('[PT] 读取领域失败:', e));
  refresh();
  // 其他设置页标签页新建 / 删除后同步刷新
  onDomainsChanged(refresh);
}
