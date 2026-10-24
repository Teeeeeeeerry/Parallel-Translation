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
import type { SkipCategory } from '../dom/walker';
import type { FailureDisplay, PageToggleResult } from './orchestrator';
import type { IncrementalOutcome } from './page-session';
import { tf } from '../i18n';

/** 渲染统计：整页翻译会话按轮各记一份（首轮、补采集各轮、每次增量补翻，#1077、#1118）。 */
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

/**
 * 整页翻译这一次采集里被跳过的单元，按原因分组（#727）。只统计整页翻译那一次
 * 采集：闸门取样（只读采集）与增量补翻不计。
 */
export type SkipStats = Record<SkipCategory, number>;

export function emptySkipStats(): SkipStats {
  return { 'too-long': 0, 'too-complex': 0, 'site-rule': 0, other: 0 };
}

/** 清零，就地修改（content script 持有同一个对象）。 */
export function resetSkipStats(stats: SkipStats): void {
  Object.assign(stats, emptySkipStats());
}

/** 计入一个被跳过的单元（采集入口的 onSkip 直接接这里）。 */
export function countSkip(stats: SkipStats, category: SkipCategory): void {
  stats[category]++;
}

export function totalSkipped(stats: SkipStats): number {
  return Object.values(stats).reduce((a, b) => a + b, 0);
}

/** 控制台里各类的叫法，按 SkipCategory 的顺序列出。 */
const SKIP_LABELS: [SkipCategory, string][] = [
  ['too-long', '文字超长'],
  ['too-complex', '标记过密'],
  ['site-rule', '站点页面规则'],
  ['other', '其他'],
];

/**
 * 控制台那一行（#763）：总数与按原因分组的计数，供用户报问题时附上。只输出
 * 一行分组计数，不逐条打印元素 —— 长页面上逐条会刷屏。零跳过时为 null，
 * 正常页面上控制台不多出任何东西。没出现的类不列。
 */
