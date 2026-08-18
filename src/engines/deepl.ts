// Phase 7 — DeepL 翻译引擎（BYOK）。
// 免费版与 Pro 版端点不同，靠 key 后缀 ':fx' 区分。
// DeepL 语言覆盖有限，supportedLangs 必须显式列举。

import { getKey } from '~/src/storage/keys';
import { EngineError } from './types';
import type { TranslateEngine } from './types';

/** 免费版 key 以 :fx 结尾，必须走 free 端点 */
function endpointFor(key: string): string {
  return key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

export const deepl: TranslateEngine = {
  id: 'deepl',
  displayName: 'DeepL',
  requiresKey: true,
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

  async translate({ texts, from, to }) {
    const key = await getKey('deepl');
    if (!key) throw new EngineError('deepl', false, '未配置 API key');

    const endpoint = endpointFor(key);

    // DeepL 使用 'EN' / 'ZH' 大写格式，尝试标准化
    const normalizeLang = (code: string): string => {
      // 'auto' → null（让 DeepL 自动检测）
      if (code === 'auto') return '';
      // DeepL API v2 不接受带国家后缀的中文码，官方只认 ZH / ZH-HANS / ZH-HANT（#155）
      if (code === 'zh-CN') return 'ZH-HANS';
      if (code === 'zh-TW') return 'ZH-HANT';
      return code.toUpperCase();
    };

    const body = new URLSearchParams();
    body.append('target_lang', normalizeLang(to) || to.toUpperCase());
    if (from !== 'auto') body.append('source_lang', normalizeLang(from));
    for (const text of texts) {
      body.append('text', text);
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (resp.status === 403 || resp.status === 401) {
      throw new EngineError('deepl', false, 'API key 无效');
    }
    if (!resp.ok) {
      throw new EngineError('deepl', true, `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const translations: string[] = (
      data.translations as Array<{ text: string }>
    ).map((t) => t.text);
    const detectedFrom =
      data.translations?.[0]?.detected_source_language as
        | string
        | undefined;

    return { translations, detectedFrom };
  },
};
