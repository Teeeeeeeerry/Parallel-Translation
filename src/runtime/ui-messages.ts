// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 扩展语言的取文表在网页上怎么拿到（#1101）。
//
// 内容脚本 fetch 不到扩展包里的 _locales（没有暴露成 web_accessible_resources，
// 也不该暴露：任何网页都能借此探测扩展是否安装），也不把三份文案打进内容
// 脚本包（ADR-0001：内容脚本体积敏感）。所以向后台要：后台从扩展包里取，
// 原样回给内容脚本。只在选了具体语言时才发，跟随浏览器时一条消息都没有。
// 内容脚本那一侧的载入器与消息名在 i18n 模块（#1123：跟随扩展语言按上下文挑载入
// 路径）。

import {
  UI_LOCALES,
  UI_MESSAGES,
  loadBundledMessages,
  type MessageLoader,
  type MessageTable,
  type UiLocale,
} from '~/src/i18n';

/**
 * 后台取过的表留在实例内存里：每个 frame 启动都要一次，不必每次重新读扩展包。
 * 读失败的不留，下次再试。
 */
const bundled = new Map<UiLocale, Promise<MessageTable>>();
const loadBundledCached: MessageLoader = (locale) => {
  let p = bundled.get(locale);
  if (!p) {
    p = loadBundledMessages(locale);
    bundled.set(locale, p);
    p.catch(() => bundled.delete(locale));
  }
  return p;
};

type UiMessagesReply = { ok: true; table: MessageTable } | { ok: false };

/**
 * 后台应答 pt:ui-messages。不是这条消息返回 undefined（交给别的监听）；
 * 语言不在三种之内或载入失败返回 { ok: false }，内容脚本据此回到跟随浏览器。
 */
export async function answerUiMessages(
  msg: unknown,
  load: MessageLoader = loadBundledCached,
): Promise<UiMessagesReply | undefined> {
  const m = msg as { type?: unknown; locale?: unknown } | null;
  if (m?.type !== UI_MESSAGES) return undefined;
  // 跨进程载荷不做类型假设：只认三种界面语言，别的值不拼进路径
  if (!UI_LOCALES.includes(m.locale as UiLocale)) return { ok: false };
  try {
    return { ok: true, table: await load(m.locale as UiLocale) };
  } catch (e) {
    console.error('[PT] 取扩展语言文案失败:', e);
    return { ok: false };
  }
}
