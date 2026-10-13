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
// （零网络请求），本模块不碰浏览器接口。识别可靠时只看它；识别器拿不准时
// 照常翻译（#889，见 contentLanguage）；没有做识别（未注入、样本太短）时
// 才走 #791 的链条。
//
// #891（父 #883）：内容识别先看翻译单元里有没有一块够长的外文正文，有就
// 照常翻译，不再看全页占比。全页占比按字节算，一个汉字算三份，中文界面的
// 菜单与标签再碎也压得住很长的外文正文（#851：Steam Lethal Company 有 1520
// 字符的英文介绍，全页 zh 仍是 53）；成块的外文正文却天然在最长的几个单元
// 里。单元级识别的结果由调用方算好传进来（contentUnits），本模块仍不碰浏览器
// 接口。没有这样的外文块，才轮到全页占比与后面的链条。
//
// #903（父 #898）：没有外文块时，再看最长的 LONGEST_UNITS_COUNT 个单元，全部
// 可靠地识别成目标语言就拦下，不再只靠全页样本：全页识别报不可靠时只能
// 放行（#889），全页占比两类交叉（#851）。证据不足就交给后面的链条。
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
 * 后回落到声明，与阈值无关（#889 已改成不可靠时照常翻译）。#891 在占比之前
 * 加了“够长的外文单元”一级，见 FOREIGN_BLOCK_MIN_CHARS；这个阈值只在没有
 * 外文块的页面上起作用。
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
 * 一个单元至少有这么多字符、识别为外文，才算“一块够长的外文正文”（#891）。
 * 字数是字符数，中英文同一口径。
 *
 * 依据是 #890 在 #851 那 31 张真实页面上的实测（2026-10-12，Chromium 151，
 * 记录见 docs/research/page-gate-longest-units.md），每页最长的外文单元：
 * - 外文页（13 张）：64 到 1563；Cursor 论坛话题列表一个外文单元都没有
 * - 中文页（18 张）：0 到 558
 * 两个区间重叠，按字数分不开，任何一个下限都至少错 8 张。所以不去凑一个
 * “看起来分得开”的数，而是取外文页里成块外文正文的最小值：245，Cursor 论坛
 * 话题 174381 的帖子正文。
 *
 * 外文页里比它短的 64 到 99 是 YouTube 推荐栏的视频标题（大模型入门、Rick
 * 两页；视频说明没展开，不在只读采集的单元里），不是正文。#891 起先连它们
 * 一起取了 64，结果 #777 的同语言夹具（中文页面引一句 78 字符的英文）被
 * 当成外文页整页送翻，页面级闸门那批的端到端（#795、#843、#873）全部变红
 * （#892）：一句英文引文、一行英文标题都不是“成块的外文”。那两张 YouTube
 * 页靠全页识别报不可靠时放行（#889）或全页占比不到阈值照常翻译，#892 在
 * 31 张页面上重算，两遍都没有被拦下的外文页。
 *
 * 代价是这些中文页仍会因为一块外文被判成照常翻译（都在实测里）：
 * - Steam 已有中文介绍的页面上的英文评语与获奖声明：Bastion 558、火线迈阿密
 *   517、Dwarf Fortress 375、Caves of Qud 336
 * - 若依文档首页一串 QQ 群号 448（识别器报可靠的 ht）
 * 这些页面被放行后，中文的段落由单元级兜底（#783）接住，不插译文、不标记
 * 已翻译，多花的是一轮请求与配额。
 *
 * 不沿用 #859 的 100 字符样本下限：那条下限防的是“一句外文让全页占比翻过
 * 阈值”，这里不算占比，只问这一个单元是不是外文；何况 245 本来就在它之上。
 * 短于这个下限的单元成不了外文块，所以也不送去识别。
 */
export const FOREIGN_BLOCK_MIN_CHARS = 245;

