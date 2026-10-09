// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 译文与原文比对（#783）—— 纯函数，原文与译文显式传入。
//
// 引擎把文字原样还回来（本来就是目标语言的页面、混合语言页面里的
// 目标语言段落）时，这份“译文”插进页面只会让每行重复一遍，紧凑的
// 标签区两层文字叠在一起。渲染层与划词翻译共用这一处判定：划词不走
// 渲染层，它把译文弹在提示里，判定若写在渲染层内部就得再写一遍。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格。

import { normalizeText } from './normalize';

export type TranslationCheck =
  | { ok: true }
  | {
      ok: false;
      /** 译文与原文归一化后相同 */
      reason: 'same-as-source';
    };

/**
 * 译文能不能用。比对口径：首尾空白、空白折叠、大小写都不算差异（#784）——
 * 引擎常常把文字原样还回来，只多一个首尾空格或把首字母大写了，这样的
 * “译文”插进去只会让人看两遍一样的话。空白沿用取文本处的 normalizeText，
 * 不另写一套；大小写在它之上折叠。
 */
export function checkTranslation(source: string, translation: string): TranslationCheck {
  if (fold(source) === fold(translation)) {
    return { ok: false, reason: 'same-as-source' };
  }
  return { ok: true };
}

/**
 * 大小写折叠用 toLowerCase 而不是 toLocaleLowerCase。toLocaleLowerCase 按
 * 运行环境的语言折叠，而运行环境的语言是用户浏览器的界面语言，与这段文字
 * 是什么语言无关：界面是土耳其语时 'I' 折成无点的 'ı'，英文的 INFO 与 info
 * 就比不上了，同一段文字在不同用户那里结论不同。toLowerCase 用 Unicode 的
 * 默认映射，与环境无关、结论确定。它在土耳其语文字上的偏差（'İ' 折成 i 加
 * 组合附加点，'I' 折成 i 而不是 'ı'）只会让本该相同的两段比不上，结果是照常
 * 插入译文、退回兜底之前的行为，不会把真有差异的译文错拦下来。
 */
function fold(s: string): string {
  return normalizeText(s).toLowerCase();
}
