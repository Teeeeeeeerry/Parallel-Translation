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
// 目前只有最保守的一级：源语言设置。页面语言声明（#658）、本页引擎检测
// 语言（#659、#660）以后作为新的一级加进输入与 via，不改调用方的形状。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格：调用方拿到
// 原因直接渲染提示。

export interface InputTargetInput {
  /** 设置里的源语言：具体语言码，或 'auto' */
  from: string;
}

export type InputTargetDecision =
  | {
      ok: true;
      /** 译成的语言码 */
      lang: string;
      /** 取自判定链的哪一级 */
      via: 'source-setting';
    }
  | {
      ok: false;
      /** 判定链每一级都给不出语言 —— 提示用户去设置里指定源语言 */
      reason: 'undetermined';
    };

export function decideInputTarget(input: InputTargetInput): InputTargetDecision {
  if (input.from && input.from !== 'auto') {
    return { ok: true, lang: input.from, via: 'source-setting' };
  }
  return { ok: false, reason: 'undetermined' };
}
