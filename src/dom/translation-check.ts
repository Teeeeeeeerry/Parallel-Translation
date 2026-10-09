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
 * 译文能不能用。归一化沿用取文本处的 normalizeText（空白折叠、去首尾
 * 空白），不另写一套。
 */
export function checkTranslation(source: string, translation: string): TranslationCheck {
  if (normalizeText(source) === normalizeText(translation)) {
    return { ok: false, reason: 'same-as-source' };
  }
  return { ok: true };
}
