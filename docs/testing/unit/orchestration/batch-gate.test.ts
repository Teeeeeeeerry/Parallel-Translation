/**
 * content 侧在飞批次闸门（#1007，父 #1000）
 *
 * 经编排模块的整页入口与注入的假发送函数断言外部行为：同时在飞多少批、是否
 * 全部发出、还原或失效之后排队中的批次还发不发。不断言闸门内部怎么排队。
 *
 * 假发送函数手动放行：每次调用挂起，直到用例显式放行它，这样能精确卡住
 * “前几批在飞、后面的在排队”那一刻。
 */
import { describe, test, expect } from 'vitest';
import { createPageContext } from '~/src/orchestration/page-context';
import {
  createOrchestrator,
  splitBatches,
  FULL_PAGE_BATCH_LIMITS,
  type TranslateItem,
} from '~/src/orchestration/orchestrator';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import type { TranslateRequest } from '~/src/engines/types';
import { translateItems } from './page-harness';

const items = (n: number, tag = 'u'): TranslateItem<number>[] =>
  Array.from({ length: n }, (_, i) => ({ text: `${tag}${i}`, ctx: i }));

/** 等微任务与 setTimeout(0) 排空 */
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Pending {
  req: TranslateRequest;
  release: (resp?: unknown) => void;
}

