// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译领域分区（#391，父 #365）：列出内置与自建领域，新建与删除自建领域；
// 编辑自建领域的适用网址（#392）。内置领域在本期只读；术语的编辑由后续
// ticket 接入。

import { LANG_LIST } from '~/src/storage/schema';
import {
  getEffectiveDomains,
  createDomain,
  deleteDomain,
  setDomainSites,
  onDomainsChanged,
  InvalidSitesError,
} from '~/src/storage/domains';
import { getSettings } from '~/src/storage/settings';
import type { Domain } from '~/src/storage/domains';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

function langLabel(code: string): string {
  return LANG_LIST.find((l) => l.code === code)?.label ?? code;
}

/**
 * 适用网址编辑（#392）：每行一个裸域名，保存时整体替换。不合法的条目
 * 在输入框下方列出，不写入。
 */
function sitesEditor(d: Domain): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'pt-domain-sites';

  const summary = document.createElement('summary');
  summary.textContent = tf('domainSitesSummary', `适用网址（${d.sites.length}）`, String(d.sites.length));

  const textarea = document.createElement('textarea');
  textarea.className = 'pt-input pt-domain-sites-input';
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.placeholder = tf('domainSitesPlaceholder', '每行一个域名，例如 example.com');
  // defaultValue 记下已保存的内容，重绘时据此判断有没有未保存的改动
  textarea.defaultValue = d.sites.join('\n');

  const error = document.createElement('p');
  error.className = 'pt-input-err pt-domain-sites-error';

  const save = document.createElement('button');
  save.className = 'pt-btn';
  save.textContent = tf('domainSitesSave', '保存');

  function clearError(): void {
    textarea.classList.remove('pt-error');
    error.classList.remove('pt-visible');
  }

  save.addEventListener('click', () => {
    setDomainSites(d.id, textarea.value.split('\n'))
      .then(() => showToast(tf('domainSitesSaved', '已保存适用网址')))
      .catch((e) => {
        if (e instanceof InvalidSitesError) {
          textarea.classList.add('pt-error');
          const sep = chrome.i18n.getUILanguage().startsWith('zh') ? '、' : ', ';
          const list = e.invalid.join(sep);
          error.textContent = tf('domainSitesInvalid', `以下网址格式不正确：${list}`, list);
          error.classList.add('pt-visible');
        } else {
          console.error('[PT] 保存适用网址失败:', e);
        }
      });
  });
  textarea.addEventListener('input', clearError);

  details.append(summary, textarea, error, save);
  return details;
}

/** 一行领域：名称、目标语言、内置标注或删除按钮。领域名是用户输入，只走 textContent。 */
function domainItem(d: Domain, onDelete: (d: Domain) => void): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'pt-site-item pt-domain-item';
  li.dataset.id = d.id;

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
    li.append(del, sitesEditor(d));
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
    // 任一领域变更都整表重绘：旧行换成新行，保留展开状态；已保存的网址
    // 没变时，连同未保存的改动与错误提示一起保留
    const old = new Map(
      [...listEl.querySelectorAll<HTMLElement>('.pt-domain-item')].map((li) => [li.dataset.id, li]),
    );
    const items = domains.map((d) => {
      const li = domainItem(d, remove);
      const prev = old.get(d.id)?.querySelector('details');
      const next = li.querySelector('details');
      if (prev && next) {
        next.open = prev.open;
        const prevInput = prev.querySelector('textarea')!;
        const nextInput = next.querySelector('textarea')!;
        if (prevInput.defaultValue === nextInput.defaultValue) next.replaceWith(prev);
      }
      return li;
    });
    listEl.replaceChildren(...items);
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
  // 其他设置页标签页新建 / 删除 / 修改后同步刷新
  onDomainsChanged(refresh);
}
