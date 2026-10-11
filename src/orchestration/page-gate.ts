// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 页面级判定（#777）：整页翻译开始前先问一句这一页是什么语言，与目标语言
// 相同就不翻 —— 一个请求都不发，配额一点不花，页面一个字不动。纯函数，输入
// 全部显式传入：页面语言声明与检测语言由调用方取好传进来，无 DOM、无网络、
// 无存储。
//
// 只管整页翻译。逐段与划词是用户点名要翻的一段，在中文页面上划中一段英文
// 引文单独翻译完全合理，它们靠渲染层的单元级兜底（#783）各自判断。
//
// 取数与归一化走 pageLanguage（#782），不另写一套；目标语言设置用同一个
// normalizeLangCode 归一化后比对。
//
// #791：检测语言优先于页面的语言声明 —— 大量中文站点把声明写成 en，而引擎
// 是照着真实文字判的。检测语言是从翻译响应里攒出来的，第一次点整页翻译时
// 一定还没有，这时只看声明；它是“能用上就更准”，不是前置条件。不要为了
// 拿到它先发一个探测请求，那就违背了命中时一个请求都不发。
//
// #843（规格 #831）：判定链的第一级换成本地内容识别。#791 的链条在第一次
// 点整页翻译时实际只看声明（检测语言还没有，默认引擎 google-web 也不返回），
// 而 `<html lang>` 说的是界面的语言，不是内容的语言：Steam 商店页以中文界面
// 打开，声明是 zh-cn，游戏介绍却是英文，闸门把用户想翻的页面整页拦下。内容
// 识别直接看这一次要翻的翻译单元文字，由调用方用浏览器自带的识别算好传进来
// （零网络请求），本模块不碰浏览器接口。识别可靠时只看它；不可靠或拿不到
// 时回落到 #791 的链条，行为与改动前一致。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts、input-target-lang.ts 同一
// 风格：调用方拿到原因直接渲染提示。

import { normalizeLangCode } from './lang-code';
import { pageLanguage } from './page-lang';

/**
 * 内容里目标语言的占比（0 到 100）达到这个数才算“绝大部分已经是目标语言”
 * （#843）。识别器的占比按字节算，一个汉字算三份。
 *
 * 依据是 #851 在 31 张真实页面上的实测（2026-10-12，Chromium 151，按本模块
 * 同一条口径取样，记录见 docs/research/page-gate-content-share.md）：
 * - 中文界面、外文内容（Steam 英文介绍、YouTube、Discourse 论坛、Amazon、
 *   App Store 评论区）：zh 5 到 64，识别器报可靠的 5 到 59
 * - 中文内容（声明是 en 的 GitHub README 与文档站，以及声明是中文的 Steam
 *   本地化页、维基、论坛）：zh 56 到 99，报可靠的 56 到 99
 * 两类交叉，单一占比阈值分不开（#858 复核）：65 让可靠的中文页里 56 与 64
 * 判成照常翻译，离 65 差 9 与 1；可靠的外文页最高 59，离 65 差 6。数值暂不动：
 * 换成别的数只是把错判挪到另一侧，而且实测里更多的错判来自识别器报不可靠
 * 后回落到声明，与阈值无关。更稳的判据见 #883。
 */
export const CONTENT_SHARE_THRESHOLD = 65;

/** 送去本地识别的样本总长上限（字符）：长页面不把整页文字都喂给识别器。 */
export const CONTENT_SAMPLE_MAX_CHARS = 4000;

/**
 * 送去本地识别的样本至少要这么长（字符），不到就不按占比判，走回落那条链
 * （#859）。这与“识别器说不可靠”是两条分支：不可靠是识别器自己的结论，
 * 这一条是样本太少、占比本身不稳。
 *
 * 不能只靠识别器的可靠标志：#859 在 Chromium 151 上实测，识别器对很短的
 * 样本确实报不可靠（单一语言的中文 16 字以内、英文 46 字符以内都不可靠，
 * content-short 夹具的 12 字符也是），但混排的短样本照样报可靠，而且一句
 * 外文就能让占比翻过 65：
 * - 中文正文加一句 50 字符的英文，共 61、81、101 字符时 zh 分别是 38、64、74
 * - 英文正文加一句 17 字的中文，共 38、58、78 字符时 zh 分别是 71、56、46
 * - 中文界面词加一句英文，共 30 字符时 zh 76、44 字符时 61，都报可靠
 * 到 100 字符，一句外文最多把中文正文压到 74，离 65 还有 9 个点；英文正文
 * 一侧早在 58 字符就压不过阈值。真实页面的样本远比这长：#851 实测的 31 张
 * 页面最短也有 552 字符，所以这条下限只管文字极少的页面。
 */
export const CONTENT_SAMPLE_MIN_CHARS = 100;

