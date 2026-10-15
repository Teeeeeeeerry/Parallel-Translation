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
import {
  createOrchestrator,
  splitBatches,
  FULL_PAGE_BATCH_LIMITS,
  type TranslateItem,
} from '~/src/orchestration/orchestrator';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import type { TranslateRequest } from '~/src/engines/types';

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
    getSettings: () => settings,
    getHostname: () => 'example.com',
    // 退避不真等
    sleep: async () => {},
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
  return { orch, sent, pending, drain, peak: () => peak, settings };
}

/** 切出来的批次数（不写死，跟着闸值走） */
const batchCount = (n: number) => splitBatches(items(n), FULL_PAGE_BATCH_LIMITS).length;

describe('content 侧在飞批次闸门（#1007）', () => {
  test('同时在飞的批次数不超过并发数设置，所有批次最终都发出', async () => {
    const h = harness(3);
    const input = items(200);
    expect(batchCount(200)).toBeGreaterThan(3);
    const done = h.orch.translatePage(input, 'en', 'zh-CN');
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
    const done = h.orch.translatePage(items(200), 'en', 'zh-CN');
    await flush();
    expect(h.sent).toHaveLength(2);
    // 前两批在飞，其余在排队 —— 此刻用户点了还原
    h.orch.abort();
    await h.drain();
    const summary = await done;
    expect(summary.aborted).toBe(true);
    // 排队的那些一批都没发出去
    expect(h.sent).toHaveLength(2);
  });

  test('其他批次判了失效：排队中的批次放行时作废，不再发出', async () => {
    const h = harness(2);
    const done = h.orch.translatePage(items(200), 'en', 'zh-CN');
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
    const a = h.orch.translatePage(items(120, 'a'), 'en', 'zh-CN');
    const b = h.orch.translatePage(items(120, 'b'), 'en', 'zh-CN');
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
    const done = h.orch.translatePage(items(200), 'en', 'zh-CN');
    await flush();
    expect(h.pending).toHaveLength(4);
    await h.drain();
    await done;
    expect(h.peak()).toBe(4);
  });
});