function harness(maxConcurrency: number) {
  let inFlight = 0;
  let peak = 0;
  let settingsListener: ((s: typeof settings) => void) | null = null;
  const pending: Pending[] = [];
  const sent: string[][] = [];
  const send = (req: TranslateRequest) =>
    new Promise<unknown>((resolve) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      sent.push(req.texts);
      pending.push({
        req,
        release: (resp) => {
          inFlight--;
          resolve(resp ?? { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
        },
      });
    });
  const settings = { ...DEFAULT_SETTINGS, maxConcurrency };
  const orch = createOrchestrator({
    send,
    subscribeSettings: (fn) => {
      settingsListener = fn;
      return () => {
        settingsListener = null;
      };
    },
    // 退避不真等
    sleep: async () => {},
    context: createPageContext({
      getSettings: () => settings,
      getHostname: () => 'example.com',
    }),
  });
  orch.start();
  /** 放行当前所有在飞的批次，直到没有新的批次发出 */
  const drain = async () => {
    for (let guard = 0; guard < 1000; guard++) {
      await flush();
      const batch = pending.splice(0);
      if (batch.length === 0) return;
      batch.forEach((p) => p.release());
    }
    throw new Error('drain 没有收敛');
  };
  /** 模拟用户在设置页改并发数（storage 变更推给订阅者） */
  const changeConcurrency = (n: number) => {
    settings.maxConcurrency = n;
    settingsListener?.({ ...settings });
  };
  /** 从此刻起重新计峰值 */
  const resetPeak = () => {
    peak = inFlight;
  };
  return {
    orch, sent, pending, drain, peak: () => peak, settings, changeConcurrency, resetPeak,
    inFlight: () => inFlight,
  };
}

/** 切出来的批次数（不写死，跟着闸值走） */
const batchCount = (n: number) => splitBatches(items(n), FULL_PAGE_BATCH_LIMITS).length;

describe('content 侧在飞批次闸门（#1007）', () => {
  test('同时在飞的批次数不超过并发数设置，所有批次最终都发出', async () => {
    const h = harness(3);
    const input = items(200);
    expect(batchCount(200)).toBeGreaterThan(3);
    const done = translateItems(h.orch, input, 'en', 'zh-CN');
    await flush();
    // 一开始只放进并发数那么多批
    expect(h.pending).toHaveLength(3);
    await h.drain();
    const summary = await done;
    expect(summary.allFailed).toBe(false);
    expect(h.peak()).toBe(3);
    // 全部发出、一个不漏、顺序与采集一致
    expect(h.sent).toHaveLength(batchCount(200));
    expect(h.sent.flat()).toEqual(input.map((it) => it.text));
  });

  test('还原发生在批次排队时：放行那一刻直接作废，不再发出', async () => {
    const h = harness(2);
    const done = translateItems(h.orch, items(200), 'en', 'zh-CN');
    await flush();
    expect(h.sent).toHaveLength(2);
    // 前两批在飞，其余在排队 —— 此刻用户点了还原
    h.orch.abort();
    await h.drain();
    const summary = await done;
    expect(summary.abandoned).toBe(true);
    // 排队的那些一批都没发出去
    expect(h.sent).toHaveLength(2);
  });

  test('其他批次判了失效：排队中的批次放行时作废，不再发出', async () => {
    const h = harness(2);
    const done = translateItems(h.orch, items(200), 'en', 'zh-CN');
    await flush();
    expect(h.sent).toHaveLength(2);
    // 第一批回来是失效（上下文失效 / 配额耗尽）
    h.pending.shift()!.release({ ok: false, error: '扩展上下文已失效', invalidated: true });
    await h.drain();
    const summary = await done;
    expect(summary.invalidated).toBe(true);
    expect(h.sent).toHaveLength(2);
  });

  test('整页翻译与增量补翻共用同一道闸门：两路同时跑，在飞总数仍不超过设置', async () => {
    const h = harness(3);
    const a = translateItems(h.orch, items(120, 'a'), 'en', 'zh-CN');
    const b = translateItems(h.orch, items(120, 'b'), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(3);
    await h.drain();
    await Promise.all([a, b]);
    expect(h.peak()).toBe(3);
    expect(h.sent).toHaveLength(2 * batchCount(120));
  });

  test('并发数取翻译开始时的设置值', async () => {
    const h = harness(6);
    h.settings.maxConcurrency = 4;
    const done = translateItems(h.orch, items(200), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(4);
    await h.drain();
    await done;
    expect(h.peak()).toBe(4);
  });
});

describe('翻译途中改并发数，在飞上限跟着变（#1008）', () => {
  test('调大：排队的批次立刻放行到新上限，之后峰值符合新上限', async () => {
    const h = harness(2);
    const done = translateItems(h.orch, items(300), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(2);
    expect(h.peak()).toBe(2);
    h.changeConcurrency(5);
    await flush();
    // 没有任何一批返回，排队的就已经补到 5 批在飞
    expect(h.pending).toHaveLength(5);
    await h.drain();
    await done;
    expect(h.peak()).toBe(5);
    expect(h.sent).toHaveLength(batchCount(300));
  });

  test('调小：已在飞的照常跑完不被砍断，之后在飞数降到新上限以内', async () => {
    const h = harness(5);
    const done = translateItems(h.orch, items(300), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(5);
    h.changeConcurrency(2);
    await flush();
    // 在飞的 5 批不受影响，也没有新批次放进来
    expect(h.pending).toHaveLength(5);
    const sentAtChange = h.sent.length;
    // 放行其中 3 批：在飞降到 2，名额仍满，不放新批次
    h.pending.splice(0, 3).forEach((p) => p.release());
    await flush();
    expect(h.sent).toHaveLength(sentAtChange);
    expect(h.inFlight()).toBe(2);
    // 从这里起峰值不超过新上限
    h.resetPeak();
    await h.drain();
    const summary = await done;
    expect(summary.allFailed).toBe(false);
    expect(h.peak()).toBe(2);
    expect(h.sent).toHaveLength(batchCount(300));
  });

  test('改设置不重建闸门：改完之后再来一路增量补翻，两路在飞总数仍只受新上限约束', async () => {
    const h = harness(3);
    const a = translateItems(h.orch, items(300, 'a'), 'en', 'zh-CN');
    await flush();
    h.changeConcurrency(4);
    await flush();
    expect(h.pending).toHaveLength(4);
    // 重建闸门的话：旧闸门里 a 的批次照旧占着名额，b 进新闸门再占 4 个，在飞翻倍
    const b = translateItems(h.orch, items(300, 'b'), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(4);
    await h.drain();
    await Promise.all([a, b]);
    expect(h.peak()).toBe(4);
  });
});
