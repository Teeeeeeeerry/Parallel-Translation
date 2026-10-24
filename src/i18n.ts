// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — 扩展自身 UI 的国际化入口。
//
// 只覆盖扩展 UI，与译文内容无关。t() 取文有两条路径：
// - 跟随浏览器（缺省）：走 chrome.i18n.getMessage，manifest 的 default_locale
//   决定回退语言；
// - 选了具体扩展语言（#1098）：从载入的取文表里取，缺 key 回落到 zh_CN 的表。
//
// 静态文案在 HTML 里用 data-i18n 标注，由 applyI18n() 一次性替换；
// 动态生成的文案直接调 t()。两条路径共用同一份 messages.json，
// 不再有“HTML 里写死一份、TS 里再写死一份”的漂移风险。
//
// 读界面语言、取文案一律经这个模块（#1099）：要按界面语言自己挑东西的地方
// （更新提示的条目、列表分隔符）调 uiLocale()，不直接读浏览器界面语言。
// 唯一例外是首装时按浏览器语言推导默认目标语言。
//
// 扩展语言（#1098）：用户选了具体语言时，各上下文启动时先载入该语言随扩展打包
// 的 messages.json，之后 t() 同步从表里取；“跟随浏览器”时不载入任何东西。与站点
// 页面规则“启动时先载入、之后同步读”同一种模式（ADR-0004）。
// - 内容脚本与后台调 followUiLocale(设置订阅)（#1123）：首次按当前设置载入，之后
//   随设置变化换表；载入路径按上下文定（扩展页与后台直接读扩展包，内容脚本向
//   后台要），去重、失败退避重试、作废较早的载入都在里面；
// - popup、欢迎页每次打开时 await loadUiLocale() 载入一次；设置页在语言变了时
//   整页重新载入。

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

/** 从扩展包里取。扩展页面与后台可用；内容脚本取不到，改向后台要（loadMessagesViaBackground）。 */
export const loadBundledMessages: MessageLoader = async (locale) => {
  const res = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
  if (!res.ok) throw new Error(`[PT] 载入 ${locale} 文案失败：${res.status}`);
  return (await res.json()) as MessageTable;
};

/** 内容脚本向后台要取文表的消息（#1101），后台的应答见 runtime/ui-messages.ts。 */
export const UI_MESSAGES = 'pt:ui-messages';

/** 内容脚本的载入器：向后台要所选语言的取文表（#1101）。 */
export const loadMessagesViaBackground: MessageLoader = async (locale) => {
  const reply = (await chrome.runtime.sendMessage({ type: UI_MESSAGES, locale })) as
    | { ok: true; table: MessageTable }
    | { ok: false }
    | undefined;
  if (!reply?.ok) throw new Error(`[PT] 后台没有给出 ${locale} 文案`);
  return reply.table;
};

/**
 * 按所在上下文挑载入路径（#1123）：扩展自己的页面与后台（chrome-extension: /
 * moz-extension: 下）直接读扩展包；内容脚本运行在网页的网址下，fetch 不到扩展包
 * 里的 _locales，向后台要。
 */
function contextLoader(): MessageLoader {
  const protocol = (globalThis as { location?: { protocol?: string } }).location?.protocol ?? '';
  return /^(chrome|moz)-extension:$/.test(protocol) ? loadBundledMessages : loadMessagesViaBackground;
}

/** 选了具体语言时的取文表；null 表示跟随浏览器。 */
let active: { locale: UiLocale; own: MessageTable; fallback: MessageTable } | null = null;
/** 只认最后一次 loadUiLocale，较早发起、较晚载完的那次作废。 */
let loadSeq = 0;
/** 扩展语言换好之后要重新取文的常驻元素（悬浮球、输入翻译圆点的可读名称）。 */
const changeListeners = new Set<() => void>();

/**
 * 订阅扩展语言的变化：每次 loadUiLocale 落定（含回到跟随浏览器、载入失败
 * 回落）之后调用。常驻在网页上的元素靠它换掉可读名称；随用随建的界面
 * （提示条、逐段翻译按钮的文案）出现时自己取文，不必订阅。返回退订函数。
 */
export function onUiLocaleChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function settle(next: typeof active): void {
  active = next;
  for (const fn of changeListeners) {
    // 一个订阅者出错不连累别的订阅者，也不让这次载入被当成失败
    try {
      fn();
    } catch (e) {
      console.error('[PT] 扩展语言变化的订阅者出错:', e);
    }
  }
}

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
 * 返回这次选择是否生效：载入失败、或被之后的选择取代时为 false。
 */
