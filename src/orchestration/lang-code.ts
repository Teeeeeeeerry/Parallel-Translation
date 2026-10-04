// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 语言码归一化 —— 页面的语言声明（#658）与引擎报告的检测语言（#659）
// 共用一份。各处写法不一：页面写 `en-US` / `en_GB`，bing-edge 给 `en`、
// `zh-Hans`，deepl 给 `EN`。统一取小写的语言码主段。

/** 语言标签的形状：2 到 3 个字母的主段，后面可跟若干以 - 或 _ 隔开的子段。 */
const LANG_TAG = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i;

/** 合法但不指具体语言的主段：未定、多语、非语言内容、未编码。 */
const NOT_A_LANGUAGE = new Set(['und', 'mul', 'zxx', 'mis']);

/** 小写的语言码主段；缺失、为空、畸形或不指具体语言时为 null。 */
export function normalizeLangCode(tag: string | null | undefined): string | null {
  const m = LANG_TAG.exec(tag?.trim() ?? '');
  if (!m) return null;
  const primary = m[1]!.toLowerCase();
  return NOT_A_LANGUAGE.has(primary) ? null : primary;
}
