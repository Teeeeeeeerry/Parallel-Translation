// Phase 2 — Bing Edge 翻译引擎（免 key）。
// 通过 edge.microsoft.com/translate/auth 获取短期 JWT，
// 再调 cognitive.microsofttranslator.com 批量翻译。
// JWT 缓存约 10 分钟，解析 exp 复用，401 清空重取。

import { EngineError } from './types';
import type { TranslateEngine } from './types';

const AUTH_ENDPOINT = 'https://edge.microsoft.com/translate/auth';
const TRANS_ENDPOINT =
  'https://api-edge.cognitive.microsofttranslator.com/translate';

let cachedJwt: string | null = null;

function isExpired(jwt: string): boolean {
  try {
    const b64 = jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return Math.floor(Date.now() / 1000) >= (payload.exp as number) - 30;
  } catch {
    return true;
  }
}

async function getJwt(): Promise<string> {
  if (cachedJwt && !isExpired(cachedJwt)) return cachedJwt;

  const resp = await fetch(AUTH_ENDPOINT);
  if (!resp.ok) {
    throw new EngineError('bing-edge', true, `auth HTTP ${resp.status}`);
  }
  cachedJwt = await resp.text(); // 返回纯文本 JWT，非 JSON
  return cachedJwt!;
}

export const bingEdge: TranslateEngine = {
  id: 'bing-edge',
  displayName: 'Microsoft',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const jwt = await getJwt();

    // auto → 空字符串（Bing 不接受 'auto' 字面量）
    const fromParam = from === 'auto' ? '' : from;

    const qs = new URLSearchParams({
      from: fromParam,
      to,
      'api-version': '3.0',
      textType: 'html',
    });

    const resp = await fetch(`${TRANS_ENDPOINT}?${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(texts.map((Text) => ({ Text }))),
    });

    if (!resp.ok) {
      if (resp.status === 401) cachedJwt = null;
      throw new EngineError('bing-edge', true, `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const translations: string[] = data.map(
      (d: any) => d.translations[0].text as string,
    );
    const detectedFrom =
      data[0]?.detectedLanguage?.language as string | undefined;

    return { translations, detectedFrom };
  },
};
