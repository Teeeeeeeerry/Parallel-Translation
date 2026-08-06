// Phase 2 — Google Web 翻译引擎（免 key）。
// 端点 translate.googleapis.com，单次只接受一段文本，批量靠并发多请求；
// 外裹并发闸门防限流。

import { getSettings, onSettingsChanged } from '~/src/storage/settings';
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

// 惰性单例闸门 —— 阶段 3 起同一域名可能有多次并行 route() 调用，
// 每次新建闸门会导致总并发 = 6 × 调用数，限流失效。
// 上限推迟到首次翻译时读取，避免模块 import 时设置尚未加载。
// 设置变更时调 setMax 改上限，保留当前 active 计数与等待队列，
// 避免 gate=null 重建导致两个闸门并发翻倍。
let gate: ReturnType<typeof createGate> | null = null;
function getGate() {
  return (gate ??= createGate(getSettings().maxConcurrency));
}
onSettingsChanged(() => {
  if (gate) gate.setMax(getSettings().maxConcurrency);
  else gate = createGate(getSettings().maxConcurrency);
});

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
