// 更新提示弹窗的渲染。
//
// 由 content.ts 经动态 import() 引入 —— 该形式在 MV3 下并不会真的分包，
// 代价与理由见 ADR-0001，别误以为这段代码不占 content.js 的体积。

import { mountIsolated, unmountIsolated } from '~/src/ui/mount';
import { tf } from '~/src/i18n';
import modalCss from './modal.css?inline';
import { pickLocale } from './locale';
import {
  GROUP_ORDER,
  type ChangeGroup,
  type ChangeType,
  type ChangelogEntry,
  type LocaleId,
} from './data';

const MOUNT_ID = 'changelog';

/** 分组标题的 i18n key 与兜底文案（漏配 key 时不至于显示空白）。 */
const GROUP_LABEL: Record<ChangeType, { key: string; fallback: string }> = {
  feature: { key: 'changelogGroupFeature', fallback: '新功能' },
  improve: { key: 'changelogGroupImprove', fallback: '改进' },
  fix: { key: 'changelogGroupFix', fallback: '修复' },
};

/**
 * 标题与描述之间的分隔符。中文用全角冒号，英文用破折号 ——
 * 「Side-by-side reading：The original…」这种中文标点配英文的混搭很刺眼。
 */
const TITLE_SEP: Record<LocaleId, string> = {
  zh_CN: '：',
  zh_TW: '：',
  en: ' — ',
};

/** GitHub mark，16×16，fill 取 currentColor。 */
const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

interface FooterLink {
  url: string;
  /** 内联 SVG（模块内常量，非外部输入） */
  icon: string;
  i18nKey: string;
  fallback: string;
}

/**
 * 底部链接。本版只放大 GitHub 求 star，赞赏与文档按钮暂不启用 ——
 * 注释掉的是数据而不是渲染逻辑：渲染照常遍历此数组、照常过类型检查，
 * 日后取消注释一行即可生效，仓库里不留一行会腐烂的死代码。
 */
const FOOTER_LINKS: FooterLink[] = [
  {
    url: 'https://github.com/Teeeeeeeerry/Parallel-Translation',
    icon: GITHUB_ICON,
    i18nKey: 'changelogGithub',
    fallback: '在 GitHub 上 Star',
  },
  // 日后启用（需先补 _locales 文案与图标常量）：
  // { url: '<赞赏页>', icon: HEART_ICON, i18nKey: 'changelogSponsor', fallback: '赞赏' },
  // { url: '<文档站>', icon: BOOK_ICON,  i18nKey: 'changelogDocs',    fallback: '使用文档' },
];

interface SocialLink {
  label: string;
  url: string;
}

/** 社交账号。留空则整块不渲染；账号建好后往这里填即可生效。 */
const SOCIAL_LINKS: SocialLink[] = [];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** 按 GROUP_ORDER 排序，并丢掉空分组。 */
function orderedGroups(entry: ChangelogEntry): ChangeGroup[] {
  return GROUP_ORDER.map((type) =>
    entry.groups.find((g) => g.type === type),
  ).filter((g): g is ChangeGroup => !!g && g.items.length > 0);
}

function renderGroup(group: ChangeGroup, locale: LocaleId): HTMLElement {
  const section = el('section', 'pt-changelog-group');
  const label = GROUP_LABEL[group.type];
  section.appendChild(
    el('h3', 'pt-changelog-group-title', tf(label.key, label.fallback)),
  );

  const list = el('ul', 'pt-changelog-items');
  for (const item of group.items) {
    const li = document.createElement('li');
    li.appendChild(el('span', 'pt-changelog-item-title', item.title[locale]));
    // 文案是我们自己的数据，但仍走 textContent —— content script 注入的是
    // 宿主页面，不给 innerHTML 留任何口子
    li.appendChild(
      el(
        'span',
        'pt-changelog-item-desc',
        `${TITLE_SEP[locale]}${item.desc[locale]}`,
      ),
    );
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function renderSocial(): HTMLElement | null {
  if (SOCIAL_LINKS.length === 0) return null;
  const box = el('div', 'pt-changelog-social');
  box.appendChild(
    el(
      'p',
      'pt-changelog-social-desc',
      tf('changelogSocialDesc', '获取最新更新，欢迎关注：'),
    ),
  );
  const links = el('div', 'pt-changelog-social-links');
  for (const s of SOCIAL_LINKS) {
    const a = el('a', 'pt-changelog-social-link', s.label);
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.appendChild(a);
  }
  box.appendChild(links);
  return box;
}

/**
 * 显示更新提示。重复调用幂等（已挂载则直接返回）——
 * content script 每帧只该有一个弹窗。
 */
export function showChangelog(entry: ChangelogEntry): void {
  if (document.getElementById(`pt-host-${MOUNT_ID}`)) return;

  const locale = pickLocale(chrome.i18n.getUILanguage());
  // 全屏遮罩，覆盖 mountIsolated 默认的右下角定位
  const shadow = mountIsolated(MOUNT_ID, { positionCss: 'inset: 0;' });

  const style = document.createElement('style');
  style.textContent = modalCss;
  shadow.appendChild(style);

  const overlay = el('div', 'pt-changelog-overlay');
  const card = el('div', 'pt-changelog-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  // ── 头部 ──
  const head = el('div', 'pt-changelog-head');
  const title = el('h2', 'pt-changelog-title', tf('changelogTitle', '更新内容'));
  head.appendChild(title);
  head.appendChild(el('span', 'pt-changelog-version', `v${entry.version}`));

  const closeBtn = el('button', 'pt-changelog-close', '×');
  closeBtn.setAttribute('aria-label', tf('changelogClose', '关闭'));
  head.appendChild(closeBtn);
  card.appendChild(head);

  // ── 正文 ──
  const body = el('div', 'pt-changelog-body');
  for (const group of orderedGroups(entry)) {
    body.appendChild(renderGroup(group, locale));
  }
  card.appendChild(body);

  const social = renderSocial();
  if (social) card.appendChild(social);

  // ── 底部 ──
  const foot = el('div', 'pt-changelog-foot');
  for (const link of FOOTER_LINKS) {
    const a = el('a', 'pt-changelog-link');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const icon = document.createElement('span');
    // 模块内的常量 SVG,不含任何外部数据
    icon.innerHTML = link.icon;
    a.appendChild(icon);
    a.appendChild(document.createTextNode(tf(link.i18nKey, link.fallback)));
    foot.appendChild(a);
  }
  const okBtn = el('button', 'pt-changelog-ok', tf('changelogOk', '知道了'));
  foot.appendChild(okBtn);
  card.appendChild(foot);

  overlay.appendChild(card);
  shadow.appendChild(overlay);

  // ── 关闭：X / 知道了 / 点遮罩 / Esc ──
  function close(): void {
    document.removeEventListener('keydown', onKeydown, true);
    unmountIsolated(MOUNT_ID);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  closeBtn.addEventListener('click', close);
  okBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  // capture 阶段监听 —— 宿主页面可能在冒泡阶段吞掉 Esc
  document.addEventListener('keydown', onKeydown, true);

  okBtn.focus();
}