/**
 * 从翻译单元文字里取识别样本（#843）：总长不超过上限时全取；超过时在全部
 * 单元里等距取，直到装满上限 —— 只取开头会让页首的导航与标题占满样本。
 */
export function sampleUnitTexts(texts: string[], max = CONTENT_SAMPLE_MAX_CHARS): string {
  const units = texts.map((t) => t.trim()).filter(Boolean);
  const total = units.reduce((sum, t) => sum + t.length + 1, 0);
  if (total <= max) return units.join('\n');
  const picked: string[] = [];
  let used = 0;
  // 步长大于 1：按单元的平均长度换算，每隔这么多个单元取一个
  const stride = total / max;
  for (let x = 0; x < units.length && used < max; x += stride) {
    const t = units[Math.floor(x)]!.slice(0, max - used);
    picked.push(t);
    used += t.length + 1;
  }
  return picked.join('\n');
}

/** 浏览器本地识别对翻译单元样本给出的结果（#843）。 */
export interface ContentLang {
  /** 识别器自己说结果可靠 */
  reliable: boolean;
  /** 各语言及占比（0 到 100），识别器给的原样 */
  languages: { lang: string; percentage: number }[];
}

export interface PageGateInput {
  /** 目标语言设置 */
  to: string;
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
  /** 本地内容识别的结果（#843）；识别不可用或出错时为 null，缺省同 null */
  contentLang?: ContentLang | null;
}

export type PageGateDecision =
  | { translate: true }
  | {
      translate: false;
      /** 这一页本来就是目标语言 */
      reason: 'same-language';
      /** 判出的页面语言（归一化后） */
      lang: string;
    };

export function decidePageGate(input: PageGateInput): PageGateDecision {
  const to = normalizeLangCode(input.to);
  const content = contentLanguage(input, to);
  if (content === 'foreign') return { translate: true };
  if (content) {
    return content === to
      ? { translate: false, reason: 'same-language', lang: content }
      : { translate: true };
  }
  const page = pageLanguage(input);
  // #789：判不出页面语言就放行，照常翻译。这与输入翻译那边相反，是有意的，
  // 不是漏改：
  // - 输入翻译判不出对方的语言时宁可不猜（ADR-0005）：猜错是把一段不对的
  //   文字发给别人，而发送不可撤回
  // - 阅读方向猜错只是多翻一遍本来不用翻的内容，单元级兜底（#783）还会
  //   拦下原样还回来的段落；拦错的代价却是用户想翻的页面翻不了
  // 两边代价不对称，取舍也就相反。不要改成“判不出就不翻”
  if (!page.ok) return { translate: true };
  // #790：繁简不算同语言 —— normalizeLangCode 把中文按文字与地区分成 zh-TW
  // 与 zh-CN（#691），繁体页面对简体目标是真的要翻。直接比归一化后的码，
  // 不另写中文的比较
  if (page.lang === to) {
    return { translate: false, reason: 'same-language', lang: page.lang };
  }
  return { translate: true };
}

/** 语言码的主段（zh-TW 与 zh-CN 都是 zh）。 */
const primaryOf = (lang: string): string => lang.split('-')[0]!;

/**
 * 内容识别这一级的结论（#843）：
 * - null：识别拿不准或拿不到，交给下一级
 * - 'foreign'：目标语言的占比不到阈值 —— 内容里有成块的外文，照常翻译
 * - 语言码：内容绝大部分是目标语言所在的那种语言，给出归一化后的语言码
 */
function contentLanguage(input: PageGateInput, to: string | null): string | null | 'foreign' {
  const content = input.contentLang;
  if (!content?.reliable || content.languages.length === 0 || !to) return null;
  const family = primaryOf(to);
  const same = content.languages
    .map((l) => ({ code: normalizeLangCode(l.lang), raw: l.lang, percentage: l.percentage }))
    .filter((l) => l.code !== null && primaryOf(l.code) === family);
  const share = same.reduce((sum, l) => sum + l.percentage, 0);
  if (share < CONTENT_SHARE_THRESHOLD) return 'foreign';
  if (family !== 'zh') return to;
  // #790：繁简不算同语言。Chrome 的识别器对简体、繁体都只报裸 zh，分不出
  // 繁简：识别器自己带了子段就以它为准；否则取现有链条（检测语言 → 声明）
  // 里的中文变体；链条里也没有中文，才按裸 zh 归一化（简体）
  const explicit = same
    .filter((l) => /[-_]/.test(l.raw))
    .sort((a, b) => b.percentage - a.percentage)[0];
  if (explicit) return explicit.code;
  const chain = pageLanguage(input);
  if (chain.ok && primaryOf(chain.lang) === 'zh') return chain.lang;
  return normalizeLangCode('zh');
}
