// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译：译文回来时能不能写回（#646）—— 纯函数，输入全部显式传入。
//
// 送翻到译文回来之间，用户可能又打了字、删了字，或者把焦点换到了另一个
// 输入框。这时整段替换会吞掉用户刚打的字，而那是不可逆的损失；译文已经
// 花了配额，丢掉也浪费。所以放弃写回，调用方把译文弹在提示条里让用户自取。
//
// #654：译文比框的长度上限（maxlength）长时同样不写回。写回走浏览器原生
// 插入，超出上限的部分会被静默截掉，用户可能把半句话发出去 —— 比不翻更糟
// （ADR-0005：宁可不猜，也不要让用户把一段不对的文字发出去）。所以在写回
// 之前比对，不在插入之后检查。长度按浏览器的口径数 UTF-16 码元。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格。

export interface WriteBackInput {
  /** 送翻时框里的文字 */
  snapshot: string;
  /** 译文回来时框里的文字 */
  current: string;
  /** 译文回来时焦点是否还在这个框里 */
  focused: boolean;
  /** 要写回的译文 */
  translation: string;
  /** 框的长度上限；没有上限（含 contenteditable）时为 null */
  maxLength: number | null;
}

export type WriteBackDecision =
  | { write: true }
  | { write: false; reason: 'text-changed' | 'focus-moved' | 'too-long' };

export function decideWriteBack(input: WriteBackInput): WriteBackDecision {
  if (input.current !== input.snapshot) return { write: false, reason: 'text-changed' };
  if (!input.focused) return { write: false, reason: 'focus-moved' };
  if (input.maxLength !== null && input.translation.length > input.maxLength) {
    return { write: false, reason: 'too-long' };
  }
  return { write: true };
}