export function skipConsoleLine(stats: SkipStats): string | null {
  const total = totalSkipped(stats);
  if (total === 0) return null;
  const groups = SKIP_LABELS.filter(([c]) => stats[c] > 0).map(([c, label]) => `${label} ${stats[c]}`);
  return `[PT] 整页翻译：采集时跳过 ${total} 个单元（${groups.join('，')}）`;
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

/**
 * 占比最大的那一类跳过（#759）；零跳过时为 null。数量相同时按 SKIP_LABELS
 * 的顺序取排在前面的：文字超长、标记过密、站点页面规则、其他 —— 越靠前越
 * 像是“正文实打实没翻”，越值得被说出来；“其他”只在它独大时才轮到。
 */
export function mainSkipCategory(skips: SkipStats): SkipCategory | null {
  let best: SkipCategory | null = null;
  for (const [category] of SKIP_LABELS) {
    if (skips[category] > (best ? skips[best] : 0)) best = category;
  }
  return best;
}

/**
 * #758：采集阶段被跳过的单元按数量汇总一条，沿用 #49 的风格 —— 结束后一条，
 * 不逐段刷屏。用户看到之后知道这一页确实有内容没翻，不是自己的错觉。它是
 * 状态不是内容，走状态类。零跳过时为 null。
 *
 * #759：带上占比最大的那一类原因，用户才知道是内容太长、标记太复杂，还是
 * 被站点规则挡下。一条提示只说一件事：数量是全部跳过的总数，原因只说最主要
 * 的那一类，详细分组在控制台里（#763）。“其他”没有可说的原因，只说数量。
 */
function skippedNotice(skips: SkipStats): PageNotice | null {
  const total = totalSkipped(skips);
  const main = mainSkipCategory(skips);
  if (total === 0 || !main) return null;
  const n = String(total);
  const message = {
    'too-long': () => tf('toastSkippedTooLong', `另有 ${n} 段未被采集，主要是文字过长`, n),
    'too-complex': () => tf('toastSkippedTooComplex', `另有 ${n} 段未被采集，主要是标记过于复杂`, n),
    'site-rule': () => tf('toastSkippedSiteRule', `另有 ${n} 段未被采集，主要是被站点规则排除`, n),
    other: () => tf('toastSkipped', `另有 ${n} 段未被采集，没有翻译`, n),
  }[main]();
  return { message, kind: 'info' };
}

/** 整页开关入口结束后要弹的那一条提示；不需要提示时为 null。 */
export function pageNotice(
  result: PageToggleResult,
  stats: RenderStats,
  skips: SkipStats = emptySkipStats(),
): PageNotice | null {
  switch (result.status) {
    case 'blocked':
      return { message: tf('toastSiteBlocked', '该站点已在站点名单中被禁用翻译'), kind: 'error' };
    case 'no-elements':
      // #758：一个单元都没采到，却有被跳过的（整篇正文是一个超长段落，#694）：
      // 说跳过了几段，而不是“本页没有可翻译的内容” —— 页面上明明有字
      return (
        skippedNotice(skips) ?? { message: tf('hintNoElements', '本页没有可翻译的内容'), kind: 'info' }
      );
    case 'error':
      // 没有一段插入译文：全部引擎失败 > 已经是目标语言 > 采集时跳过 >
      // 所有段落含图片/按钮（#760，与下面翻译完成时同一个顺序）
      if (result.summary?.allFailed) return allFailedNotice(result.summary.display);
      return (
        // #783：被拦下的单元里有译文与原文相同的，就不是“所有段落均含
        // 图片/按钮” —— 对一个同语言页面说这句话比什么都不说更糟
        sameAsSourceNotice(stats) ??
        // #760：有段落根本没进采集，“所有段落均含图片/按钮”同样不对
        skippedNotice(skips) ?? {
          // #49: 引擎返回了结果但全被拒绝渲染（纵深防御命中）
          message: tf('toastAllRejected', '所有段落均含图片/按钮，无法翻译'),
          kind: 'error',
        }
      );
    case 'translated':
      // 几条并存时只给一条（#760 定下四条的先后）：
      //   失败 > 已经是目标语言 > 采集时跳过 > 含图片/按钮
      // - 失败压在最上面：只有它意味着用户想看的内容没有到、而且用户能去
      //   处理（换引擎、查 key）
      // - 已经是目标语言排在第二：同语言页面整页都命中时它的数量往往占了
      //   大半，不说的话用户只看到页面没变，会以为没点中而再点一次、再花
      //   一次配额（#785）
      // - 采集时跳过排在含图片/按钮之上：两者都是正文没翻，但跳过的那些
      //   从来没进过待翻列表，不说用户永远不知道（#727）；含图片/按钮的
      //   段落进过列表、原文就在眼前，用户看得见它没翻
      return (
        partialFailNotice(stats, result.summary?.display) ??
        sameAsSourceNotice(stats) ??
        skippedNotice(skips) ??
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
    // #793：页面级闸门命中，说明原因；它是状态不是内容，与“本页没有可翻译
    // 的内容”同一风格
    case 'same-language':
      return { message: tf('toastPageSameLanguage', '本页已经是你的目标语言'), kind: 'info' };
    // 还原、在飞忙碌、翻译中被还原中止、总开关关闭：都不提示
    case 'restored':
    case 'busy':
    case 'abandoned':
    case 'disabled':
      return null;
  }
}

/**
 * 增量补翻结束后的提示（#1118）：与首轮同一套判定 —— 全部批次失败给
 * allFailedNotice，部分段落失败给 partialFailNotice；被放弃（还原）不提示。
 */
export function incrementalNotice(outcome: IncrementalOutcome): PageNotice | null {
  if (outcome.status === 'abandoned') return null;
  return outcome.status === 'error'
    ? allFailedNotice(outcome.summary.display)
    : partialFailNotice(outcome.stats, outcome.summary.display);
}

/**
 * 这个 frame 在整页翻译结束后要弹的那一条提示（#762）。
 *
 * popup 的整页翻译广播到标签页的全部 frame，每个 frame 各自采集、各自翻译、
 * 各自汇总。只有主文档弹，子框架一律不弹（#327）—— 带很多 iframe 的页面
 * 不会各弹一条。
 *
 * 计数不跨 frame 汇总，主文档报的是主文档自己的数，与既有四条汇总（渲染
 * 被拒、翻译失败、同语言兜底、没采到单元）一致：它们的统计都是每个 frame 一份、
 * 只在主文档说。跨 frame 汇总要在主文档等所有子框架各自翻完再收齐计数，而
 * 子框架翻完的时刻各不相同、跨源的还要经后台转发，提示就不再是“翻译结束时
 * 那一条”了。跳过提示的文案说“另有 N 段”，不说“本页共有”，不暗示是全页总数。
 */
export function framePageNotice(
  result: PageToggleResult,
  stats: RenderStats,
  skips: SkipStats,
  isMainFrame: boolean,
): PageNotice | null {
  return isMainFrame ? pageNotice(result, stats, skips) : null;
}

