// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 7 — DeepL 翻译引擎（BYOK）。
// 免费版与 Pro 版端点不同，靠 key 后缀 ':fx' 区分。
// DeepL 语言覆盖有限，supportedLangs 必须显式列举。
//
// #334: 骨架（闸门 / 取 key / 分类抛错）走公共构造 createByokEngine，
// 本文件只保留端点区分、语言码归一化、请求构造、响应解析。

import { createByokEngine } from './byok';
import type { ProbeSpec } from './shared';
import type { TranslateEngine } from './types';

/** 免费版 key 以 :fx 结尾，必须走 free 端点 */
function endpointFor(key: string): string {
  return key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

/** 连通性探测规格（#321）：GET /v2/usage，免费版与专业版端点区分不变。 */
export const deeplProbe: ProbeSpec = {
  engineId: 'deepl',
  buildRequest: ({ key }) => ({
    url: endpointFor(key).replace('/v2/translate', '/v2/usage'),
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
  }),
};

// DeepL 使用 'EN' / 'ZH' 大写格式，尝试标准化（#334：语言码归一化不变）
function normalizeLang(code: string): string {
  // 'auto' → null（让 DeepL 自动检测）
  if (code === 'auto') return '';
  // DeepL API v2 不接受带国家后缀的中文码，官方只认 ZH / ZH-HANS / ZH-HANT（#155）
  if (code === 'zh-CN') return 'ZH-HANS';
  if (code === 'zh-TW') return 'ZH-HANT';
  return code.toUpperCase();
}

export const deepl: TranslateEngine = createByokEngine({
  id: 'deepl',
  displayName: 'DeepL',
  // DeepL 语言覆盖有限，必须显式列出 —— router 依此在不支持时跳过
  supportedLangs: [
    'zh',
    'zh-CN',
    'zh-TW',
    'en',
    'en-US',
    'en-GB',
    'ja',
    'ko',
    'fr',
    'de',
    'es',
    'ru',
    'pt',
    'pt-BR',
    'pt-PT',
    'it',
    'nl',
    'pl',
    'bg',
    'cs',
    'da',
    'el',
    'et',
    'fi',
    'hu',
    'id',
    'lt',
    'lv',
    'ro',
    'sk',
    'sl',
    'sv',
    'tr',
    'uk',
    'nb',
  ],

  // 请求格式与改造前完全一致（#334）
  buildRequest: ({ texts, from, to }, key) => {
    const body = new URLSearchParams();
    body.append('target_lang', normalizeLang(to) || to.toUpperCase());
    if (from !== 'auto') body.append('source_lang', normalizeLang(from));
    for (const text of texts) {
      body.append('text', text);
    }
    return {
      url: endpointFor(key),
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    };
  },

  parseResponse: (data) => {
    const translations: string[] = (
      data as { translations: Array<{ text: string }> }
    ).translations.map((t) => t.text);
    const detectedFrom = (
      data as { translations?: Array<{ detected_source_language?: string }> }
    ).translations?.[0]?.detected_source_language;
    return { translations, detectedFrom };
  },
});
