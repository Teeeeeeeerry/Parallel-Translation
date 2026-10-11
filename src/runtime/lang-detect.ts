// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 浏览器自带的本地语言识别（#852，规格 #831）。识别在本地进行，纯 CPU 操作，
// 不发网络请求。
//
// 原来 content 里有两份各自调 chrome.i18n.detectLanguage 的实现：输入翻译的
// 同语言判断（#661）只要单一可靠结果，页面级闸门的取样（#843）要各语言占比
// 与可靠标志。同一个能力并成这一个模块，两个调用方各取所需。浏览器接口经
// 注入，单测用替身，不依赖真实浏览器。
//
// 判定不在这里：页面级闸门拿到占比后由 page-gate.ts 的纯函数判，输入翻译拿到
// 单一结果后由 input-target-lang.ts 判。

import type { ContentLang } from '~/src/orchestration/page-gate';

/** 识别要用到的浏览器接口，缺省取 chrome.i18n 与 chrome.runtime。 */
export interface LangDetectApi {
  detectLanguage: (
    text: string,
    callback: (result: chrome.i18n.LanguageDetectionResult) => void,
  ) => void;
  /** 回调期间的 chrome.runtime.lastError */
  lastError: () => unknown;
}

export interface LangDetector {
  /**
   * 识别器对这段文字的可靠结果（#661）：可靠时给第一个语言；不可靠、拿不到
   * 或出错时为 null。
   */
  reliableLang: (text: string) => Promise<string | null>;
  /**
   * 识别器对这段样本的结果（#843）：原样给出各语言占比与可靠标志，可靠与否
   * 都给；拿不到或出错时为 null。
   */
  distribution: (sample: string) => Promise<ContentLang | null>;
}

const chromeApi: LangDetectApi = {
  detectLanguage: (text, callback) => chrome.i18n.detectLanguage(text, callback),
  lastError: () => chrome.runtime.lastError,
};

export function createLangDetector(api: LangDetectApi = chromeApi): LangDetector {
  return {
    reliableLang: (text) =>
      new Promise((resolve) => {
        try {
          api.detectLanguage(text, (r) => {
            const reliable = !api.lastError() && r?.isReliable;
            resolve(reliable ? (r.languages[0]?.language ?? null) : null);
          });
        } catch {
          resolve(null);
        }
      }),
    distribution: (sample) =>
      new Promise((resolve) => {
        try {
          api.detectLanguage(sample, (r) => {
            if (api.lastError() || !r) return resolve(null);
            resolve({
              reliable: r.isReliable,
              languages: r.languages.map((l) => ({ lang: l.language, percentage: l.percentage })),
            });
          });
        } catch {
          resolve(null);
        }
      }),
  };
}
