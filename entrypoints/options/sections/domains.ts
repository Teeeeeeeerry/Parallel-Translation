// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译领域分区（#391，父 #365）：列出内置与自建领域，新建与删除自建领域；
// 编辑自建领域的适用网址（#392）与术语（#393）；编辑内置领域的术语
// （#395），内置领域的适用网址在本期只读；机翻引擎“指定译法”开关（#390）；
// 上移、下移调整领域顺序（#394）。

import { LANG_LIST } from '~/src/storage/schema';
import {
  getEffectiveDomains,
  createDomain,
  deleteDomain,
  moveDomain,
  setDomainSites,
  setDomainTerms,
  onDomainsChanged,
  InvalidSitesError,
  InvalidTermsError,
  DomainNotFoundError,
  isBuiltinTerm,
} from '~/src/storage/domains';
import { getSettings, patchSettings, onSettingsChanged } from '~/src/storage/settings';
import type { Domain, Term } from '~/src/storage/domains';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

function langLabel(code: string): string {
  return LANG_LIST.find((l) => l.code === code)?.label ?? code;
}

/**
 * 适用网址编辑（#392）：每行一个裸域名、localhost 或 IPv4 地址（#431），
 * 保存时整体替换。不合法的条目在输入框下方列出，不写入。
 */
function sitesEditor(d: Domain, onGone: () => void): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'pt-domain-sites';
  details.dataset.editor = 'sites';
  // 已保存的内容，重绘时据此判断能否保留未保存的改动
  details.dataset.saved = JSON.stringify(d.sites);

  const summary = document.createElement('summary');
  summary.textContent = tf('domainSitesSummary', `适用网址（${d.sites.length}）`, String(d.sites.length));

  const textarea = document.createElement('textarea');
  textarea.className = 'pt-input pt-domain-sites-input';
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.placeholder = tf('domainSitesPlaceholder', '每行一个域名、localhost 或 IPv4 地址，例如 example.com、192.168.1.10');
  textarea.value = d.sites.join('\n');

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
    clearError();
    setDomainSites(d.id, textarea.value.split('\n'))
      .then(() => showToast(tf('domainSitesSaved', '已保存适用网址')))
      .catch((e) => {
        if (e instanceof InvalidSitesError) {
          textarea.classList.add('pt-error');
          const list = e.invalid.join(listSep());
          error.textContent = tf('domainSitesInvalid', `以下网址格式不正确（只填域名、localhost 或 IPv4 地址，不带协议、端口和路径）：${list}`, list);
          error.classList.add('pt-visible');
        } else {
          saveFailed(e, error, onGone);
        }
      });
  });
  textarea.addEventListener('input', clearError);

  details.append(summary, textarea, error, save);
  return details;
}

/**
 * 保存失败（#430）：领域已在别处被删除时提示并刷新列表（该领域随之消失）；
 * 其他写入错误把原因写在编辑框下方。
 */
function saveFailed(e: unknown, error: HTMLElement, onGone: () => void): void {
  console.error('[PT] 保存领域失败:', e);
  if (e instanceof DomainNotFoundError) {
    showToast(tf('domainSaveDeleted', '这个领域已被删除，列表已刷新'), 4000);
    onGone();
    return;
  }
  const reason = failReason(e);
  error.textContent = tf('domainSaveFailed', `保存失败：${reason}`, reason);
  error.classList.add('pt-visible');
}

/** 给用户看的失败原因：去掉内部日志用的“[PT] ”前缀。 */
function failReason(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^\[PT\]\s*/, '');
}

/** 列表分隔符：中文界面用顿号。 */
function listSep(): string {
  return chrome.i18n.getUILanguage().startsWith('zh') ? '、' : ', ';
}

/**
 * 术语表的一行：原词 / 译法 / 不翻译 / 删除。勾选“不翻译”后译法列禁用。
 * 内置术语（#395）只能改译法与“不翻译”：原词只读，没有删除按钮。
 */
