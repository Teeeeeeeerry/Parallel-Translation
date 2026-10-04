// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译：译成哪种语言（#640）—— 纯函数，输入全部显式传入。
//
// ADR-0005：输入翻译的目标语言取设置里的源语言，也就是对方的语言。源语言
// 是 auto 时按一条判定链往下找；链上每一级都找不到就不猜 —— 猜错的代价是
// 用户把一段日文发进了英文频道，而发送不可撤回。
//
// 判定链（按优先级）：
// 1. 源语言设置是具体语言码 —— 用它（#640）
// 2. 本页翻译时引擎报告的检测语言 —— 用它（#659、#660）
// 3. 页面的语言声明 `<html lang>` 可识别 —— 取语言码主段（#658）；中文
//    按文字与地区分成 zh-TW / zh-CN，与源语言设置同一套码（#691）
// 4. 都没有 —— 判不出来，提示用户去设置里指定源语言
//
// 定出对方的语言后，再看用户写的是不是已经是这种语言（#661）：是就不替换、
// 不发请求 —— 措辞不同的同一种语言只会把写好的句子换掉。比较在归一化之后
// 做，与 #691 同一口径（zh-CN 与 zh-TW 不算同语言）。
//
// 检测语言排在声明之前（#660）：大量中文站点把声明写成 en，而引擎是照着
// 真实文字判的。默认引擎 google-web 不返回检测语言，所以这一级对多数用户
// 不生效，等于回落到声明 —— 它是“能用上就更准”，不是前置条件。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格：调用方拿到
// 原因直接渲染提示。

import { normalizeLangCode } from '../orchestration/lang-code';

export interface InputTargetInput {
  /** 设置里的源语言：具体语言码，或 'auto' */
  from: string;
  /** 页面的语言声明（`<html lang>` 的原值）；没有声明时为 null */
  pageLang: string | null;
  /** 本页翻译时引擎报告的检测语言；还没有时为 null */
  detectedLang: string | null;
  /** 用户在输入框里写的文字（#661） */
  text: string;
  /** 浏览器语言检测器对这段文字给出的可靠结果；不可靠或拿不到时为 null（#661） */
  textLang: string | null;
}

export type InputTargetDecision =
  | {
      ok: true;
      /** 译成的语言码 */
      lang: string;
      /** 取自判定链的哪一级 */
      via: 'source-setting' | 'detected-lang' | 'page-lang';
    }
  | {
      ok: false;
      /** 判定链每一级都给不出语言 —— 提示用户去设置里指定源语言 */
      reason: 'undetermined';
    }
  | {
      ok: false;
      /** 用户写的已经是对方的语言 —— 不替换、不发请求，提示后停手（#661） */
      reason: 'same-language';
      /** 判定出的对方语言 */
      lang: string;
    };

export function decideInputTarget(input: InputTargetInput): InputTargetDecision {
  const target = targetLang(input);
  if (!target.ok) return target;
  const written = textLanguages(input.text, input.textLang);
  if (written?.has(normalizeLangCode(target.lang) ?? target.lang)) {
    return { ok: false, reason: 'same-language', lang: target.lang };
  }
  return target;
}

/** 判定链：对方的语言是什么。 */
function targetLang(input: InputTargetInput): InputTargetDecision {
  if (input.from && input.from !== 'auto') {
    return { ok: true, lang: input.from, via: 'source-setting' };
  }
  const detected = normalizeLangCode(input.detectedLang);
  if (detected) return { ok: true, lang: detected, via: 'detected-lang' };
  const pageLang = normalizeLangCode(input.pageLang);
  if (pageLang) return { ok: true, lang: pageLang, via: 'page-lang' };
  return { ok: false, reason: 'undetermined' };
}

/**
 * 简繁写法不同的常用字，两两成对：前一个是简体，后一个是繁体。
 * 只收在另一种写法里不出现的字，看到就能定简繁。
 */
const SIMP_TRAD_PAIRS =
  '们們这這说說会會时時对對为為还還学學国國过過问問题題气氣讨討论論发發经經' +
  '动動现現开開关關长長门門见見没沒实實样樣边邊进進书書听聽让讓认認请請话話' +
  '语語读讀写寫车車东東马馬鸟鳥鱼魚岁歲历歷华華优優伤傷吗嗎么麼爱愛欢歡觉覺' +
  '电電脑腦买買卖賣钱錢银銀应應该該业業众眾专專义義乐樂习習乡鄉亲親务務谢謝' +
  '讲講个個来來与與给給难難乱亂虽雖测測试試级級图圖页頁运運输輸杂雜简簡传傳' +
  '达達须須单單双雙无無从從两兩头頭号號员員约約处處带帶场場标標错錯设設数數' +
  '据據库庫线線码碼选選择擇项項态態统統组組结結构構规規则則质質术術词詞译譯';
const SIMPLIFIED_ONLY = new Set([...SIMP_TRAD_PAIRS].filter((_, i) => i % 2 === 0));
const TRADITIONAL_ONLY = new Set([...SIMP_TRAD_PAIRS].filter((_, i) => i % 2 === 1));

const KANA = /[\u3040-\u30ff]/u;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const HAN = /\p{Script=Han}/u;
const LETTER = /\p{L}/u;

/**
 * 用户写的文字算哪些语言（归一化后的码）；看不出来时为 null。
 *
 * 中日韩看文字本身：浏览器的检测器分不出简繁，短句也常给不出可靠结果。
 * 一个汉字大约抵一个词，所以中日韩文字只要不少于其他字母的四分之一就按
 * 中日韩算（中文里夹几个英文词仍是中文）。有假名是日文，有谚文是韩文，
 * 只有汉字是中文；中文再按简繁专用字定 zh-CN / zh-TW，两种都没有（如
 * “你好世界”）就对两种中文都算 —— 译过去也是原样。
 *
 * 其余语言只用检测器给出的可靠结果。
 */
function textLanguages(text: string, textLang: string | null): ReadonlySet<string> | null {
  let cjk = 0;
  let kana = 0;
  let hangul = 0;
  let simplified = 0;
  let traditional = 0;
  let other = 0;
  for (const ch of text) {
    if (KANA.test(ch)) {
      cjk++;
      kana++;
    } else if (HANGUL.test(ch)) {
      cjk++;
      hangul++;
    } else if (HAN.test(ch)) {
      cjk++;
      if (SIMPLIFIED_ONLY.has(ch)) simplified++;
      else if (TRADITIONAL_ONLY.has(ch)) traditional++;
    } else if (LETTER.test(ch)) {
      other++;
    }
  }
  if (cjk > 0 && cjk * 4 >= other) {
    if (kana > 0) return new Set(['ja']);
    if (hangul > 0) return new Set(['ko']);
    if (simplified > traditional) return new Set(['zh-CN']);
    if (traditional > simplified) return new Set(['zh-TW']);
    return new Set(['zh-CN', 'zh-TW']);
  }
  const lang = normalizeLangCode(textLang);
  return lang ? new Set([lang]) : null;
}
