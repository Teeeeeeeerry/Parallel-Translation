/**
 * runtime/batch-retry.ts — 批次级「发送 → 失败重试」策略 单元测试
 *
 * #91：引擎级失败有界重试（LIMIT=2，延迟 [1000, 3000]ms），
 * 初始翻译与增量翻译共用，瞬时故障后自愈。
 *
 * #111：扩展上下文失效不可恢复 —— 必须 0 次重试立即失败，
 * 否则 toast 仍延迟约 4 秒（重试序列 [1000, 3000]ms），
 * 与 #109「立即失败」的字面承诺不符。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  attemptBatchWithRetry,
  BATCH_RETRY_LIMIT,
  BATCH_RETRY_DELAYS_MS,
} from '~/src/runtime/batch-retry';
import { CONTEXT_INVALIDATED_MSG } from '~/src/runtime/messaging';

const noopSleep = () => Promise.resolve();
const TRANSLATED = { translations: ['你好'] };

describe('attemptBatchWithRetry — 成功路径', () => {
  test('首次发送即成功 → ok，发送 1 次', async () => {
    const send = vi.fn(async () => ({ ok: true, data: TRANSLATED }));
    const result = await attemptBatchWithRetry(send);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(TRANSLATED);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('引擎级失败后重试成功（#91 自愈）', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '引擎 A 失败' })
      .mockResolvedValueOnce({ ok: true, data: TRANSLATED });
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(true);
    // 1 次失败 + 1 次重试成功
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('attemptBatchWithRetry — 重试预算（#91）', () => {
  test(`持续引擎级失败 → 共发送 ${BATCH_RETRY_LIMIT + 1} 次后失败，invalidated=false`, async () => {
    const send = vi.fn(async () => ({ ok: false, error: '所有引擎均失败' }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidated).toBe(false);
      expect(result.aborted).toBe(false);
      expect(result.error).toBe('所有引擎均失败');
    }
    expect(send).toHaveBeenCalledTimes(BATCH_RETRY_LIMIT + 1);
  });

  test('重试退避按 BATCH_RETRY_DELAYS_MS 序列推进', async () => {
    const sleeps: number[] = [];
    const send = vi.fn(async () => ({ ok: false, error: '引擎失败' }));
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };

    await attemptBatchWithRetry(send, { sleep });

    expect(sleeps).toEqual(BATCH_RETRY_DELAYS_MS.slice(0, BATCH_RETRY_LIMIT));
  });
});

describe('attemptBatchWithRetry — 上下文失效立即失败（#111）', () => {
  test('失效错误 → 0 次重试，invalidated=true，仅发送 1 次', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: CONTEXT_INVALIDATED_MSG,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidated).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.error).toContain('已失效');
    }
    // #111 关键断言：失效错误不得进入重试序列
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('失效错误路径不 sleep（不空等 [1000, 3000]ms）', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => ({
      ok: false,
      error: CONTEXT_INVALIDATED_MSG,
    }));

    await attemptBatchWithRetry(send, { sleep });

    expect(sleep).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('attemptBatchWithRetry — 中止（还原 / 全局短路）', () => {
  test('shouldAbort 在发送前命中 → aborted，不发送', async () => {
    const send = vi.fn(async () => ({ ok: true, data: TRANSLATED }));
    const result = await attemptBatchWithRetry(send, {
      shouldAbort: () => true,
    });

    expect(result).toEqual({
      ok: false,
      invalidated: false,
      aborted: true,
      error: '',
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('shouldAbort 在发送后命中 → aborted，不渲染、不再重试', async () => {
    const send = vi.fn(async () => ({ ok: false, error: '引擎失败' }));
    let calls = 0;
    const result = await attemptBatchWithRetry(send, {
      sleep: noopSleep,
      shouldAbort: () => ++calls > 1, // 第一次尝试前不中止，发送后中止
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.aborted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
