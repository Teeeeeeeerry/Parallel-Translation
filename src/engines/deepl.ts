// Phase 7 — DeepL 翻译引擎（BYOK）。
// 免费版与 Pro 版端点不同，靠 key 后缀 ':fx' 区分。
// DeepL 语言覆盖有限，supportedLangs 必须显式列举。

import { getKey } from '~/src/storage/keys';
import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import type { TranslateEngine } from './types';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

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
    // #159: 整个请求体过闸门，限制并发在飞请求数
    return getGate()(async () => {
      const key = await getKey('deepl');
      if (!key)
        throw new EngineError('deepl', false, '未配置 API key', 'invalid-key');

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

      const resp = await fetchWithTimeout('deepl', endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      // #249: 类型化类别 —— 401/403 → key 无效；429 → 配额（免费额度
      // 耗尽，不重试）；其余非 2xx → 瞬时（可重试，降级下一引擎）
      if (resp.status === 403 || resp.status === 401) {
        throw new EngineError('deepl', false, 'API key 无效', 'invalid-key');
      }
      if (resp.status === 429) {
        throw new EngineError('deepl', false, '配额已用尽', 'quota', true);
      }
      if (!resp.ok) {
        throw new EngineError('deepl', true, `HTTP ${resp.status}`, 'transient');
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
    });
  },
};