/**
 * 送去单元级识别的单元个数上限（#891）：按文字长度取最前面的这么多个。只识别
 * 最长的几个而不是全部单元 —— 成块的外文正文天然在最长的几个单元里，界面
 * 文字天然短而碎 —— 识别次数因此有上限，不随页面变大（#867）。
 *
 * 依据 #890：实测里有成块外文正文的外文页，最长的外文单元全部排第 1；量的
 * 是前 10 个，留出页面上有几段等长中文正文排在前面的余地。
 */
export const UNIT_DETECT_COUNT = 10;

/**
 * 每个单元送去识别的文字上限（字符，#891）。字数仍按全文算，只是识别只看
 * 开头这一段。依据 #890：前 10 个单元里超过 1000 字符的 20 个（两遍合计），
 * 截到 1000 字符再识别，语言与可靠标记全部与识别全文相同。于是单元级识别
 * 喂给识别器的文字量最多 UNIT_DETECT_COUNT 乘这个数，与页面大小无关。
 */
export const UNIT_DETECT_MAX_CHARS = 1000;

/**
 * 没有外文块时，取最长的这么多个单元看是不是全部可靠地识别成目标语言，是就
 * 拦下（#903，父 #898）。
 *
 * 依据是 #902 在 #851 那 31 张真实页面上的实测（2026-10-13，Chromium 151，
 * 记录见 docs/research/page-gate-top-units-target.md），连同 #890 的两遍数据
 * 共四遍：
 * - 13 张中文界面、外文内容的页面，最长的单元没有一个是可靠的 zh（从第 1 个
 *   起连续可靠 zh 的个数全是 0），取 1 到 10 个都零误拦
 * - 7 张声明外文、内容中文的页面，取 1 到 7 个都只拦得下 Rust 所有权（它
 *   本来就因为全页 zh 95 被拦）；仍被放行的 justjavac、awesome-python-cn、
 *   若依首页与环境部署，最长的几个单元里都有识别器报不可靠的中英混排
 * - 11 张对照页，取 3 与取 5 都是两遍拦下 3 张（维基长城、少数派、阮一峰），
 *   取 10 只剩 2 张
 * 取 3：取 3 与取 5 的两个数一样，取 3 要的单元少，单元少的页面（阮一峰的
 * 网络日志、若依文档只有二三十个单元）也用得上。不取 1 或 2：一两个单元的
 * 证据太薄，中文界面上一段较长的中文公告或 cookie 说明排到第一，就足以把
 * 外文页拦下 —— 实测里没出现，不代表没有，而误拦是用户想翻的页面翻不了。
 */
export const LONGEST_UNITS_COUNT = 3;

/**
 * 字母的口径（#901）：Unicode 的字母属性 \p{L}，任何文字的字母都算（拉丁、
 * 西里尔、汉字、假名、谚文……），连同附在字母上的组合记号 \p{M} —— 天城文、
 * 泰文的元音符号是记号不是字母，不算进来一段印地语正文就凑不够多数。数字
 * \p{N}、标点 \p{P}、符号 \p{S} 与空白都不算。
 */
const LETTER = /[\p{L}\p{M}]/gu;

/**
 * 取送去单元级识别的单元（#891）：去掉首尾空白，只要到外文块下限的，按文字
 * 长度从长到短（等长的保持页面顺序）取前 UNIT_DETECT_COUNT 个，每个截到
 * UNIT_DETECT_MAX_CHARS。chars 是全文的字符数；letters 是全文里的字母数
 * （#901，口径见 LETTER）。
 */
export function longestUnitTexts(
  texts: string[],
  count = UNIT_DETECT_COUNT,
): { chars: number; letters: number; text: string }[] {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length >= FOREIGN_BLOCK_MIN_CHARS)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.length - a.t.length || a.i - b.i)
    .slice(0, count)
    .map(({ t }) => ({
      chars: t.length,
      letters: t.match(LETTER)?.length ?? 0,
      text: t.slice(0, UNIT_DETECT_MAX_CHARS),
    }));
}

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

/**
 * 识别器被调用了，却没给出结果（出错、回调超过时间上限）时调用方传这个
 * （#889）：与识别器自己说拿不准同等对待，照常翻译。与“没有做识别”的
 * null 不同 —— 那是根本没送去识别（未注入、样本太短），走现有链条。
 */
