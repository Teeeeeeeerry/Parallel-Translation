// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译：输入超长时拒绝（#643）—— 纯函数，输入全部显式传入。
//
// 上限与阅读侧单个翻译单元同一个常量口径（MAX_TEXT），计数方式也相同：
// 去掉首尾空白后的长度。超了不发请求、提示用户删减，不分段翻译后拼接 ——
// 读的时候切段无妨，发给别人的文字不能有接缝（#633 不在范围内一节）。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格。

import { MAX_TEXT } from '../dom/classify';

export type InputLengthDecision =
  | { ok: true }
  | {
      ok: false;
      /** 超过阅读侧单个翻译单元的上限 —— 不发请求，提示用户删减 */
      reason: 'too-long';
      /** 上限（字符数），调用方渲染提示用 */
      limit: number;
    };

export function decideInputLength(text: string): InputLengthDecision {
  if (text.trim().length > MAX_TEXT) return { ok: false, reason: 'too-long', limit: MAX_TEXT };
  return { ok: true };
}
