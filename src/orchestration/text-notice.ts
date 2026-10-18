// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 单文本入口（逐段、划词、输入翻译）该弹哪条提示 —— 输入全部显式传入，从
// content script 的副作用里摘出来单测。
//
// #1075：没拿到译文时提示什么也在这里定，只写一处：准入拦截、放弃、失效、
// 配额、真实原因、泛化失败。编排模块的单文本入口据此直接给出“要显示的提示”
// 或“不提示”，三个调用点只负责显示；整页翻译的汇总也用同一份真实原因判定。

import type { FailureCategory } from '../engines/types';
import type { FailureDisplay } from './orchestrator';
import type { RenderResult } from '../dom/renderer';
import { checkTranslation } from '../dom/translation-check';
import type { ToastOptions } from '../ui/toast';
import { tf } from '../i18n';

/** 提示的文字与选项，原样交给 toast()。 */
export interface TextNotice extends ToastOptions {
  message: string;
}

/**
 * 失败类别 → 提示语义（#313）：key 无效 / 配额耗尽展示真实原因，其余展示泛化
 * 文案。整页翻译的汇总也用它；被放弃不经过这里（#1074）。
 */
export function displayDecision(
  category: FailureCategory | undefined,
  error: string | undefined,
): FailureDisplay {
  if (category === 'invalid-key' || category === 'quota') {
    return { showRealReason: true, reason: error };
  }
  return { showRealReason: false };
}

/** 单文本入口没给出译文的缘由（#1075），由编排模块按准入与发送结果给出。 */
export type SingleTextMiss =
  /** 站点被名单禁用；mainFrame 为假时是子框架（#327：子框架不产生提示）。 */
  | { kind: 'blocked'; mainFrame: boolean }
  /** 总开关关闭：安静。 */
  | { kind: 'disabled' }
  /** 被放弃（页面还原、调用方中止）：安静，不是失败（#1053）。 */
  | { kind: 'abandoned' }
  /**
   * 发出去了、引擎没给出译文。invalidated 是失效（扩展上下文失效、配额耗尽）：
   * 与整页汇总同一口径，展示真实原因（上下文失效时是“请刷新页面后重试”）。
   */
  | { kind: 'failed'; category?: FailureCategory; error?: string; invalidated?: boolean };

/** 单文本入口没给出译文时要显示的提示；null 为不提示。 */
export function singleTextMissNotice(miss: SingleTextMiss): TextNotice | null {
  const error = (message: string): TextNotice => ({ message, purpose: 'status', kind: 'error' });
  switch (miss.kind) {
    case 'blocked':
      return miss.mainFrame ? error(tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译')) : null;
    case 'disabled':
    case 'abandoned':
      return null;
    case 'failed': {
      const real = miss.invalidated || displayDecision(miss.category, miss.error).showRealReason;
      return real && miss.error ? error(miss.error) : error(tf('toastTranslateFail', '翻译失败'));
    }
  }
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
