// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译入口（translateInput）。输入翻译圆点点下去走这里；单文本翻译、
// 对方语言的来源与本地识别由调用方注入。

import type { SingleTextOptions, SingleTextResult } from '../orchestration/orchestrator';
import { decideInputLength } from './input-length';
import { decideInputTarget } from './input-target-lang';
import { decideWriteBack } from './input-writeback';
import { replaceInputText } from './input-replace';
import { inputMaxLength, inputText, type TextInput } from './input-eligibility';
import { deepActiveElement } from './float-common';
import { toast } from './toast';
import { tf } from '../i18n';

export interface InputTranslatorDeps {
  /** 编排模块的单文本入口（#312）。 */
  translateText(text: string, from: string, to: string, opts?: SingleTextOptions): Promise<SingleTextResult>;
  /**
   * 判定链第一级用的源语言：popup 里临时选了这一次的对方语言就是它（#663），
   * 否则是设置里的源语言。长度检查通过之后才读。
   */
  sourceLang(): string;
  /** 本 frame 翻译时引擎报告过的检测语言（#660）。 */
  detectedLang(): string | null;
  /** 本地识别给出的可靠语言（#661）。 */
  reliableLang(text: string): Promise<string | null>;
}

/**
 * 输入翻译（#639）—— 把输入框里的文字译成对方的语言。
 *
 * 走编排模块的单文本入口，与逐段翻译、划词翻译同一条路：准入判定、
 * 失败提示语义、当前领域与术语全部现成，不新开消息通道。目标语言取
 * 设置里的源语言（ADR-0005），当前领域因此按对方语言那个方向解析。
 *
 * #644：译文整段替换框里的全部文字，走浏览器原生的文本插入路径；
 * 浏览器拒绝插入时框里内容不动，译文弹在提示条里。
 *
 * #646：送翻时记下原文快照。译文回来时框里已经不是那一段，或焦点已经
 * 换到别处，就放弃写回、译文弹在提示条里 —— 吞掉用户刚打的字不可逆。
 */
export function createInputTranslator(deps: InputTranslatorDeps): (el: TextInput) => Promise<void> {
  return async function translateInput(el: TextInput): Promise<void> {
    const snapshot = inputText(el);
    // #643：超过阅读侧单个翻译单元的上限就不翻，零请求；不分段拼接
    const length = decideInputLength(snapshot);
    if (!length.ok) {
      toast(
        tf('toastInputTooLong', `这段文字超过 ${length.limit} 个字符。输入翻译不分段翻译，请删减后再试`, String(length.limit)),
        { purpose: 'status', kind: 'error' },
      );
      return;
    }
    // #640：译成哪种语言由判定链给出（ADR-0005）；判不出来不猜，
    // 提示用户去设置里指定源语言，零请求
    // #658：源语言是 auto 时读本 frame 页面的语言声明；
    // #660：本 frame 翻译时引擎报告过检测语言就优先用它
    // #661：用户写的已经是对方的语言就不替换，零请求
    // #663：popup 里临时选了这一次的对方语言，就用它顶替源语言设置这一级。
    // 临时选择是调用方的输入，判定链本身不改：选了具体语言，链的第一级就
    // 定下它；选“跟随设置”照旧走完整条链。写的已经是所选语言时同样不替换
    const target = decideInputTarget({
      from: deps.sourceLang(),
      pageLang: document.documentElement.getAttribute('lang'),
      detectedLang: deps.detectedLang(),
      text: snapshot,
      textLang: await deps.reliableLang(snapshot),
    });
    if (!target.ok) {
      if (target.reason === 'same-language') {
        toast(tf('toastInputSameLanguage', '写的已经是对方的语言，没有替换'), { purpose: 'status' });
      } else {
        toast(
          tf('toastInputSourceLangNeeded', '判断不出要译成哪种语言，请在设置里把源语言指定为对方的语言'),
          { purpose: 'status', kind: 'error' },
        );
      }
      return;
    }
    // #642：译文不进翻译缓存，也不读它
    // #1044：与页面的翻译态无关 —— 点悬浮球还原整页不取消、不作废这一条。
    // #1072：从输入根派生，不随还原中止
    const result = await deps.translateText(snapshot, 'auto', target.lang, {
      noCache: true,
      root: 'input',
    });

    // #1075：没拿到译文时显示入口给出的提示，与逐段、划词同一口径：准入拦截、
    // 失败原因照常提示；被放弃、总开关关闭不提示（此前这里缺“放弃不提示”）
    if (!result.ok) {
      if (result.notice) toast(result.notice.message, result.notice);
      return;
    }

    const writeBack = decideWriteBack({
      snapshot,
      current: inputText(el),
      focused: deepActiveElement() === el,
      // #654：长度上限装不下译文时不写回 —— 原生插入会静默截断
      translation: result.translation,
      maxLength: inputMaxLength(el),
    });
    if (!writeBack.write || !(await replaceInputText(el, result.translation))) {
      // #751：交出的译文是用户要读完、多半还要复制走的内容，按内容类显示 ——
      // 停留时长随长度、悬停不计时、有关闭按钮。只有这一条是内容类：上面的
      // 失败、超长、同语言不替换、判不出目标语言、站点禁用仍是状态类
      toast(result.translation, { purpose: 'content' });
    }
  };
}