function termRow(onRemove: () => void, t?: Term, builtin = false): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const source = document.createElement('input');
  source.className = 'pt-input pt-term-source';
  source.value = t?.source ?? '';
  source.placeholder = tf('domainTermsSource', '原词');
  source.readOnly = builtin;
  // 只读的原词不进 Tab 顺序，免得出现焦点框像是能编辑
  if (builtin) source.tabIndex = -1;

  const target = document.createElement('input');
  target.className = 'pt-input pt-term-target';
  target.value = t?.target ?? '';
  target.placeholder = tf('domainTermsTarget', '译法');

  const noTranslate = document.createElement('input');
  noTranslate.type = 'checkbox';
  noTranslate.className = 'pt-term-no-translate';
  noTranslate.checked = t?.noTranslate === true;
  noTranslate.title = tf('domainTermsNoTranslate', '不翻译');
  target.disabled = noTranslate.checked;
  noTranslate.addEventListener('change', () => {
    target.disabled = noTranslate.checked;
  });

  const del = document.createElement('button');
  del.className = 'pt-site-remove';
  del.textContent = '×';
  del.title = tf('domainDelete', '删除');
  del.addEventListener('click', () => {
    tr.remove();
    onRemove();
  });

  for (const el of [source, target, noTranslate, builtin ? null : del]) {
    const td = document.createElement('td');
    if (el) td.append(el);
    tr.append(td);
  }
  return tr;
}

/**
 * 术语表格编辑（#393）：列为原词 / 译法 / 不翻译，可新增、修改、删除
 * 行，保存时整体替换。重复的原词、缺译法或缺原词的行标红并在表格下方
 * 说明，不写入。内置领域（#395）同样可编辑，保存到叠加层。
 */
function termsEditor(d: Domain, onGone: () => void): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'pt-domain-terms';
  details.dataset.editor = 'terms';
  details.dataset.saved = JSON.stringify(d.terms);

  const summary = document.createElement('summary');
  summary.textContent = tf('domainTermsSummary', `术语（${d.terms.length}）`, String(d.terms.length));

  const table = document.createElement('table');
  table.className = 'pt-domain-terms-table';
  const head = document.createElement('tr');
  for (const [key, text] of [
    ['domainTermsSource', '原词'],
    ['domainTermsTarget', '译法'],
    ['domainTermsNoTranslate', '不翻译'],
    ['', ''],
  ] as const) {
    const th = document.createElement('th');
    th.textContent = key ? tf(key, text) : '';
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  tbody.append(...d.terms.map((t) => termRow(clearError, t, isBuiltinTerm(d.id, t.source))));
  table.append(thead, tbody);

  const error = document.createElement('p');
  error.className = 'pt-input-err pt-domain-terms-error';

  const add = document.createElement('button');
  add.className = 'pt-btn pt-btn-secondary';
  add.textContent = tf('domainTermsAdd', '添加一行');
  add.addEventListener('click', () => {
    const tr = termRow(clearError);
    tbody.append(tr);
    tr.querySelector('input')!.focus();
  });

  const save = document.createElement('button');
  save.className = 'pt-btn';
  save.textContent = tf('domainTermsSave', '保存');

  function rows(): { tr: HTMLTableRowElement; term: Term }[] {
    return [...tbody.rows].map((tr) => {
      const [source, target, noTranslate] = tr.querySelectorAll('input');
      return {
        tr,
        term: { source: source!.value, target: target!.value, noTranslate: noTranslate!.checked },
      };
    });
  }

  function clearError(): void {
    tbody.querySelectorAll('.pt-error').forEach((el) => el.classList.remove('pt-error'));
    error.classList.remove('pt-visible');
  }

  function showError(e: InvalidTermsError): void {
    const sep = listSep();
    for (const { tr, term } of rows()) {
      // 与 setDomainTerms 同一口径：勾选“不翻译”的行不看译法
      const source = term.source.trim();
      const target = term.noTranslate ? '' : (term.target?.trim() ?? '');
      const [sourceInput, targetInput] = tr.querySelectorAll('input');
      if (source && e.duplicates.includes(source.toLowerCase())) sourceInput!.classList.add('pt-error');
      if (source && !term.noTranslate && !target) targetInput!.classList.add('pt-error');
      if (!source && target) sourceInput!.classList.add('pt-error');
    }
    const lines: string[] = [];
    if (e.duplicates.length > 0) {
      const list = e.duplicates.join(sep);
      lines.push(tf('domainTermsDuplicate', `原词重复：${list}`, list));
    }
    if (e.missingTarget.length > 0) {
      const list = e.missingTarget.join(sep);
      lines.push(tf('domainTermsMissingTarget', `以下原词需要填写译法或勾选“不翻译”：${list}`, list));
    }
    if (e.missingSource.length > 0) {
      const list = e.missingSource.join(sep);
      lines.push(tf('domainTermsMissingSource', `以下译法缺少原词：${list}`, list));
    }
    error.textContent = lines.join('\n');
    error.classList.add('pt-visible');
  }

  save.addEventListener('click', () => {
    clearError();
    setDomainTerms(d.id, rows().map((r) => r.term))
      .then(() => showToast(tf('domainTermsSaved', '已保存术语')))
      .catch((e) => {
        if (e instanceof InvalidTermsError) showError(e);
        else saveFailed(e, error, onGone);
      });
  });
  tbody.addEventListener('input', clearError);
  tbody.addEventListener('change', clearError);

  const actions = document.createElement('div');
  actions.className = 'pt-domain-terms-actions';
  actions.append(add, save);

  details.append(summary, table, error, actions);
  return details;
}

