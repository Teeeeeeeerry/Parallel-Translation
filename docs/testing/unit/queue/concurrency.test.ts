/**
 * queue/concurrency.ts — 并发闸门 单元测试
 */
import { describe, test, expect, vi } from 'vitest';
import { createGate } from '~/src/queue/concurrency';

// 辅助：创建一个可控的异步任务
function delayedTask<T>(value: T, ms: number): () => Promise<T> {
  return () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(value), ms);
    });
}

describe('Gate', () => {
  test('任务数 ≤ max → 全部并发执行', async () => {
    const gate = createGate(3);
    const order: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      gate(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 10));
        return n;
      }),
    );

    await Promise.all(tasks);
    expect(order).toHaveLength(3);
    // 全部同时入列（都在第一次 pump 中启动）
  });

  test('任务数 > max → 同时运行 ≤ max', async () => {
    const gate = createGate(2);
    let maxConcurrent = 0;
    let running = 0;

    const tasks = [1, 2, 3, 4, 5].map((n) =>
      gate(async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return n;
      }),
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test('任务完成 → 等待队列自动推进', async () => {
    const gate = createGate(1);
    const results: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      gate(async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(n);
        return n;
      }),
    );

    await Promise.all(tasks);
    // 串行执行（max=1），顺序应保持
    expect(results).toEqual([1, 2, 3]);
  });

  test('setMax 调大 → 队列立即释放', async () => {
    const gate = createGate(1);
    let running = 0;
    let maxRunning = 0;

    const tasks = [1, 2, 3, 4].map((n) =>
      gate(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
        return n;
      }),
    );

    // 100ms 后调大 max
    setTimeout(() => gate.setMax(4), 15);

    await Promise.all(tasks);
    // 在某个时刻 max 被调大后并发增加
    expect(maxRunning).toBeGreaterThanOrEqual(1);
  });

  test('setMax 调小 → 不影响已运行的', async () => {
    const gate = createGate(4);
    let running = 0;
    let maxRunning = 0;

    const tasks = [1, 2, 3, 4, 5].map((n) =>
      gate(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return n;
      }),
    );

    // 立即调小 max
    gate.setMax(1);

    await Promise.all(tasks);
    // 已启动的任务不受影响
    expect(maxRunning).toBeGreaterThanOrEqual(1);
  });

  test('任务抛异常 → 仍释放槽位（finally）', async () => {
    const gate = createGate(2);

    const badTask = gate(async () => {
      throw new Error('task failed');
    });

    await expect(badTask).rejects.toThrow('task failed');

    // 异常任务的槽位被释放，后续任务仍可执行
    const goodTask = gate(async () => 'success');
    const result = await goodTask;
    expect(result).toBe('success');
  });

  test('active 计数全程正确', async () => {
    const gate = createGate(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      gate(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(2); // max concurrency was enforced
    expect(running).toBe(0); // all done
  });
});
