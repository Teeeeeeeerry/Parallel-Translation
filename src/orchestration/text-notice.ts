// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 逐段翻译与划词翻译拿到译文之后弹哪条提示 —— 输入全部显式传入，从
// content script 的副作用里摘出来单测。

import type { RenderResult } from '../dom/renderer';
import { checkTranslation } from '../dom/translation-check';
import type { ToastOptions } from '../ui/toast';
import { tf } from '../i18n';

/** 提示的文字与选项，原样交给 toast()。 */
export interface TextNotice extends ToastOptions {
  message: string;
}

/**
 * 逐段翻译渲染之后的提示；插入了译文时不需要提示。
 *
 * 原因直接取 render 的返回值，不在这里再比一次。
 */
export function paraNotice(result: RenderResult): TextNotice | null {
  if (result.rendered) return null;
  // #786：逐段翻译是单段操作，点了按钮页面一个字不变的话用户只会以为没点中、
  // 再点一次。说明这一段已经是目标语言；它是状态不是内容，走状态类
  if (result.reason === 'same-as-source') {
    return {
      message: tf('toastParaSameAsSource', '这一段已经是目标语言'),
      purpose: 'status',
      kind: 'info',
    };
  }
  // render() 在含媒体 / 交互控件时会拒绝渲染（#22），此时告知用户
  // 而非静默吞掉元素
  return {
    message: tf('toastNotTranslatable', '该区域无法单独翻译'),
    purpose: 'status',
    kind: 'error',
  };
}

/**
 * 划词翻译拿到译文之后的提示。划词不走渲染层，与渲染层共用同一个比对
 * 纯函数（#783），不另写一份。
 */
export function selectionNotice(source: string, translation: string): TextNotice {
  // #787：译文与原文相同时不把它弹出来 —— 用户会以为扩展把原文当译文给了他。
  // 说明这段已经是目标语言，它是状态不是内容，走状态类；等待态就地换成这条，
  // 与译文到达时同一条替换路径（#747），不留一个转圈的“翻译中”
  if (!checkTranslation(source, translation).ok) {
    return {
      message: tf('toastSelectionSameAsSource', '这段文字已经是目标语言'),
      purpose: 'status',
      kind: 'info',
      replacePending: true,
    };
  }
  // #738：划词译文是用户要读完的内容，不是状态
  return { message: translation, purpose: 'content' };
}
