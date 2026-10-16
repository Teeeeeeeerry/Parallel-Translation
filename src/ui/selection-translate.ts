// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 划词翻译入口（translateSelection）。拖选划词与右键菜单最终都走这里，改
// 一处两条入口同时生效。单文本翻译与设置由调用方注入，入口本身只管等待态、
// 结果与失败提示。

import { normalizeText } from '../dom/normalize';
import type { SingleTextResult } from '../orchestration/orchestrator';
import { selectionNotice } from '../orchestration/text-notice';
import { toast, toastPending } from './toast';
import { tf } from '../i18n';

export interface SelectionTranslatorDeps {
  /**
   * 编排模块的单文本入口（#315）。#1044：signal 在这一轮被后发的一轮顶掉时
   * 触发，编排模块据此通知后台中止。
   */
  translateText(
    text: string,
    from: string,
    to: string,
    opts?: { signal?: AbortSignal },
  ): Promise<SingleTextResult>;
  /** 发起时读当前设置的源语言与目标语言。 */
  getLangs(): { from: string; to: string };
  /** 子 frame 不弹站点禁用提示。 */
  isMainFrame: boolean;
}

export function createSelectionTranslator(
  deps: SelectionTranslatorDeps,
): (text: string) => Promise<void> {
  // #750：并发只认最后一次。每次发起记一个单调递增的序号，记在入口这一层
  // （每个 frame 一个入口实例，拖选与右键共用）；结果回来时序号已不是最新
  // 的，说明期间又发起了一轮，这一轮整条丢弃 —— 与编排模块“还原后旧结果
  // 不落地”同一个思路
  let latest = 0;
  // #1044：最新一轮的放弃句柄。后发一轮顶掉它时，它的结果反正整条丢弃 ——
  // 还在飞的话通知后台中止，不翻完再丢。提示被关掉不算放弃：等待态没有关闭
  // 按钮，能关的只有已经出来的译文，那时请求早已结束
  let abandonLatest: AbortController | null = null;

  return async function translateSelection(text: string): Promise<void> {
    // 跨行划词时选区文本天然带 \n，入口归一化
    text = normalizeText(text);
    const seq = ++latest;
    abandonLatest?.abort();
    const abandon = new AbortController();
    abandonLatest = abandon;

    // #746：点下去立即显示等待态，它自己不消失，由译文或失败替换。准入
    // 拦截不提示、出错等没有提示接替它的退出路径，收尾时收掉
    const pending = toastPending(tf('toastTranslating', '翻译中'));
    try {
      // #315: 划词翻译走编排模块的单文本入口 —— 与逐段翻译共用
      // 同一份准入判定与失败提示语义，不再直连消息通道
      const { from, to } = deps.getLangs();
      const result = await deps.translateText(text, from, to, { signal: abandon.signal });
      // 被丢弃的那一轮不替换等待态、不弹提示：此刻页面上的等待态（或译文）
      // 属于后发那一轮
      if (seq !== latest) return;
      // #749：引擎很快返回时等待态等满最短显示时间再替换，译文与失败两条
      // 路径都在这之后，失败快速返回时同样不闪。
      //
      // 与 #750 的序号共存：等满要过一段时间，这期间若又发起了一轮，等满的
      // 这次结果已经不是最新的 —— 等满之后必须再比一次序号，丢弃而不是替换。
      // 只在拿到结果时比一次的话，旧结果会在等满那一刻换掉新一轮的转圈
      await pending.shownLongEnough();
      if (seq !== latest) return;
      showResult(text, result);
    } finally {
      // 等待态的句柄跟着作废：被丢弃的那一轮不去收任何东西，后发那一轮的
      // 转圈由它自己的结果替换或收尾
      if (seq === latest) pending.dismiss();
    }
  };

  /** 划词翻译的结果提示。 */
  function showResult(text: string, result: SingleTextResult): void {
    // #748：失败与站点禁用同样就地替换等待态 —— 不先摘掉转圈再弹一条，
    // 中间没有两条都不在的瞬间。替换之后仍是状态类：错误样式、固定时长、
    // 没有关闭按钮，不跟着内容类按长度延长
    const failure = { purpose: 'status', kind: 'error', replacePending: true } as const;

    // 准入拦截：与逐段 / 整页翻译一致的提示
    if (result.admission === 'blocked') {
      if (deps.isMainFrame) toast(tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), failure);
      return;
    }
    if (result.admission !== 'allowed') return;

    if (!result.ok) {
      // #313: key 无效 / 配额展示真实原因，瞬时故障展示泛化文案
      if (result.display?.showRealReason && result.error) {
        toast(result.error, failure);
      } else {
        toast(tf('toastTranslateFail', '翻译失败'), failure);
      }
      return;
    }

    // #787：划中的已经是目标语言时说明是同语言，不把原文当译文弹出来；
    // 否则译文走内容类（#738）
    const notice = selectionNotice(text, result.translation!);
    toast(notice.message, notice);
  }
}
