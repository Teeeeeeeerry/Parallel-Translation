// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译：译成哪种语言（#640）—— 纯函数，输入全部显式传入。
//
// ADR-0005：输入翻译的目标语言取设置里的源语言，也就是对方的语言。源语言
// 是 auto 时按一条判定链往下找；链上每一级都找不到就不猜 —— 猜错的代价是
// 用户把一段日文发进了英文频道，而发送不可撤回。
//
// 判定链（按优先级）：
// 1. 源语言设置是具体语言码 —— 用它（#640）
// 2. 页面的语言声明 `<html lang>` 可识别 —— 取语言码主段（#658）
// 3. 都没有 —— 判不出来，提示用户去设置里指定源语言
//
// 本页引擎检测语言（#659、#660）以后作为新的一级加进输入与 via，不改
// 调用方的形状。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格：调用方拿到
// 原因直接渲染提示。

export interface InputTargetInput {
  /** 设置里的源语言：具体语言码，或 'auto' */
  from: string;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
}

export type InputTargetDecision =
  | {
      ok: true;
      /** 译成的语言码 */
      lang: string;
      /** 取自判定链的哪一级 */
      via: 'source-setting' | 'page-lang';
    }
  | {
      ok: false;
      /** 判定链每一级都给不出语言 —— 提示用户去设置里指定源语言 */
      reason: 'undetermined';
    };

/** 语言标签的形状：2 到 3 个字母的主段，后面可跟若干以 - 或 _ 隔开的子段。 */
const LANG_TAG = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i;

/** 合法但不指具体语言的主段：未定、多语、非语言内容、未编码。 */
const NOT_A_LANGUAGE = new Set(['und', 'mul', 'zxx', 'mis']);

/** 语言声明的语言码主段；缺失、为空、畸形或不指具体语言时为 null。 */
function primaryLang(tag: string | null): string | null {
  const m = LANG_TAG.exec(tag?.trim() ?? '');
  if (!m) return null;
  const primary = m[1]!.toLowerCase();
  return NOT_A_LANGUAGE.has(primary) ? null : primary;
}

export function decideInputTarget(input: InputTargetInput): InputTargetDecision {
  if (input.from && input.from !== 'auto') {
    return { ok: true, lang: input.from, via: 'source-setting' };
  }
  const pageLang = primaryLang(input.pageLang);
  if (pageLang) return { ok: true, lang: pageLang, via: 'page-lang' };
  return { ok: false, reason: 'undetermined' };
}
