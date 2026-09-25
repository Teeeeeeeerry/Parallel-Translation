// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 站点规则分区（#370，父 #365）：新增站点卡片，在各字段的多行文本框里
// 每行写一个 CSS 选择器。用户规则逐字段追加在内置规则之上，保存后刷新
// 该站点生效。字段按判定顺序排列：限定范围（#374）、排除、保留原文（#373）。
// 保存时逐行校验选择器（#372），有无效行时整张卡片不保存，在对应文本框下
// 列出行号与选择器，修改后提示消失。渲染卡片时对已保存的规则做同样的
// 校验（#443）：导入等途径带进的无效行照样标出。删除卡片（#371）前先确认，
// 删除后该站点只剩内置规则生效。有内置规则的站点，卡片上显示“停用这个
// 站点的内置规则”开关（#375），点击即保存。全部用户规则可导出为 JSON
// 文件（#376），用于备份和迁移；导入的文件与现有用户规则合并（#377）。

import {
  getUserSiteRules,
  saveUserSiteRules,
  deleteUserSiteRules,
  setBuiltinSiteRulesDisabled,
  hasBuiltinSiteRules,
  onUserSiteRulesChanged,
  exportUserSiteRules,
  importUserSiteRules,
  findInvalidSelectors,
  InvalidSelectorsError,
} from '~/src/storage/specialization';
import type { InvalidSelector, SiteRules, UserSiteRules } from '~/src/storage/specialization';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

type Field = keyof SiteRules;

/** 卡片上的文本框，按判定顺序。每次渲染卡片时取，界面语言以当时为准。 */
function fieldDefs(): Array<{ field: Field; label: string; placeholder: string }> {
  return [
    {
      field: 'scope',
      label: tf('siteRulesScope', '限定范围'),
      placeholder: tf('siteRulesScopePlaceholder', '每行一个 CSS 选择器；填写后只翻译命中的元素，留空则不限定'),
    },
    {
      field: 'exclude',
      label: tf('siteRulesExclude', '排除'),
      placeholder: tf('siteRulesExcludePlaceholder', '每行一个 CSS 选择器，命中的元素整块不翻译'),
    },
    {
      field: 'preserve',
      label: tf('siteRulesPreserve', '保留原文'),
      placeholder: tf('siteRulesPreservePlaceholder', '每行一个 CSS 选择器，命中的行内元素不翻译，原文留在译文里'),
    },
  ];
}

/** 一张站点卡片的元素，以及上次渲染时各字段的已保存内容。 */
interface Card {
  el: HTMLDivElement;
  inputs: Map<Field, HTMLTextAreaElement>;
  /** 各字段已保存的文本 —— 文本框与它相同时说明该字段没有未保存的改动 */
  saved: Map<Field, string>;
  /** 按无效选择器标出各字段：有则标红并逐行列出，没有则清除提示 */
  showInvalid: (invalid: InvalidSelector[], fields?: Iterable<Field>) => void;
  /** 停用内置规则的开关，站点没有内置规则时为 null（#375） */
  builtinToggle: HTMLButtonElement | null;
}

const toText = (sels: string[] = []) => sels.join('\n');

/**
 * 站点卡片：站点名、各字段的多行文本框、保存与删除按钮。站点名是用户
 * 输入，只走 textContent。
 */
function siteCard(u: UserSiteRules, onDelete: (site: string) => void): Card {
  const el = document.createElement('div');
  el.className = 'pt-card pt-site-rules-card';

  const site = document.createElement('div');
  site.className = 'pt-site-rules-site';
  site.textContent = u.site;
  el.append(site);

  // #375：有内置规则的站点才显示停用开关
  let builtinToggle: HTMLButtonElement | null = null;
  if (hasBuiltinSiteRules(u.site)) {
    const row = document.createElement('div');
    row.className = 'pt-row pt-site-rules-builtin';
    const label = document.createElement('span');
    label.className = 'pt-row-label';
    label.textContent = tf('siteRulesDisableBuiltin', '停用这个站点的内置规则');
    const toggle = document.createElement('button');
    toggle.className = 'pt-toggle pt-site-rules-builtin-toggle';
    toggle.setAttribute('aria-label', label.textContent);
    toggle.addEventListener('click', () => {
      const disabled = !toggle.classList.contains('pt-on');
      setBuiltinSiteRulesDisabled(u.site, disabled)
        .then(() => {
          toggle.classList.toggle('pt-on', disabled);
          showToast(tf('siteRulesSaved', '已保存，刷新该网站后生效'));
        })
        .catch((e) => console.error('[PT] 保存站点规则失败:', e));
    });
    row.append(label, toggle);
    el.append(row);
    builtinToggle = toggle;
  }

  const inputs = new Map<Field, HTMLTextAreaElement>();
  const errors = new Map<Field, HTMLParagraphElement>();
  for (const def of fieldDefs()) {
    const label = document.createElement('div');
    label.className = 'pt-card-label';
    label.textContent = def.label;

    const input = document.createElement('textarea');
    input.className = 'pt-input';
    input.dataset.field = def.field;
    input.rows = 4;
    input.spellcheck = false;
    input.placeholder = def.placeholder;

    const error = document.createElement('p');
    error.className = 'pt-input-err pt-site-rules-error';
    errors.set(def.field, error);
    input.addEventListener('input', () => {
      input.classList.remove('pt-error');
      error.classList.remove('pt-visible');
    });

    el.append(label, input, error);
    inputs.set(def.field, input);
  }

  const actions = document.createElement('div');
  actions.className = 'pt-actions';
  const save = document.createElement('button');
  save.className = 'pt-btn pt-site-rules-save';
  save.textContent = tf('siteRulesSave', '保存');
  const del = document.createElement('button');
  del.className = 'pt-btn pt-btn-secondary pt-site-rules-delete';
  del.textContent = tf('siteRulesDelete', '删除站点');
  del.addEventListener('click', () => onDelete(u.site));
  actions.append(save, del);
  el.append(actions);

  save.addEventListener('click', () => {
    const rules: Partial<SiteRules> = {};
    for (const [field, input] of inputs) rules[field] = input.value.split('\n');
    saveUserSiteRules(u.site, rules)
      .then(() => showToast(tf('siteRulesSaved', '已保存，刷新该网站后生效')))
      .catch((e) => {
        if (e instanceof InvalidSelectorsError) showInvalid(e.invalid);
        else console.error('[PT] 保存站点规则失败:', e);
      });
  });

  /** 无效选择器：标红对应文本框，逐行列出行号与选择器；没有无效行的字段清除提示 */
  function showInvalid(invalid: InvalidSelector[], fields: Iterable<Field> = inputs.keys()): void {
    for (const field of fields) {
      const input = inputs.get(field)!;
      const error = errors.get(field)!;
      const lines = invalid
        .filter((i) => i.field === field)
        .map((i) =>
          tf('siteRulesInvalidSelector', `第 ${i.line} 行不是有效的 CSS 选择器：${i.selector}`,
            String(i.line), i.selector),
        );
      input.classList.toggle('pt-error', lines.length > 0);
      error.textContent = lines.join('\n');
      error.classList.toggle('pt-visible', lines.length > 0);
    }
  }
  return { el, inputs, saved: new Map(), showInvalid, builtinToggle };
}

