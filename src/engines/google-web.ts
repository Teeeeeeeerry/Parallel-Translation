// Phase 2 — Google Web 翻译引擎（免 key）。
// 端点 translate.googleapis.com，单次只接受一段文本，批量靠并发多请求；
// 外裹并发闸门防限流。

import { fetchWithTimeout } from './fetch-timeout';
import { engineGate } from './engine-gate';
import { EngineError } from './types';
import type { TranslateEngine } from './types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

async function fetchOne(
  text: string,
  from: string,
  to: string,
): Promise<string> {
  const qs = new URLSearchParams({
    client: 'gtx',
    sl: from,
    tl: to,
    dt: 't',
    strip: '1',
    nonced: '1',
    q: text,
  });

  const resp = await fetchWithTimeout('google-web', `${ENDPOINT}?${qs}`);
  if (!resp.ok) {
    throw new EngineError('google-web', true, `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  // data[0] 是分句数组，每项 [0] 为该句译文
  const parts: string[] = [];
  for (const seg of data[0] as any[]) {
    if (seg?.[0]) parts.push(seg[0]);
  }
  return parts.join('');
}

// #159: 惰性单例闸门（引擎公共层）—— 阶段 3 起同一域名可能有多次
// 并行 route() 调用，每次新建闸门会导致总并发 = 6 × 调用数，限流失效。
const getGate = engineGate();

export const googleWeb: TranslateEngine = {
  id: 'google-web',
  displayName: 'Google',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const results = await Promise.allSettled(
      texts.map((text) => getGate()(() => fetchOne(text, from, to))),
    );

    const translations: string[] = [];
    const failedIndices: number[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'fulfilled') {
        translations[i] = r.value;
      } else {
        translations[i] = '';
        failedIndices.push(i);
      }
    }

    // 全部失败 → 抛出让 router 整体切换到下一个引擎
    if (failedIndices.length === texts.length) {
      throw new EngineError('google-web', true, `全部 ${texts.length} 条翻译失败`);
    }

    return {
      translations,
      failedIndices: failedIndices.length > 0 ? failedIndices : undefined,
    };
  },
};