export const CONTENT_UNDETERMINED: ContentLang = Object.freeze({
  reliable: false,
  languages: [],
}) as ContentLang;

/** 单元级识别对一个翻译单元给出的结果（#891）。 */
export interface UnitLang {
  /** 单元全文的字符数（不是送去识别的那一段的长度） */
  chars: number;
  /** 单元全文里的字母数（#901，口径见 longestUnitTexts） */
  letters: number;
  /** 识别器给出的排第一的语言；拿不到时为 null */
  lang: string | null;
  /** 识别器自己说结果可靠 */
  reliable: boolean;
}

export interface PageGateInput {
  /** 目标语言设置 */
  to: string;
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
  /**
   * 本地内容识别的结果（#843）。没有做识别（未注入识别、样本太短）时为
   * null，缺省同 null；送去识别却没拿到结果时为 CONTENT_UNDETERMINED（#889）
   */
  contentLang?: ContentLang | null;
  /**
   * 单元级识别的结果（#891）：按文字长度排在最前面的若干个单元各自识别。
   * 没有做时为 null，缺省同 null，与空列表一样只是“没有外文块”
   */
  contentUnits?: UnitLang[] | null;
}

/**
 * 结论来自判定链的哪一级（#857）。判定链改过几次（#843、#889、#891），排查
 * 时要看得出这一次走的是哪一级：
 * - foreign-block：翻译单元里有够长的外文单元，照常翻译（#891）
 * - longest-units：最长的若干个单元都可靠地识别成目标语言，拦下（#903）
 * - content-share：全页样本里目标语言的占比，到阈值拦下、不到照常翻译（#843）
 * - declaration：没有做内容识别，按检测语言 → 语言声明的链条（#791）
 * - pass：判不出就放行 —— 识别器拿不准（#889），或链条也判不出（#789）
 */
export type PageGateBasis =
  | 'foreign-block'
  | 'longest-units'
  | 'content-share'
  | 'declaration'
  | 'pass';

export type PageGateDecision =
  | { translate: true; basis: PageGateBasis }
  | {
      translate: false;
      /** 这一页本来就是目标语言 */
      reason: 'same-language';
      /** 判出的页面语言（归一化后） */
      lang: string;
      /** 拦下只可能来自这三级 */
      basis: 'longest-units' | 'content-share' | 'declaration';
    };

export function decidePageGate(input: PageGateInput): PageGateDecision {
  const to = normalizeLangCode(input.to);
  if (hasForeignBlock(input.contentUnits, to)) return { translate: true, basis: 'foreign-block' };
  const longest = longestUnitsLanguage(input, to);
  if (longest) {
    return longest === to
      ? { translate: false, reason: 'same-language', lang: longest, basis: 'longest-units' }
      : { translate: true, basis: 'longest-units' };
  }
  const content = contentLanguage(input, to);
  if (content === 'undetermined') return { translate: true, basis: 'pass' };
  if (content === 'foreign') return { translate: true, basis: 'content-share' };
  if (content) {
    return content === to
      ? { translate: false, reason: 'same-language', lang: content, basis: 'content-share' }
      : { translate: true, basis: 'content-share' };
  }
  const page = pageLanguage(input);
  // #789：判不出页面语言就放行，照常翻译。这与输入翻译那边相反，是有意的，
  // 不是漏改：
  // - 输入翻译判不出对方的语言时宁可不猜（ADR-0005）：猜错是把一段不对的
  //   文字发给别人，而发送不可撤回
  // - 阅读方向猜错只是多翻一遍本来不用翻的内容，单元级兜底（#783）还会
  //   拦下原样还回来的段落；拦错的代价却是用户想翻的页面翻不了
  // 两边代价不对称，取舍也就相反。不要改成“判不出就不翻”
  if (!page.ok) return { translate: true, basis: 'pass' };
  // #790：繁简不算同语言 —— normalizeLangCode 把中文按文字与地区分成 zh-TW
  // 与 zh-CN（#691），繁体页面对简体目标是真的要翻。直接比归一化后的码，
  // 不另写中文的比较
  if (page.lang === to) {
    return { translate: false, reason: 'same-language', lang: page.lang, basis: 'declaration' };
  }
  return { translate: true, basis: 'declaration' };
}

