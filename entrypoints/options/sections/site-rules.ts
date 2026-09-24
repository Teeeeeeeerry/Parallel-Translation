// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 站点规则分区（#370，父 #365）：新增站点卡片，在“排除”里每行写一个
// CSS 选择器。用户规则逐字段追加在内置规则之上，保存后刷新该站点生效。
// 删除卡片、保存时校验选择器、保留原文等由后续 ticket 接入。

import {
  getUserSiteRules,
  saveUserSiteRules,
  onUserSiteRulesChanged,
} from '~/src/storage/specialization';
import type { UserSiteRules } from '~/src/storage/specialization';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

/** 一张站点卡片的元素，以及上次渲染时的已保存内容。 */
interface Card {
  el: HTMLDivElement;
  exclude: HTMLTextAreaElement;
  /** 已保存的排除文本 —— 文本框与它相同时说明没有未保存的改动 */
  saved: string;
}

const toText = (sels: string[] = []) => sels.join('\n');

/** 站点卡片：站点名、“排除”多行文本框、保存按钮。站点名是用户输入，只走 textContent。 */
function siteCard(u: UserSiteRules): Card {
  const el = document.createElement('div');
  el.className = 'pt-card pt-site-rules-card';

  const site = document.createElement('div');
  site.className = 'pt-site-rules-site';
  site.textContent = u.site;

  const label = document.createElement('div');
  label.className = 'pt-card-label';
  label.textContent = tf('siteRulesExclude', '排除');

  const exclude = document.createElement('textarea');
  exclude.className = 'pt-input';
  exclude.rows = 4;
  exclude.spellcheck = false;
  exclude.placeholder = tf('siteRulesExcludePlaceholder', '每行一个 CSS 选择器，命中的元素整块不翻译');

  const actions = document.createElement('div');
  actions.className = 'pt-actions';
  const save = document.createElement('button');
  save.className = 'pt-btn';
  save.textContent = tf('siteRulesSave', '保存');
  actions.append(save);

  el.append(site, label, exclude, actions);

  const card: Card = { el, exclude, saved: '' };
  save.addEventListener('click', () => {
    saveUserSiteRules(u.site, { exclude: exclude.value.split('\n') })
      .then(() => showToast(tf('siteRulesSaved', '已保存，刷新该网站后生效')))
      .catch((e) => console.error('[PT] 保存站点规则失败:', e));
  });
  return card;
}

export function initSiteRules(): void {
  const listEl = document.getElementById('pt-site-rules-list')!;
  const siteInput = document.getElementById('pt-site-rules-site-input') as HTMLInputElement;
  const addBtn = document.getElementById('pt-site-rules-add-btn')!;

  /** 已渲染的卡片，按站点复用 —— 保存一张卡片时，其他卡片未保存的改动不丢 */
  const cards = new Map<string, Card>();

  async function render(): Promise<void> {
    const list = await getUserSiteRules();
    const els = list.map((u) => {
      let card = cards.get(u.site);
      if (!card) {
        card = siteCard(u);
        cards.set(u.site, card);
      }
      const text = toText(u.exclude);
      if (card.exclude.value === card.saved) card.exclude.value = text;
      card.saved = text;
      return card.el;
    });
    listEl.replaceChildren(...els);
  }

  function add(): void {
    const site = siteInput.value.trim().toLowerCase();
    saveUserSiteRules(site, {})
      .then(render)
      .then(() => {
        siteInput.value = '';
        cards.get(site)?.exclude.focus();
      })
      .catch((e) => {
        // 不是裸域名（或写入失败）：标红输入框，不新增卡片
        siteInput.classList.add('pt-error');
        console.warn('[PT] 新增站点卡片失败:', e);
      });
  }

  addBtn.addEventListener('click', add);
  siteInput.addEventListener('input', () => siteInput.classList.remove('pt-error'));
  siteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });

  const refresh = () => render().catch((e) => console.error('[PT] 读取站点规则失败:', e));
  refresh();
  // 其他设置页标签页保存后同步刷新
  onUserSiteRulesChanged(refresh);
}
