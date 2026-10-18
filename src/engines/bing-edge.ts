// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 2 — Bing Edge 翻译引擎（免 key）。
// #1021: 原来的两步走（edge.microsoft.com/translate/auth 取短期 JWT，再带 Bearer
// 调 api-edge.cognitive.microsofttranslator.com）在 2026 年 8 月前后断了：auth 端点
// 一律 404，翻译端点不带令牌 401。Edge 自己改走同主机的 translatetext 端点，
// 不要令牌，一次 POST 拿译文。它同样是没有承诺的内部端点，随时可能再变 ——
// 真实可用性由定时的引擎冒烟检查盯着（#1022）。

import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import { classifyStatus } from './shared';
import type { TranslateEngine } from './types';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

const TRANS_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

/** 超过单次上限时 400 的正文（2026-10-16 实测，text/plain）。 */
const TOO_LARGE_TEXT = 'Request exceeds the maximum allowed translation size';

export const bingEdge: TranslateEngine = {
  id: 'bing-edge',
  displayName: 'Microsoft',
  requiresKey: false,
  supportedLangs: 'all',
  // #387: “不翻译”术语走占位符
  masksNoTranslate: true,

  async translate({ texts, from, to, signal, onGateStart }) {
    // #159: 整个请求过闸门，限制并发在飞请求数
    return getGate()(async () => {
      onGateStart?.();
      // auto → 空字符串（Bing 不接受 'auto' 字面量）
      const fromParam = from === 'auto' ? '' : from;

      // 只认纯文本：带 textType=html 也照纯文本翻（属性引号会被换成弯引号），
      // 与 Google、DeepL 的调用方式一致，送进来的本来就是纯文本
      const qs = new URLSearchParams({
        from: fromParam,
        to,
        isEnterpriseClient: 'false',
      });

      const resp = await fetchWithTimeout('bing-edge', `${TRANS_ENDPOINT}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 请求体是字符串数组，不是 v3 接口的 { Text } 对象
        body: JSON.stringify(texts),
        signal,
      });

      if (!resp.ok) {
        // #1026：超过单次上限（1000 条或 5 万字）回 400，正文是这一句纯文本 ——
        // 确定性失败，不按瞬时处理。别的 400 不划进来：目标语言非法时同样回 400、
        // 正文为空，有些 400 是瞬时的
        if (resp.status === 400 && (await resp.text().catch(() => '')).includes(TOO_LARGE_TEXT)) {
          throw new EngineError('bing-edge', true, 'HTTP 400 请求过大', 'too-large');
        }
        // #259: 分类走公共判定 —— 免 key 引擎一律瞬时（可重试）
        const category = classifyStatus('bing-edge', resp, true);
        throw new EngineError('bing-edge', true, `HTTP ${resp.status}`, category);
      }

      const data = await resp.json();
      const translations: string[] = data.map(
        (d: any) => d.translations[0].text as string,
      );
      const detectedFrom =
        data[0]?.detectedLanguage?.language as string | undefined;

      return { translations, detectedFrom };
    });
  },
};
