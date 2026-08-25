/**
 * runtime/batch-retry.ts — 批次级「发送 → 失败重试」策略 单元测试
 *
 * #91：引擎级失败有界重试（LIMIT=2，延迟 [1000, 3000]ms），
 * 初始翻译与增量翻译共用，瞬时故障后自愈。
 *
 * #111：扩展上下文失效不可恢复 —— 必须 0 次重试立即失败，
 * 否则 toast 仍延迟约 4 秒（重试序列 [1000, 3000]ms），
 * 与 #109「立即失败」的字面承诺不符。
 *
 * #116：失效判定基于 messaging 透出的类型化 invalidated 标志，
 * 与错误文案解耦 —— 文案改写不影响短路行为。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  attemptBatchWithRetry,
  BATCH_RETRY_LIMIT,
  BATCH_RETRY_DELAYS_MS,
} from '~/src/runtime/batch-retry';

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

describe('attemptBatchWithRetry — 不可恢复错误（#180 → #263）', () => {
  test('category=invalid-key → 立即失败，0 次重试', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: 'API key 无效',
      category: 'invalid-key' as const,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key 无效');
      expect(result.invalidated).toBe(false);
      expect(result.aborted).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('缺省类别 → 按可重试处理（默认行为不变）', async () => {
    const send = vi.fn(async () => ({ ok: false, error: '瞬时故障' }));
    await attemptBatchWithRetry(send, { sleep: noopSleep });
    expect(send).toHaveBeenCalledTimes(BATCH_RETRY_LIMIT + 1);
  });

  test('旧字段 retryable=false 已清理：无类别时不再短路（#263）', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: 'API key 无效',
      retryable: false,
    }));
    // 旧形态不再生效 —— 按可重试处理进入重试序列
    await attemptBatchWithRetry(send, { sleep: noopSleep });
    expect(send).toHaveBeenCalledTimes(BATCH_RETRY_LIMIT + 1);
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

describe('attemptBatchWithRetry — 上下文失效立即失败（#111/#116）', () => {
  test('invalidated 标志 → 0 次重试，仅发送 1 次', async () => {
    // #116: 判定依据是类型化 invalidated 标志而非错误文案 ——
    // 故意用与 CONTEXT_INVALIDATED_MSG 不同的文案证明解耦
    const send = vi.fn(async () => ({
      ok: false,
      invalidated: true,
      error: '扩展已重载，请刷新页面',
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidated).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.error).toBe('扩展已重载，请刷新页面');
    }
    // #111 关键断言：失效错误不得进入重试序列
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('失效路径不 sleep（不空等 [1000, 3000]ms）', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async () => ({
      ok: false,
      invalidated: true,
      error: '上下文失效',
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

  test('重试预算耗尽后的最后一次失败也查中止（#157 边界）', async () => {
    // 还原恰在「最后一次尝试失败」与「返回」之间发生：shouldAbort
    // 前 BATCH_RETRY_LIMIT+1 次（每次尝试的前/后检查）都返回 false，
    // 最后一次失败后才变 true —— 必须报 aborted 而不是 failed
    const send = vi.fn(async () => ({ ok: false, error: '引擎失败' }));
    let calls = 0;
    const result = await attemptBatchWithRetry(send, {
      sleep: noopSleep,
      // 每次尝试有前/后两次检查：(LIMIT+1) 次尝试共 6 次检查全放行，
      // 第 7 次（预算耗尽后的最终返回检查）才命中 —— 证明该边界
      shouldAbort: () => ++calls > (BATCH_RETRY_LIMIT + 1) * 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.invalidated).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(BATCH_RETRY_LIMIT + 1);
  });
});

describe('attemptBatchWithRetry — 新字段优先（#246）', () => {
  test('category=invalid-key（新字段）→ 立即失败，0 次重试', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: 'API key 无效',
      retryable: false,
      category: 'invalid-key' as const,
      invalidated: false,
      aborted: false,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('API key 无效');
      expect(result.invalidated).toBe(false);
      expect(result.aborted).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('category=quota（新字段）→ 立即失败，0 次重试', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: '配额已用尽',
      retryable: false,
      category: 'quota' as const,
      invalidated: true,
      aborted: false,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('aborted=true（新字段）→ 立即停止，报 aborted 不记失败', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: '已中止',
      retryable: true,
      category: 'transient' as const,
      invalidated: false,
      aborted: true,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.aborted).toBe(true);
      expect(result.invalidated).toBe(false);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('category=transient（新字段）→ 照常进入重试序列', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: '瞬时故障',
        retryable: true,
        category: 'transient' as const,
        invalidated: false,
        aborted: false,
      })
      .mockResolvedValueOnce({ ok: true, data: TRANSLATED });
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

});

describe('BatchRetryResult 类别透传（#247）', () => {
  test('invalid-key 失败 → 结果携带 category，供渲染层分支提示', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: 'API key 无效',
      retryable: false,
      category: 'invalid-key' as const,
      invalidated: false,
      aborted: false,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('invalid-key');
      expect(result.error).toBe('API key 无效');
    }
  });

  test('quota 失败 → 结果携带 category（invalidated 短路分支）', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      error: '配额已用尽',
      retryable: false,
      category: 'quota' as const,
      invalidated: true,
      aborted: false,
    }));
    const result = await attemptBatchWithRetry(send, { sleep: noopSleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidated).toBe(true);
      expect(result.category).toBe('quota');
    }
  });
});
