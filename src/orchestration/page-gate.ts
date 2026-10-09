// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 页面级判定（#777）：整页翻译开始前先问一句这一页是什么语言，与目标语言
// 相同就不翻 —— 一个请求都不发，配额一点不花，页面一个字不动。纯函数，输入
// 全部显式传入：页面语言声明与检测语言由调用方取好传进来，无 DOM、无网络、
// 无存储。
//
// 只管整页翻译。逐段与划词是用户点名要翻的一段，在中文页面上划中一段英文
// 引文单独翻译完全合理，它们靠渲染层的单元级兜底（#783）各自判断。
//
// 取数与归一化走 pageLanguage（#782），不另写一套；目标语言设置用同一个
// normalizeLangCode 归一化后比对。
//
// #791：检测语言优先于页面的语言声明 —— 大量中文站点把声明写成 en，而引擎
// 是照着真实文字判的。检测语言是从翻译响应里攒出来的，第一次点整页翻译时
// 一定还没有，这时只看声明；它是“能用上就更准”，不是前置条件。不要为了
// 拿到它先发一个探测请求，那就违背了命中时一个请求都不发。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts、input-target-lang.ts 同一
// 风格：调用方拿到原因直接渲染提示。

import { normalizeLangCode } from './lang-code';
import { pageLanguage } from './page-lang';

export interface PageGateInput {
  /** 目标语言设置 */
  to: string;
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
}

export type PageGateDecision =
  | { translate: true }
  | {
      translate: false;
      /** 这一页本来就是目标语言 */
      reason: 'same-language';
      /** 判出的页面语言（归一化后） */
      lang: string;
    };

export function decidePageGate(input: PageGateInput): PageGateDecision {
  const page = pageLanguage(input);
  // #789：判不出页面语言就放行，照常翻译。这与输入翻译那边相反，是有意的，
  // 不是漏改：
  // - 输入翻译判不出对方的语言时宁可不猜（ADR-0005）：猜错是把一段不对的
  //   文字发给别人，而发送不可撤回
  // - 阅读方向猜错只是多翻一遍本来不用翻的内容，单元级兜底（#783）还会
  //   拦下原样还回来的段落；拦错的代价却是用户想翻的页面翻不了
  // 两边代价不对称，取舍也就相反。不要改成“判不出就不翻”
  if (!page.ok) return { translate: true };
  // #790：繁简不算同语言 —— normalizeLangCode 把中文按文字与地区分成 zh-TW
  // 与 zh-CN（#691），繁体页面对简体目标是真的要翻。直接比归一化后的码，
  // 不另写中文的比较
  if (page.lang === normalizeLangCode(input.to)) {
    return { translate: false, reason: 'same-language', lang: page.lang };
  }
  return { translate: true };
}