/**
 * 上移或下移按钮（#394）。排在两端时对应的按钮不可用。
 */
function moveButton(
  d: Domain,
  direction: 'up' | 'down',
  disabled: boolean,
  onMove: (d: Domain, direction: 'up' | 'down') => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'pt-domain-move';
  btn.dataset.direction = direction;
  btn.textContent = direction === 'up' ? '↑' : '↓';
  btn.title = direction === 'up' ? tf('domainMoveUp', '上移') : tf('domainMoveDown', '下移');
  btn.disabled = disabled;
  btn.addEventListener('click', () => onMove(d, direction));
  return btn;
}

/** 一行领域：名称、目标语言、上移下移、内置标注或删除按钮。领域名是用户输入，只走 textContent。 */
function domainItem(
  d: Domain,
  pos: { first: boolean; last: boolean },
  onMove: (d: Domain, direction: 'up' | 'down') => void,
  onDelete: (d: Domain) => void,
  onGone: () => void,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'pt-site-item pt-domain-item';
  li.dataset.id = d.id;

  const name = document.createElement('span');
  name.className = 'pt-domain-name';
  name.textContent = d.name;

  const lang = document.createElement('span');
  lang.className = 'pt-domain-lang';
  lang.textContent = langLabel(d.targetLang);

  li.append(
    name,
    lang,
    moveButton(d, 'up', pos.first, onMove),
    moveButton(d, 'down', pos.last, onMove),
  );

  if (d.origin === 'builtin') {
    const badge = document.createElement('span');
    badge.className = 'pt-domain-badge';
    badge.textContent = tf('domainBuiltinBadge', '内置');
    li.append(badge, termsEditor(d, onGone));
  } else {
    const del = document.createElement('button');
    del.className = 'pt-site-remove';
    del.textContent = '×';
    del.title = tf('domainDelete', '删除');
    del.addEventListener('click', () => onDelete(d));
    li.append(del, sitesEditor(d, onGone), termsEditor(d, onGone));
  }
  return li;
}

