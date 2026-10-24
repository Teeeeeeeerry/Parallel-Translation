// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 标签页临时选择（#1121，父 #1113）：只对当前标签页这个页面有效的选择，按种类
// 实例化 —— 领域的临时选择（#400、#847）、输入翻译这一次的对方语言（#662、
// #663、#836）。
//
// 规则只写这一份：
// - 值只在各 frame 的内存里，不进后台、不写存储：刷新、跳到别的页面、关闭标签页
//   之后回到自动；
// - 单页应用里换了路径算跳页（path-watch 的口径，只换查询参数或 hash 不算）：主
//   文档把值重置为自动，经后台广播给本标签页全部 frame；
// - 子 frame 启动时经后台向主文档（frameId 0）要当前值；期间已收到广播的，以
//   广播为准；
// - popup 设新值时广播到全部 frame，只有主文档回复。
//
// 跳页重置的拍板理由（#836）：在用户眼里，单页应用里点进另一个帖子就是跳页；
// 临时选择的全部意义就是不悄悄变成长期设置。两种错的代价也不对称：多重置一次
// 只是回到自动判定，那本来就是默认行为；不重置的话，用户在国际站点上选了英文，
// 点进一个日文帖子回复时仍被译成英文。
//
// 消息名由种类生成（tabChoiceMessages），内容脚本、popup 与后台都从这里取。后台
// 的转问与广播是一个按种类通用的转发（tabChoiceForwarder）。

import { watchPathChange } from './path-watch';
import { parseDomainChoice, type DomainChoice } from '~/src/storage/domains';
import { parseInputLangChoice, type InputLangChoice } from './input-target-lang';

/** 一种临时选择：名字（生成消息名）与怎么认出一个合法的值。值的自动态是 { kind: 'auto' }。 */
export interface TabChoiceKind<T extends { kind: string }> {
  name: string;
  parse(v: unknown): T | null;
}

/** 领域的临时选择（#400）：popup 里临时切换领域或选“无领域”。 */
export const DOMAIN_CHOICE: TabChoiceKind<DomainChoice> = { name: 'domain', parse: parseDomainChoice };

/** 输入翻译这一次的对方语言（#662、#663）：popup 里选的，顶替源语言设置这一级。 */
export const INPUT_LANG_CHOICE: TabChoiceKind<InputLangChoice> = { name: 'input-lang', parse: parseInputLangChoice };

/** 一种临时选择用到的消息名。 */
export interface TabChoiceMessages {
  /** popup 设新值、后台广播重置：带 choice，发给本标签页全部 frame */
  set: string;
  /** 问主文档当前值（popup 与后台转问用，只发给 frameId 0） */
  get: string;
  /** 子 frame 启动时问后台，由后台转问主文档 */
  top: string;
  /** 主文档发现跳页，请后台把重置广播给全部 frame */
  navigated: string;
}

export function tabChoiceMessages(name: string): TabChoiceMessages {
  return {
    set: `pt:set-${name}`,
    get: `pt:get-${name}-choice`,
    top: `pt:top-${name}-choice`,
    navigated: `pt:${name}-path-changed`,
  };
}

/** 一种临时选择在本 frame 里的实例：读当前值、设新值。 */
export interface TabChoice<T> {
  /** 当前值（主文档先补判一次路径：浏览器没有 Navigation API 时收不到 pushState） */
  get(): T;
  /** 设新值（本 frame）；之后不再采用启动时问来的旧值 */
  set(next: T): void;
}

type Reply = (response: unknown) => void;
type Message = { type?: unknown; choice?: unknown; [k: string]: unknown };

export interface TabChoicesDeps {
  isMainFrame: boolean;
  /** 发给后台（chrome.runtime.sendMessage） */
  sendMessage: (msg: Message) => Promise<unknown>;
  /** 主文档盯网址用的（path-watch 的依赖）；子 frame 不用 */
  getHref?: () => string;
  navigation?: EventTarget;
  win?: EventTarget;
}

export interface TabChoices {
  /**
   * 定义一种临时选择。answerSet：主文档收到设新值的消息后回复什么，缺省
   * { choice }（领域回复 popup 要显示的领域状态）。
   */
  define<T extends { kind: string }>(
    kind: TabChoiceKind<T>,
    opts?: { answerSet?: (msg: Message) => unknown },
  ): TabChoice<T>;
  /** 内容脚本消息监听里调用：是某种临时选择的消息就处理并返回 true。 */
  handle(msg: unknown, reply: Reply): boolean;
}

