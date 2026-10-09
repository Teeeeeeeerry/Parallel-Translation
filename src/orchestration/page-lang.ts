// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 这一页是什么语言（#782）—— 纯函数，输入全部显式传入。
//
// 输入翻译与阅读方向共用这一处：两边要的是同一套取数顺序与归一化，只是
// 拿结果去比的对象不同 —— 输入翻译拿它当对方的语言（源语言是 auto 时），
// 阅读方向拿它与目标语言设置比。
//
// 取数顺序（按优先级）：
// 1. 本页翻译时引擎报告的检测语言（#659、#660）
// 2. 页面的语言声明 `<html lang>`（#658）
// 两级都经 normalizeLangCode 归一化：取小写的语言码主段，中文按文字与地区
// 分成 zh-TW / zh-CN，两者不算同语言（#691）。
//
// 检测语言排在声明之前（#660）：大量中文站点把声明写成 en，而引擎是照着
// 真实文字判的。默认引擎 google-web 不返回检测语言，所以这一级对多数用户
// 不生效，等于回落到声明 —— 它是“能用上就更准”，不是前置条件。
//
// 输入翻译判定链的第一级（源语言设置是具体语言码就用它）不在这里：那一级
// 是输入翻译独有的，阅读方向的目标语言来自目标语言设置，语义不同。
//
// 判不出来时返回原因，怎么办由调用方决定：输入翻译不猜（ADR-0005），阅读
// 方向的取舍不同。

import { normalizeLangCode } from './lang-code';

export interface PageLangInput {
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
}

export type PageLang =
  | {
      ok: true;
      /** 归一化后的语言码 */
      lang: string;
      /** 取自哪一级 */
      via: 'detected-lang' | 'page-lang';
    }
  | {
      ok: false;
      /** 两级都给不出语言 */
      reason: 'undetermined';
    };

export function pageLanguage(input: PageLangInput): PageLang {
  const detected = normalizeLangCode(input.detectedLang);
  if (detected) return { ok: true, lang: detected, via: 'detected-lang' };
  const pageLang = normalizeLangCode(input.pageLang);
  if (pageLang) return { ok: true, lang: pageLang, via: 'page-lang' };
  return { ok: false, reason: 'undetermined' };
}
