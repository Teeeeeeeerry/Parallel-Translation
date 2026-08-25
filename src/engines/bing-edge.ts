// Phase 2 — Bing Edge 翻译引擎（免 key）。
// 通过 edge.microsoft.com/translate/auth 获取短期 JWT，
// 再调 cognitive.microsofttranslator.com 批量翻译。
// JWT 缓存约 10 分钟，解析 exp 复用，401 清空重取。

import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import type { TranslateEngine } from './types';

// #159: 引擎级并发闸门 —— 整页翻译批次并发 → translate() 并发调用
const getGate = engineGate();

const AUTH_ENDPOINT = 'https://edge.microsoft.com/translate/auth';
const TRANS_ENDPOINT =
  'https://api-edge.cognitive.microsofttranslator.com/translate';

let cachedJwt: string | null = null;
/** 在飞的 auth 请求（single-flight，#159）—— 并发 translate() 首取 JWT
 * 时只发一次 auth 请求，其余调用共享同一个 promise。 */
let jwtPromise: Promise<string> | null = null;

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
  if (!jwtPromise) {
    jwtPromise = (async () => {
      const resp = await fetchWithTimeout('bing-edge', AUTH_ENDPOINT);
      if (!resp.ok) {
        // #250: 类型化类别 —— 免 key 引擎一律瞬时（可重试）
        throw new EngineError('bing-edge', true, `auth HTTP ${resp.status}`, 'transient');
      }
      cachedJwt = await resp.text(); // 返回纯文本 JWT，非 JSON
      return cachedJwt!;
    })().finally(() => {
      // 无论成败都清掉在飞引用，下次调用可重新发起
      jwtPromise = null;
    });
  }
  return jwtPromise;
}

export const bingEdge: TranslateEngine = {
  id: 'bing-edge',
  displayName: 'Microsoft',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    // #159: 整个请求体（含 JWT 获取）过闸门，限制并发在飞请求数
    return getGate()(async () => {
      const jwt = await getJwt();

      // auto → 空字符串（Bing 不接受 'auto' 字面量）
      const fromParam = from === 'auto' ? '' : from;

      const qs = new URLSearchParams({
        from: fromParam,
        to,
        'api-version': '3.0',
        textType: 'html',
      });

      const resp = await fetchWithTimeout('bing-edge', `${TRANS_ENDPOINT}?${qs}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
      });

      if (!resp.ok) {
        // #250: 401 会话失效仍判瞬时（可重试）—— 清 JWT 逻辑保留在
        // 适配器内，不参与错误分类；其余非 2xx 同样瞬时
        if (resp.status === 401) cachedJwt = null;
        throw new EngineError('bing-edge', true, `HTTP ${resp.status}`, 'transient');
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