export function initSiteRules(): void {
  const listEl = document.getElementById('pt-site-rules-list')!;
  const siteInput = document.getElementById('pt-site-rules-site-input') as HTMLInputElement;
  const addBtn = document.getElementById('pt-site-rules-add-btn')!;
  const exportBtn = document.getElementById('pt-site-rules-export-btn')!;
  const importBtn = document.getElementById('pt-site-rules-import-btn')!;
  const importFile = document.getElementById('pt-site-rules-import-file') as HTMLInputElement;

  /** 已渲染的卡片，按站点复用 —— 保存一张卡片时，其他卡片未保存的改动不丢 */
  const cards = new Map<string, Card>();

  async function render(): Promise<void> {
    const list = await getUserSiteRules();
    const els = list.map((u) => {
      let card = cards.get(u.site);
      if (!card) {
        card = siteCard(u, remove);
        cards.set(u.site, card);
      }
      // #443：已保存的规则也逐行校验。只标没有未保存改动的字段 ——
      // 行号对应的是已保存的文本
      const clean: Field[] = [];
      for (const [field, input] of card.inputs) {
        const text = toText(u[field]);
        if (input.value === (card.saved.get(field) ?? '')) {
          input.value = text;
          clean.push(field);
        }
        card.saved.set(field, text);
      }
      card.showInvalid(findInvalidSelectors(u), clean);
      card.builtinToggle?.classList.toggle('pt-on', u.disableBuiltin === true);
      return card.el;
    });
    listEl.replaceChildren(...els);
    // 已删除的站点不再复用旧卡片 —— 重新新增同名站点时从空白开始
    for (const site of cards.keys()) {
      if (!list.some((u) => u.site === site)) cards.delete(site);
    }
  }

  function remove(site: string): void {
    if (
      !confirm(
        tf('siteRulesDeleteConfirm',
          `确定删除站点“${site}”的规则吗？删除后该站点只剩内置规则生效。`, site),
      )
    ) {
      return;
    }
    deleteUserSiteRules(site)
      .then(render)
      .then(() => showToast(tf('siteRulesDeleted', '已删除，刷新该网站后生效')))
      .catch((e) => console.error('[PT] 删除站点规则失败:', e));
  }

  function add(): void {
    const site = siteInput.value.trim().toLowerCase();
    saveUserSiteRules(site, {})
      .then(render)
      .then(() => {
        siteInput.value = '';
        cards.get(site)?.inputs.values().next().value?.focus();
      })
      .catch((e) => {
        // 不是裸域名（或写入失败）：标红输入框，不新增卡片
        siteInput.classList.add('pt-error');
        console.warn('[PT] 新增站点卡片失败:', e);
      });
  }

  /** #376：导出全部用户规则，下载一个 JSON 文件 */
  function exportJson(): void {
    exportUserSiteRules()
      .then((json) => {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'parallel-translation-site-rules.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast(tf('siteRulesExported', '站点规则已导出'));
      })
      .catch((e) => console.error('[PT] 导出站点规则失败:', e));
  }

  /** #377：导入 JSON 文件，与现有用户规则合并后重新渲染卡片 */
  function importJson(): void {
    const file = importFile.files?.[0];
    // 清空选择：再次选同一个文件也会触发 change
    importFile.value = '';
    if (!file) return;
    file
      .text()
      .then(importUserSiteRules)
      .then(async ({ imported }) => {
        await render();
        showToast(
          tf('siteRulesImported', `已导入 ${imported} 个站点，刷新网站后生效`, String(imported)),
        );
      })
      .catch((e) => console.error('[PT] 导入站点规则失败:', e));
  }

  addBtn.addEventListener('click', add);
  exportBtn.addEventListener('click', exportJson);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importJson);
  siteInput.addEventListener('input', () => siteInput.classList.remove('pt-error'));
  siteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });

  const refresh = () => render().catch((e) => console.error('[PT] 读取站点规则失败:', e));
  refresh();
  // 其他设置页标签页保存后同步刷新
  onUserSiteRulesChanged(refresh);
}
