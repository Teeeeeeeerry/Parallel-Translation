// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 整页翻译结束后的提示汇总 —— 输入全部显式传入，从 content script 的
// 副作用里摘出来单测（#783）。
//
// 同一时刻只显示一条提示，所以这里只给出一条：几种情况并存时给最需要
// 被看到的那条，而不是依次弹出、后一条把前一条顶掉。

import type { RenderResult } from '../dom/renderer';
import type { FailureDisplay, PageToggleResult } from './orchestrator';
import { tf } from '../i18n';

/** 渲染统计（每次整页翻译与增量补翻开始时清零）。 */
export interface RenderStats {
  /** 插入了译文的单元 */
  succeeded: number;
  /** 含图片 / 按钮被拒绝渲染的单元（#49） */
  rejected: number;
  /**
   * 译文与原文相同、没有插入的单元（#783）。单独计数而不并进 rejected：
   * rejected 的提示写死了“含图片/按钮”
   */
  sameAsSource: number;
  /** 翻译失败的单元（#416） */
  failed: number;
}

export function emptyRenderStats(): RenderStats {
  return { succeeded: 0, rejected: 0, sameAsSource: 0, failed: 0 };
}

/** 清零，就地修改（content script 持有同一个对象）。 */
export function resetRenderStats(stats: RenderStats): void {
  Object.assign(stats, emptyRenderStats());
}

/** 把一个单元的渲染结果计入统计。 */
export function countRender(stats: RenderStats, result: RenderResult): void {
  if (result.rendered) stats.succeeded++;
  else if (result.reason === 'same-as-source') stats.sameAsSource++;
  else stats.rejected++;
}

/**
 * 引擎返回了结果但没有一个单元插入译文（#327）：悬浮球不点亮完成态。
 * #416：有段落翻译失败时不算，失败另行提示。
 */
export function allRenderBlocked(stats: RenderStats): boolean {
  return stats.succeeded === 0 && stats.failed === 0;
}

export interface PageNotice {
  message: string;
  kind: 'info' | 'error';
}

/** 全部引擎失败（#313）：key 无效 / 配额展示真实原因，瞬时故障展示泛化文案。 */
export function allFailedNotice(display: FailureDisplay | undefined): PageNotice {
  return {
    message:
      display?.showRealReason && display.reason
        ? display.reason
        : tf('toastAllEnginesFail', '所有引擎均失败'),
    kind: 'error',
  };
}

/**
 * #416: 部分段落翻译失败 —— 已成功的段落照常渲染，失败段落保持原样，
 * 结束后用一条提示汇总。key 无效 / 配额耗尽时展示真实原因（#313）。
 */
export function partialFailNotice(
  stats: RenderStats,
  display: FailureDisplay | undefined,
): PageNotice | null {
  if (stats.failed === 0) return null;
  return {
    message:
      display?.showRealReason && display.reason
        ? display.reason
        : tf('domainPartialFail', `${stats.failed} 段翻译失败`, String(stats.failed)),
    kind: 'error',
  };
}

/**
 * #785：译文与原文相同、没有插入的单元按数量汇总一条 —— 不说的话用户只看到
 * 这几段没变，会觉得扩展时灵时不灵。它是状态不是内容，走状态类。
 */
function sameAsSourceNotice(stats: RenderStats): PageNotice | null {
  if (stats.sameAsSource === 0) return null;
  return {
    message: tf(
      'toastSameAsSource',
      `${stats.sameAsSource} 段已经是目标语言，没有插入译文`,
      String(stats.sameAsSource),
    ),
    kind: 'info',
  };
}

/** 整页开关入口结束后要弹的那一条提示；不需要提示时为 null。 */
export function pageNotice(result: PageToggleResult, stats: RenderStats): PageNotice | null {
  switch (result.status) {
    case 'blocked':
      return { message: tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), kind: 'error' };
    case 'no-elements':
      return { message: tf('hintNoElements', '本页没有可翻译的内容'), kind: 'info' };
    case 'error':
      if (result.summary?.allFailed) return allFailedNotice(result.summary.display);
      // #783：被拦下的单元里有译文与原文相同的，就不是“所有段落均含
      // 图片/按钮” —— 对一个同语言页面说这句话比什么都不说更糟
      if (stats.sameAsSource > 0) return sameAsSourceNotice(stats);
      // #49: 引擎返回了结果但全被拒绝渲染（纵深防御命中）
      return { message: tf('toastAllRejected', '所有段落均含图片/按钮，无法翻译'), kind: 'error' };
    case 'translated':
      // 几条并存时只给一条，排序是 失败 > 已经是目标语言 > 含图片/按钮：
      // - 失败压在最上面：只有它意味着用户想看的内容没有到，要去处理
      //   （换引擎、查 key），其余两条都是“没插，也不用插”
      // - 已经是目标语言排在含图片/按钮之上：同语言页面整页都命中时它
      //   的数量往往占了大半，不说的话用户只看到页面没变，会以为没点中
      //   而再点一次、再花一次配额；含图片/按钮的段落原文本就看得见
      return (
        partialFailNotice(stats, result.summary?.display) ??
        sameAsSourceNotice(stats) ??
        // #49：整页翻译结束后用一条提示汇总被拒数量，而不是逐条刷屏
        (stats.rejected > 0
          ? {
              message: tf(
                'toastRenderRejected',
                `${stats.rejected} 段因含图片/按钮未翻译`,
                String(stats.rejected),
              ),
              kind: 'info',
            }
          : null)
      );
    // #792：页面级闸门命中。提示是 #793 的事
    case 'same-language':
    // 还原、在飞忙碌、翻译中被还原中止、总开关关闭：都不提示
    case 'restored':
    case 'busy':
    case 'aborted':
    case 'disabled':
      return null;
  }
}