const BASIS_TEXT: Record<PageGateBasis, string> = {
  'foreign-block': '翻译单元里有够长的外文单元',
  'longest-units': '最长的几个单元都是目标语言',
  'content-share': '全页样本里目标语言的占比',
  declaration: '检测语言与语言声明',
  pass: '判不出页面语言，放行',
};

/**
 * 判定的可读说明（#857），给控制台输出用，排查时看得出走的是哪一级。不是
 * 界面文案，不进 messages.json。
 */
export function describePageGate(decision: PageGateDecision): string {
  const verdict = decision.translate ? '照常翻译' : `拦下，本页已经是 ${decision.lang}`;
  return `${verdict}（依据：${BASIS_TEXT[decision.basis]}，${decision.basis}）`;
}

/** 语言码的主段（zh-TW 与 zh-CN 都是 zh）。 */
const primaryOf = (lang: string): string => lang.split('-')[0]!;

/**
 * 翻译单元里有没有一块够长的外文正文（#891）：识别器报可靠、排第一的语言
 * 不是目标语言所在的那种语言（主段不同；识别器对繁简都只报 zh，同一种
 * 中文不算外文，繁简另由 #790 的链条判）、字数到下限、字母占多数。
 *
 * 字母占多数（#901）：字母数超过单元全文字符数的一半，口径见 longestUnitTexts
 * 的 LETTER。识别器只回答“像哪种语言”，不回答“是不是正文”：#890 实测若依
 * 文档首页一串 448 字符的 QQ 群号（“1389287（1群） 、 1679294（2群） ……”）
 * 被报成可靠的 ht，算成外文块，整页放行（#892 重算两遍都如此）。数字串、
 * 标点串、符号串不是外文正文。分母取全文字符数（含空白），英文正文的字母约占
 * 八成，中英混排带版本号与网址的也在六成以上，差得远的只有数字与符号堆。
 */
function hasForeignBlock(units: UnitLang[] | null | undefined, to: string | null): boolean {
  if (!units || !to) return false;
  const family = primaryOf(to);
  return units.some((u) => {
    if (!u.reliable || u.chars < FOREIGN_BLOCK_MIN_CHARS || !u.lang) return false;
    if (u.letters * 2 <= u.chars) return false;
    const code = normalizeLangCode(u.lang);
    return code !== null && primaryOf(code) !== family;
  });
}

/**
 * 最长的若干个单元这一级（#903，父 #898）：按字数取最长的 LONGEST_UNITS_COUNT
 * 个单元，全部是识别器报可靠、排第一的语言是目标语言所在的那种语言（主段
 * 相同），给出归一化后的语言码；否则 null，交给后面的全页占比与链条。
 *
 * 放在外文块之后、全页占比之前。全页样本混着界面文字与正文，识别器在长样本
 * 上的可靠标记靠不住（#851：31 张页面两遍各 14 与 12 张报不可靠），报不可靠
 * 时只能放行（#889）；单元级的证据更直接：最长的几个单元就是页面的正文。
 *
 * 证据不足就不拦：单元数不到取数、任何一个报不可靠或拿不到语言、任何一个
 * 不是目标语言，都返回 null。宁可少拦：拦错的代价是用户想翻的页面翻不了，
 * 放过的代价只是多翻一遍，由单元级兜底（#783）接住。
 *
 * 不沿用 #859 的 100 字符样本下限：那条防的是“一句外文让全页占比翻过阈值”，
 * 这里不算占比，每个单元都要识别器自己报可靠；太短的单元识别器本来就报不
 * 可靠（#859 实测单一语言的中文 16 字以内、英文 46 字符以内），让这一级不拦，
 * 错也错在放行那一侧。#902 实测里阮一峰的网络日志最长的单元只有 45 到 49
 * 字，都报可靠的 zh，是有效的证据。
 *
 * 繁简（#790）与全页识别同一条：识别器只报 zh，取现有链条里的中文变体。
 */
