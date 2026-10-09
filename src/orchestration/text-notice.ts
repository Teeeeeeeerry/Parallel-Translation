// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 逐段翻译与划词翻译拿到译文之后弹哪条提示 —— 输入全部显式传入，从
// content script 的副作用里摘出来单测。

import type { RenderResult } from '../dom/renderer';
import type { ToastPurpose } from '../ui/toast';
import { tf } from '../i18n';

export interface TextNotice {
  message: string;
  purpose: ToastPurpose;
  kind: 'info' | 'error';
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
