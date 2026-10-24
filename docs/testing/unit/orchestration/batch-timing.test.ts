/**
 * 每批的三段耗时（#1083，父 #1071）：观测用，不改行为
 *
 * 注入 onBatchTiming 才测：每批每次尝试记一条，带 content 侧发送闸门排队的时长，
 * 以及发送层带回的后台排队、引擎调用、消息层耗时与超时次数。没注入时发送层收到
 * 的参数与改动前相同，结果一个字段都不多。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator, type BatchTimingRecord, type TranslateItem } from '~/src/orchestration/orchestrator';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import type { TranslateRequest } from '~/src/engines/types';
import { translateItems } from './page-harness';

const items = (n: number): TranslateItem<number>[] => Array.from({ length: n }, (_, i) => ({ text: `t${i}`, ctx: i }));

describe('批次耗时（#1083）', () => {
  test('注入时每批每次尝试一条：排队时长、条数与字数、发送层带回的后台两段', async () => {
    const records: BatchTimingRecord[] = [];
    const send = vi.fn(async (req: TranslateRequest, ctl?: { timing?: boolean }) => ({
      ok: true,
      data: { translations: req.texts },
      ...(ctl?.timing && { timing: { sendMs: 12, attempts: 1, timeouts: 0, bgQueueMs: 3, engineMs: 9 } }),
    }));
    const orch = createOrchestrator({
      send,
      onBatchTiming: (r) => records.push(r),
      getSettings: () => ({ ...DEFAULT_SETTINGS, maxConcurrency: 1 }),
      getHostname: () => 'example.com',
    });
    orch.start();
    await translateItems(orch, items(25), 'en', 'zh-CN');
    expect(records).toHaveLength(2);
    expect(records.map((r) => [r.batch, r.attempt, r.items])).toEqual([
      [0, 0, 20],
      [1, 0, 5],
    ]);
    expect(records[0]).toMatchObject({ ok: true, chars: 50, sendMs: 12, bgQueueMs: 3, engineMs: 9, timeouts: 0 });
    for (const r of records) expect(r.contentQueueMs).toBeGreaterThanOrEqual(0);
  });

  test('切批重试的每次尝试各记一条，attempt 递增', async () => {
    const records: BatchTimingRecord[] = [];
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'HTTP 503', category: 'transient' })
      .mockResolvedValue({ ok: true, data: { translations: ['x'] } });
    const orch = createOrchestrator({ send, onBatchTiming: (r) => records.push(r), sleep: async () => {} });
    orch.start();
    await translateItems(orch, items(1), 'en', 'zh-CN');
    expect(records.map((r) => [r.attempt, r.ok])).toEqual([
      [0, false],
      [1, true],
    ]);
  });

  test('没注入：发送层只收到中止信号，不要耗时', async () => {
    const send = vi.fn(async (req: TranslateRequest, _ctl?: unknown) => ({ ok: true, data: { translations: req.texts } }));
    const orch = createOrchestrator({ send });
    orch.start();
    await translateItems(orch, items(1), 'en', 'zh-CN');
    expect(send.mock.calls[0]![1]).toEqual({ signal: expect.any(AbortSignal) });
  });
});
