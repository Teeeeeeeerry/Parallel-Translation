// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 语言码归一化 —— 页面的语言声明（#658）与引擎报告的检测语言（#659）
// 共用一份。各处写法不一：页面写 `en-US` / `en_GB`，bing-edge 给 `en`、
// `zh-Hans`，deepl 给 `EN`。统一取小写的语言码主段。
//
// 中文例外（#691）：主段 zh 丢掉了简繁，而各引擎把 zh 当简体，繁体站点上
// 写的内容会被译成简体发出去（ADR-0005：宁可不猜，也不要让用户把一段不对
// 的文字发出去）。中文按文字与地区归到设置里源语言的同一套码：文字子段
// Hant / Hans 优先，没有文字子段时看地区 TW / HK / MO，其余一律 zh-CN。
// 其余语言（如 pt-BR / pt-PT）仍取主段，那是另一个话题。

/** 语言标签的形状：2 到 3 个字母的主段，后面可跟若干以 - 或 _ 隔开的子段。 */
const LANG_TAG = /^([a-z]{2,3})((?:[-_][a-z0-9]{1,8})*)$/i;

/** 用繁体字的中文地区。 */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/** 合法但不指具体语言的主段：未定、多语、非语言内容、未编码。 */
const NOT_A_LANGUAGE = new Set(['und', 'mul', 'zxx', 'mis']);

/** 小写的语言码主段（中文为 zh-TW / zh-CN）；缺失、为空、畸形或不指具体语言时为 null。 */
export function normalizeLangCode(tag: string | null | undefined): string | null {
  const m = LANG_TAG.exec(tag?.trim() ?? '');
  if (!m) return null;
  const primary = m[1]!.toLowerCase();
  if (NOT_A_LANGUAGE.has(primary)) return null;
  return primary === 'zh' ? chineseVariant(m[2]!) : primary;
}

/** 中文的子段（如 `-Hant-TW`）归到 zh-TW 或 zh-CN。 */
function chineseVariant(subtags: string): 'zh-TW' | 'zh-CN' {
  const parts = subtags.toLowerCase().split(/[-_]/).filter(Boolean);
  if (parts.includes('hant')) return 'zh-TW';
  if (parts.includes('hans')) return 'zh-CN';
  return parts.some((p) => TRADITIONAL_REGIONS.has(p)) ? 'zh-TW' : 'zh-CN';
}
