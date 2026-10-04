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
// 2. 本页翻译时引擎报告的检测语言 —— 用它（#659、#660）
// 3. 页面的语言声明 `<html lang>` 可识别 —— 取语言码主段（#658）；中文
//    按文字与地区分成 zh-TW / zh-CN，与源语言设置同一套码（#691）
// 4. 都没有 —— 判不出来，提示用户去设置里指定源语言
//
// 检测语言排在声明之前（#660）：大量中文站点把声明写成 en，而引擎是照着
// 真实文字判的。默认引擎 google-web 不返回检测语言，所以这一级对多数用户
// 不生效，等于回落到声明 —— 它是“能用上就更准”，不是前置条件。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格：调用方拿到
// 原因直接渲染提示。

import { normalizeLangCode } from '../orchestration/lang-code';

export interface InputTargetInput {
  /** 设置里的源语言：具体语言码，或 'auto' */
  from: string;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
}

export type InputTargetDecision =
  | {
      ok: true;
      /** 译成的语言码 */
      lang: string;
      /** 取自判定链的哪一级 */
      via: 'source-setting' | 'detected-lang' | 'page-lang';
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
  const detected = normalizeLangCode(input.detectedLang);
  if (detected) return { ok: true, lang: detected, via: 'detected-lang' };
  const pageLang = normalizeLangCode(input.pageLang);
  if (pageLang) return { ok: true, lang: pageLang, via: 'page-lang' };
  return { ok: false, reason: 'undetermined' };
}