interface Entry {
  messages: TabChoiceMessages;
  handle(msg: Message, reply: Reply): void;
  /** 跳页：不是自动就回到自动，并请后台广播 */
  navigated(): void;
}

export function createTabChoices(deps: TabChoicesDeps): TabChoices {
  const entries: Entry[] = [];
  const pathWatch =
    deps.isMainFrame && deps.getHref && deps.win
      ? watchPathChange({
          getHref: deps.getHref,
          navigation: deps.navigation,
          win: deps.win,
          onChange: () => {
            for (const e of entries) e.navigated();
          },
        })
      : null;
  /** 补判一次路径：浏览器没有 Navigation API 时收不到 pushState，读与答之前调用 */
  const check = () => pathWatch?.check();

  return {
    define(kind, opts = {}) {
      const messages = tabChoiceMessages(kind.name);
      type T = NonNullable<ReturnType<typeof kind.parse>>;
      let value = { kind: 'auto' } as T;
      /** 本 frame 已收到过设新值（广播或本地）：不再采用启动时问来的值 */
      let settled = false;
      const set = (next: T) => {
        value = next;
        settled = true;
      };

      entries.push({
        messages,
        handle(msg, reply) {
          if (msg.type === messages.set) {
            const next = kind.parse(msg.choice);
            if (!next) return;
            set(next);
            if (deps.isMainFrame) reply(opts.answerSet ? opts.answerSet(msg) : { choice: value });
            return;
          }
          if (msg.type === messages.get) {
            if (!deps.isMainFrame) return;
            check();
            reply({ choice: value });
          }
        },
        navigated() {
          if (value.kind === 'auto') return;
          value = { kind: 'auto' } as T;
          deps.sendMessage({ type: messages.navigated }).catch(() => {});
        },
      });

      // 切换之后才加载的 frame 向主文档要当前值；期间已收到广播的，以广播为准
      if (!deps.isMainFrame) {
        deps
          .sendMessage({ type: messages.top })
          .then((res) => kind.parse((res as Message | undefined)?.choice))
          .catch(() => null)
          .then((choice) => {
            if (choice && !settled) value = choice;
          });
      }

      return {
        get() {
          check();
          return value;
        },
        set,
      };
    },

    handle(msg, reply) {
      const m = msg as Message | null;
      if (typeof m?.type !== 'string') return false;
      const entry = entries.find((e) => e.messages.set === m.type || e.messages.get === m.type);
      if (!entry) return false;
      entry.handle(m, reply);
      return true;
    },
  };
}

/** 后台的转发用到的标签页能力（chrome.tabs.sendMessage）。 */
export type TabsSend = (tabId: number, msg: Message, opts?: { frameId: number }) => Promise<unknown>;

/**
 * 后台的通用转发（#1121）：按种类把子 frame 的启动询问转给主文档，把主文档报来的
 * 跳页重置广播给本标签页全部 frame（不带 frameId，否则 iframe 收不到；只认主文档
 * 发来的 —— 子 frame 自己的网址变了不算这一页跳页）。返回 onMessage 监听函数。
 */
export function tabChoiceForwarder(
  kinds: readonly TabChoiceKind<{ kind: string }>[],
  tabsSend: TabsSend,
): (msg: unknown, sender: { tab?: { id?: number }; frameId?: number }, reply: Reply) => true | undefined {
  const all = kinds.map((k) => tabChoiceMessages(k.name));
  return (msg, sender, reply) => {
    const type = (msg as Message | null)?.type;
    const tabId = sender.tab?.id;
    if (typeof type !== 'string' || tabId == null) return undefined;
    for (const m of all) {
      if (type === m.top) {
        tabsSend(tabId, { type: m.get }, { frameId: 0 }).then(reply, () => reply(undefined));
        return true;
      }
      if (type === m.navigated) {
        if (sender.frameId !== 0) return undefined;
        tabsSend(tabId, { type: m.set, choice: { kind: 'auto' } }).catch(() => {});
        return undefined;
      }
    }
    return undefined;
  };
}
