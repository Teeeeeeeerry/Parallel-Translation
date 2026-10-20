// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 扩展自身 UI 的国际化入口。
//
// 只覆盖扩展 UI，与译文内容无关。文案统一走 chrome.i18n.getMessage，
// manifest 的 default_locale 决定回退语言。
//
// 静态文案在 HTML 里用 data-i18n 标注，由 applyI18n() 一次性替换；
// 动态生成的文案直接调 t()。两条路径共用同一份 messages.json，
// 不再有“HTML 里写死一份、TS 里再写死一份”的漂移风险。
//
// 读界面语言、取文案一律经这个模块（#1099）：要按界面语言自己挑东西的地方
// （更新提示的条目、列表分隔符）调 uiLocale()，不直接读浏览器界面语言。
// 唯一例外是首装时按浏览器语言推导默认目标语言。
//
// 扩展语言（#1098）：用户选了具体语言时，各上下文启动时先 await loadUiLocale()
// 载入该语言随扩展打包的 messages.json，之后 t() 同步从表里取；“跟随浏览器”
// 时不载入任何东西，t() 仍然直接走 chrome.i18n.getMessage。与站点页面规则
// “启动时先载入、之后同步读”同一种模式（ADR-0004）。

/** 扩展提供了文案的界面语言，与 _locales 目录同名。 */
export type UiLocale = 'zh_CN' | 'zh_TW' | 'en';

export const UI_LOCALES: readonly UiLocale[] = ['en', 'zh_CN', 'zh_TW'];

/** 扩展语言设置：跟随浏览器，或三种界面语言之一。 */
export type UiLocaleChoice = 'browser' | UiLocale;

/** manifest 的 default_locale：所选语言缺 key 时回落到它，与 chrome.i18n 一致。 */
const DEFAULT_LOCALE: UiLocale = 'zh_CN';

/** messages.json 的形状。 */
export type MessageTable = Record<
  string,
  { message: string; placeholders?: Record<string, { content: string }> }
>;

/** 载入某种语言的取文表。缺省从扩展包里取。 */
export type MessageLoader = (locale: UiLocale) => Promise<MessageTable>;

const fetchMessages: MessageLoader = async (locale) => {
  const res = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
  if (!res.ok) throw new Error(`[PT] 载入 ${locale} 文案失败：${res.status}`);
  return (await res.json()) as MessageTable;
};

/** 选了具体语言时的取文表；null 表示跟随浏览器。 */
let active: { locale: UiLocale; own: MessageTable; fallback: MessageTable } | null = null;
/** 只认最后一次 loadUiLocale，较早发起、较晚载完的那次作废。 */
let loadSeq = 0;

/** chrome.i18n 把消息名、占位符名都按小写处理，这里同样小写化。 */
function lowerKeys(table: MessageTable): MessageTable {
  const out: MessageTable = {};
  for (const [key, entry] of Object.entries(table)) {
    const placeholders = entry.placeholders
      ? Object.fromEntries(
          Object.entries(entry.placeholders).map(([name, p]) => [name.toLowerCase(), p]),
        )
      : undefined;
    out[key.toLowerCase()] = { message: entry.message, placeholders };
  }
  return out;
}

/**
 * 选定扩展语言。选了具体语言时载入它和 zh_CN 的取文表，载完之前不该渲染
 * 依赖文案的界面；'browser' 时清掉取文表，回到 chrome.i18n。
 * 载入失败时回到跟随浏览器：界面换不成所选语言，但不会空白。
 */
export async function loadUiLocale(
  choice: UiLocaleChoice,
  load: MessageLoader = fetchMessages,
): Promise<void> {
  const seq = ++loadSeq;
  if (choice === 'browser') {
    active = null;
    return;
  }
  try {
    const [own, fallback] = await Promise.all([
      load(choice),
      choice === DEFAULT_LOCALE ? null : load(DEFAULT_LOCALE),
    ]);
    if (seq !== loadSeq) return;
    const ownTable = lowerKeys(own);
    active = { locale: choice, own: ownTable, fallback: fallback ? lowerKeys(fallback) : ownTable };
  } catch (e) {
    if (seq !== loadSeq) return;
    console.error('[PT] 载入扩展语言失败，改为跟随浏览器:', e);
    active = null;
  }
}

/**
 * 按 chrome.i18n.getMessage 的规则展开一条消息：先把 $NAME$ 换成占位符的
 * content，再把 $1…$9 换成替换值（缺的为空），$$ 是字面的 $。一趟替换，
 * 替换值里的 $1 不会被再展开。
 */
function format(entry: MessageTable[string], subs: string[]): string {
  const expanded = entry.message.replace(
    /\$([A-Za-z0-9_@]+)\$/g,
    (m, name: string) => entry.placeholders?.[name.toLowerCase()]?.content ?? m,
  );
  return expanded.replace(/\$(\$|[1-9])/g, (_, c: string) =>
    c === '$' ? '$' : (subs[Number(c) - 1] ?? ''),
  );
}

/** 繁体地区。zh-SG（新加坡）用简体，不在此列。 */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * 把 BCP-47 的界面语言码映射到有文案的三种语言之一。
 * 大小写不敏感 —— getUILanguage() 各平台的大小写并不统一。
 *
 * 未支持的语言落到 zh_CN：manifest 的 default_locale 是 zh_CN，
 * chrome.i18n 取骨架文案时同样回退到它，两边必须一致，否则日语用户
 * 会看到中文标题配英文条目的混搭。
 */
export function pickLocale(uiLang: string): UiLocale {
  const [lang = '', region = ''] = uiLang.toLowerCase().split('-');
  if (lang === 'zh') {
    return TRADITIONAL_REGIONS.has(region) ? 'zh_TW' : 'zh_CN';
  }
  if (lang === 'en') return 'en';
  return 'zh_CN';
}

/** 当前生效的界面语言：扩展界面文案实际用的是哪一种。 */
export function uiLocale(): UiLocale {
  if (active) return active.locale;
  try {
    return pickLocale(chrome.i18n.getUILanguage());
  } catch {
    // 非扩展上下文（如单元测试）
    return pickLocale('');
  }
}

/**
 * 取文案。取不到时返回 fallback（通常是 HTML 里已有的中文），
 * 保证漏配 key 时页面只是没被翻译，而不是显示空白。
 */
export function t(key: string, ...subs: string[]): string {
  if (active) {
    const k = key.toLowerCase();
    const entry = active.own[k] ?? active.fallback[k];
    return entry ? format(entry, subs) : '';
  }
  try {
    const msg = chrome.i18n.getMessage(key, subs);
    if (msg) return msg;
  } catch {
    // 非扩展上下文（如单元测试）走 fallback
  }
  return '';
}

/** 取文案，取不到时用 fallback 顶上 */
export function tf(key: string, fallback: string, ...subs: string[]): string {
  return t(key, ...subs) || fallback;
}

/**
 * 把 DOM 中的 data-i18n / data-i18n-placeholder / data-i18n-title
 * 批量替换为当前语言的文案。取不到 key 时保留 HTML 里的原文。
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n!);
    if (msg) el.textContent = msg;
  });

  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '[data-i18n-placeholder]',
    )
    .forEach((el) => {
      const msg = t(el.dataset.i18nPlaceholder!);
      if (msg) el.placeholder = msg;
    });

  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const msg = t(el.dataset.i18nTitle!);
    if (msg) el.title = msg;
  });
}