export async function loadUiLocale(
  choice: UiLocaleChoice,
  load: MessageLoader = loadBundledMessages,
): Promise<boolean> {
  const seq = ++loadSeq;
  // 只认三种界面语言；别的值（设置之外传进来的脏值）一律按跟随浏览器，不去拼路径取表
  if (!UI_LOCALES.includes(choice as UiLocale)) {
    settle(null);
    return true;
  }
  const locale = choice as UiLocale;
  let tables: [MessageTable, MessageTable | null];
  try {
    tables = await Promise.all([
      load(locale),
      locale === DEFAULT_LOCALE ? null : load(DEFAULT_LOCALE),
    ]);
  } catch (e) {
    if (seq !== loadSeq) return false;
    console.error('[PT] 载入扩展语言失败，改为跟随浏览器:', e);
    settle(null);
    return false;
  }
  if (seq !== loadSeq) return false;
  const own = lowerKeys(tables[0]);
  settle({ locale, own, fallback: tables[1] ? lowerKeys(tables[1]) : own });
  return true;
}

/** 取表失败后的重试等待（毫秒，#1123）：后台重启一般一两秒就回来，等满这几次就停。 */
const FOLLOW_RETRY_MS = [500, 1000, 2000, 4000, 8000] as const;

export interface FollowUiLocaleOptions {
  /**
   * 当前的扩展语言设置；可以是还没读到的设置（后台启动时），订阅照样立即挂上，
   * 读到之前推来的选择优先
   */
  initial: UiLocaleChoice | PromiseLike<UiLocaleChoice>;
  /** 订阅扩展语言设置的变化（设置里别的项变了也可以推，同一种语言不重复载入）；返回退订函数 */
  subscribe: (fn: (choice: UiLocaleChoice) => void) => () => void;
  /** 取表函数；缺省按所在上下文挑（扩展页与后台读扩展包，内容脚本向后台要） */
  load?: MessageLoader;
  /** 重试之间的等待；缺省 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 每次选择落定之后调用（含回到跟随浏览器、载入失败回落）—— 后台据此更新右键菜单标题 */
  onApplied?: () => void;
}

export interface UiLocaleFollower {
  /** 首次载入的结果：载入成功或跟随浏览器为 true；取表失败（重试还在后台继续）为 false */
  ready: Promise<boolean>;
  /** 不再跟随（内容脚本失效时） */
  stop(): void;
}

/**
 * 跟随扩展语言（#1123）：首次按当前设置载入，之后随设置变化换表。之后新出现的
 * 界面用新语言；已经显示的提示条不重绘，常驻元素经 onUiLocaleChange 自己更新。
 * - 同一种语言不重复载入；
 * - 取表失败先回到跟随浏览器（界面不会空白），按退避重试，换上所选语言为止；
 *   重试有上限，用尽后同一个选择再推来时重新试；
 * - 新的选择到达后，较早那次的载入与重试作废。
 */
export function followUiLocale(opts: FollowUiLocaleOptions): UiLocaleFollower {
  const load = opts.load ?? contextLoader();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** 正在跟随的选择；较早的选择据此判断自己作废了 */
  let wanted: UiLocaleChoice | null = null;
  let stopped = false;

  /** onFirst：第一次尝试的结果（之后的重试不等） */
  const apply = async (choice: UiLocaleChoice, onFirst?: (ok: boolean) => void): Promise<void> => {
    wanted = choice;
    const current = () => !stopped && wanted === choice;
    for (let attempt = 0; ; attempt++) {
      let ok: boolean;
      try {
        ok = await loadUiLocale(choice, load);
      } catch (e) {
        // 取文表形状不对之类的意外：按失败处理，ready 不至于一直不落定
        console.error('[PT] 载入扩展语言出错:', e);
        ok = false;
      }
      if (attempt === 0) onFirst?.(ok && current());
      if (!current()) return;
      opts.onApplied?.();
      if (ok) return;
      if (attempt >= FOLLOW_RETRY_MS.length) {
        // 重试用尽：忘掉这次选择，之后同一个选择再推来（设置里别的项变了）时重新试
        wanted = null;
        return;
      }
      await sleep(FOLLOW_RETRY_MS[attempt]!);
      if (!current()) return;
    }
  };

  /** 订阅已推来过选择：读到的初始设置已经过时 */
  let pushed = false;
  const unsubscribe = opts.subscribe((choice) => {
    pushed = true;
    if (stopped || choice === wanted) return;
    void apply(choice);
  });
  // 首次载入失败时 ready 先报 false（调用方不必等重试），重试在后台继续
  const ready = Promise.resolve(opts.initial).then(
    (choice) =>
      pushed || stopped ? true : new Promise<boolean>((resolve) => void apply(choice, resolve)),
    (e) => {
      console.error('[PT] 读取扩展语言设置失败:', e);
      return false;
    },
  );
  return {
    ready,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
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
