// Phase 2 — Google Web 翻译引擎（免 key）。
// 端点 translate.googleapis.com，单次只接受一段文本，批量靠并发多请求；
// 外裹并发闸门防限流。

import { getSettings } from '~/src/storage/settings';
import { createGate } from '~/src/queue/concurrency';
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

  const resp = await fetch(`${ENDPOINT}?${qs}`);
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

export const googleWeb: TranslateEngine = {
  id: 'google-web',
  displayName: 'Google',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const gate = createGate(getSettings().maxConcurrency);
    const translations = await Promise.all(
      texts.map((text) => gate(() => fetchOne(text, from, to))),
    );
    return { translations };
  },
};
