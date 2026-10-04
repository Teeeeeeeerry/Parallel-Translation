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
// - 页面收到的是一次真实的 `input`（inputType 为 insertText），受控组件的
//   内部状态不与界面脱节
//
// `execCommand` 已被标为过时，但它是目前唯一能进撤销栈的文本插入方式，
// Chrome 与 Firefox 都支持在 textarea 与单行文本框（#650）里执行。
//
// contenteditable（#656）同样不碰 innerHTML。受控编辑器（Slate、Lexical 一类）
// 背后是自己的文档模型，它们拦下 `beforeinput` 改模型、再自己重新渲染；
// 绕过它们直接改 DOM，轻则光标乱跳，重则发出去的是模型里的旧内容或空消息。
// 而 `execCommand` 不派发 `beforeinput`（实测 Chrome 如此），编辑器收不到。
// 所以先全选编辑宿主的内容，派发一次可取消的 `beforeinput`（insertText，
// 目标范围就是全选范围）：
// - 编辑器取消了它 —— 编辑器已经按自己的方式插入，撤销栈也由它管
// - 没人取消 —— 普通 contenteditable，走 `execCommand`，进原生撤销栈

import type { TextInput } from './input-eligibility';

/** 等编辑器把选区同步进模型的上限：Slate 一类在 selectionchange 时才同步。 */
const SELECTION_SETTLE_MS = 100;

/**
 * 整段替换：不论有没有选区，先全选再插入。
 * 返回是否写回成功；浏览器拒绝执行时返回 false，框里内容不动，
 * 调用方改为把译文弹在提示条里。
 */
export async function replaceInputText(el: TextInput, text: string): Promise<boolean> {
  // 插入作用在当前焦点上 —— 点圆点不夺焦点，这里只是兜底
  if (document.activeElement !== el) el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.select();
    return document.execCommand('insertText', false, text);
  }
  return replaceEditableText(el, text);
}

async function replaceEditableText(el: HTMLElement, text: string): Promise<boolean> {
  const selection = document.getSelection();
  if (!selection) return false;
  const all = document.createRange();
  all.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(all);
  await selectionSettled();

  const before = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: text,
    bubbles: true,
    cancelable: true,
    composed: true,
    targetRanges: [new StaticRange(all)],
  });
  if (!el.dispatchEvent(before)) return true;
  return document.execCommand('insertText', false, text);
}

/** 等下一次 selectionchange（编辑器的监听先于这里执行），最多等上限。 */
function selectionSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      document.removeEventListener('selectionchange', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, SELECTION_SETTLE_MS);
    document.addEventListener('selectionchange', done);
  });
}