export function initDomains(): void {
  const listEl = document.getElementById('pt-domain-list')!;
  const nameInput = document.getElementById('pt-domain-name-input') as HTMLInputElement;
  const langSelect = document.getElementById('pt-domain-lang-select') as HTMLSelectElement;
  const createBtn = document.getElementById('pt-domain-create-btn')!;
  const toggleMtTermTargets = document.getElementById('pt-toggle-mt-term-targets')!;

  langSelect.innerHTML = LANG_LIST.filter((l) => l.code !== 'auto')
    .map((l) => `<option value="${l.code}">${l.label}</option>`)
    .join('');
  // 默认选中当前设置的目标语言 —— 新建的领域通常就是给它用的
  langSelect.value = getSettings().to;

  let renderSeq = 0;
  async function render(): Promise<void> {
    // 连续变更时只用最后一次读取的结果，先发起、后返回的旧读取不覆盖新列表
    const seq = ++renderSeq;
    const domains = await getEffectiveDomains();
    if (seq !== renderSeq) return;
    // 任一领域变更都整表重绘：旧行换成新行，保留各编辑框的展开状态；
    // 编辑框对应的已保存内容没变时，连同未保存的改动与错误提示一起保留
    const old = new Map(
      [...listEl.querySelectorAll<HTMLElement>('.pt-domain-item')].map((li) => [li.dataset.id, li]),
    );
    const items = domains.map((d, i) => {
      const pos = { first: i === 0, last: i === domains.length - 1 };
      const li = domainItem(d, pos, move, remove, refresh);
      const prevLi = old.get(d.id);
      li.querySelectorAll('details').forEach((next) => {
        const prev = prevLi?.querySelector<HTMLDetailsElement>(
          `details[data-editor="${next.dataset.editor}"]`,
        );
        if (!prev) return;
        next.open = prev.open;
        if (prev.dataset.saved === next.dataset.saved) next.replaceWith(prev);
      });
      return li;
    });
    // #394: 焦点在上移、下移按钮上时，重绘后交还给同一领域的同一按钮；
    // 它移到端点后不可用，改给另一个方向的按钮，便于用键盘连续调整
    const focused = document.activeElement;
    const focusedMove =
      focused instanceof HTMLElement && focused.classList.contains('pt-domain-move')
        ? { id: focused.closest<HTMLElement>('.pt-domain-item')?.dataset.id, dir: focused.dataset.direction }
        : null;
    listEl.replaceChildren(...items);
    if (focusedMove) {
      const li = items.find((el) => el.dataset.id === focusedMove.id);
      const buttons = [...(li?.querySelectorAll<HTMLButtonElement>(':scope > .pt-domain-move') ?? [])];
      const same = buttons.find((b) => b.dataset.direction === focusedMove.dir);
      (same && !same.disabled ? same : buttons.find((b) => !b.disabled))?.focus();
    }
  }

  // #394: 顺序写入后经存储变更整表重绘；失败时提示原因，列表保持原样
  function move(d: Domain, direction: 'up' | 'down'): void {
    moveDomain(d.id, direction).catch((e) => {
      console.error('[PT] 调整领域顺序失败:', e);
      const reason = failReason(e);
      showToast(tf('domainMoveFailed', `调整顺序失败：${reason}`, reason), 4000);
    });
  }

  function remove(d: Domain): void {
    if (!confirm(tf('domainDeleteConfirm', `确定删除领域“${d.name}”吗？删除后无法恢复。`, d.name))) {
      return;
    }
    // #470: 失败时提示原因，列表以存储为准保持原样
    deleteDomain(d.id).catch((e) => {
      console.error('[PT] 删除领域失败:', e);
      const reason = failReason(e);
      showToast(tf('domainDeleteFailed', `删除领域失败：${reason}`, reason), 4000);
    });
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
      // #470: 失败时提示原因，名称留在输入框里方便重试
      .catch((e) => {
        console.error('[PT] 新建领域失败:', e);
        const reason = failReason(e);
        showToast(tf('domainCreateFailed', `新建领域失败：${reason}`, reason), 4000);
      });
  }

  createBtn.addEventListener('click', create);
  nameInput.addEventListener('input', () => nameInput.classList.remove('pt-error'));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
  });

  // #390: 机翻引擎应用指定译法的术语
  const syncMtTermTargets = () =>
    toggleMtTermTargets.classList.toggle('pt-on', getSettings().mtApplyTermTargets);
  toggleMtTermTargets.addEventListener('click', () => {
    patchSettings({ mtApplyTermTargets: !getSettings().mtApplyTermTargets })
      .catch((e) => console.error('[PT] 设置写入失败:', e));
  });
  syncMtTermTargets();
  onSettingsChanged(syncMtTermTargets);

  const refresh = () => render().catch((e) => console.error('[PT] 读取领域失败:', e));
  refresh();
  // 其他设置页标签页新建 / 删除 / 修改后同步刷新
  onDomainsChanged(refresh);
}
