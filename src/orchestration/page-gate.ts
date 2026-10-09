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
  if (page.ok && page.lang === normalizeLangCode(input.to)) {
    return { translate: false, reason: 'same-language', lang: page.lang };
  }
  return { translate: true };
}