function longestUnitsLanguage(input: PageGateInput, to: string | null): string | null {
  const units = input.contentUnits;
  if (!units || !to || units.length < LONGEST_UNITS_COUNT) return null;
  const family = primaryOf(to);
  const top = units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => b.u.chars - a.u.chars || a.i - b.i)
    .slice(0, LONGEST_UNITS_COUNT)
    .map(({ u }) => u);
  const codes: string[] = [];
  for (const u of top) {
    if (!u.reliable || !u.lang) return null;
    const code = normalizeLangCode(u.lang);
    if (code === null || primaryOf(code) !== family) return null;
    codes.push(u.lang);
  }
  if (family !== 'zh') return to;
  return chineseVariant(input, codes);
}

/**
 * 识别器判出是中文时取哪一种中文（#790）：繁简不算同语言，Chrome 的识别器
 * 对简体、繁体都只报裸 zh。识别器自己带了子段就以它为准（raw 按可信程度从高
 * 到低排好传进来）；否则取现有链条（检测语言 → 声明）里的中文变体；链条里
 * 也没有中文，才按裸 zh 归一化（简体）。
 */
function chineseVariant(input: PageGateInput, raw: string[]): string | null {
  const explicit = raw.find((l) => /[-_]/.test(l));
  if (explicit) return normalizeLangCode(explicit);
  const chain = pageLanguage(input);
  if (chain.ok && primaryOf(chain.lang) === 'zh') return chain.lang;
  return normalizeLangCode('zh');
}

/**
 * 内容识别这一级的结论（#843）：
 * - null：没有做识别，交给下一级
 * - 'undetermined'：识别器拿不准（报不可靠、一个语言都没给、被调用却没给出
 *   结果），照常翻译（#889）
 * - 'foreign'：目标语言的占比不到阈值 —— 内容里有成块的外文，照常翻译
 * - 语言码：内容绝大部分是目标语言所在的那种语言，给出归一化后的语言码
 */
function contentLanguage(
  input: PageGateInput,
  to: string | null,
): string | null | 'foreign' | 'undetermined' {
  const content = input.contentLang;
  if (!content || !to) return null;
  // #889（取代 #865 的“不可靠时回落到声明”）：识别器拿不准就照常翻译，不再
  // 往下走到检测语言与声明。本地化界面的声明都是目标语言，回落到声明就等于
  // 拦下：#851 实测两遍各有 5 张中文界面、外文内容的页面（YouTube 视频页、
  // Cursor 论坛话题列表、Amazon 商品页、Steam ULTRAKILL）识别器对样本报不
  // 可靠，回落到声明 zh 后整页被拦，而识别器在长样本上的可靠标记本身就靠不住
  // （31 张页面两遍各有 14 与 12 张报不可靠，4 张在两遍之间翻转）。
  // 取舍与 #789“判不出页面语言就放行”同一条：拦错的代价是用户想翻的页面翻
  // 不了，放行的代价只是多翻一遍；真正同语言的段落由单元级兜底（#783）接住，
  // 译文与原文相同就不插入、不标记已翻译，页面不会乱。
  // 代价：纯目标语言、识别器却报不可靠的页面（实测里有中文维基、阮一峰的
  // 网络日志、Steam 本地化页）会多发一轮请求、多花一轮配额。不要为了省这一轮
  // 改回回落到声明
  if (!content.reliable || content.languages.length === 0) return 'undetermined';
  const family = primaryOf(to);
  const same = content.languages
    .map((l) => ({ code: normalizeLangCode(l.lang), raw: l.lang, percentage: l.percentage }))
    .filter((l) => l.code !== null && primaryOf(l.code) === family);
  const share = same.reduce((sum, l) => sum + l.percentage, 0);
  if (share < CONTENT_SHARE_THRESHOLD) return 'foreign';
  if (family !== 'zh') return to;
  // #790：繁简不算同语言，见 chineseVariant。占比高的子段优先
  return chineseVariant(
    input,
    [...same].sort((a, b) => b.percentage - a.percentage).map((l) => l.raw),
  );
}
