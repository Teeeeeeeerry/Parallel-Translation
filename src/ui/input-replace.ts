// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译的写回（#644）—— 用译文整段替换输入框里的全部文字。
//
// 这是扩展第一次往用户自己写的文字上动手，所以写回必须走浏览器原生的
// 文本插入路径（`execCommand('insertText')`），不直接赋值 `value`：
// - 原生撤销栈保得住，Ctrl / Cmd+Z 能把原文撤回来（#645）
// - 页面收到的是一次真实的 `beforeinput` / `input`（inputType 为
//   insertText），受控组件的内部状态不与界面脱节
//
// `execCommand` 已被标为过时，但它是目前唯一能进撤销栈的文本插入方式，
// Chrome 与 Firefox 都支持在 textarea 与单行文本框（#650）里执行。

import type { TextInput } from './input-eligibility';

/**
 * 整段替换：不论有没有选区，先全选再插入。
 * 返回是否写回成功；浏览器拒绝执行时返回 false，框里内容不动，
 * 调用方改为把译文弹在提示条里。
 */
export function replaceInputText(el: TextInput, text: string): boolean {
  // 插入作用在当前焦点上 —— 点圆点不夺焦点，这里只是兜底
  if (document.activeElement !== el) el.focus();
  el.select();
  return document.execCommand('insertText', false, text);
}
