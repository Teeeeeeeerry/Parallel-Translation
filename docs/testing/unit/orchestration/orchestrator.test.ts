/**
 * orchestration/orchestrator.ts — 翻译编排模块骨架 单元测试（#245）
 *
 * 假消息层断言：批次拆分与现状一致（每批 ≤ FULL_PAGE_BATCH_SIZE、
 * 余数进最后一批）、发送回调次数 = 批次数、单测不触碰 chrome。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  createOrchestrator,
  splitBatches,
  FULL_PAGE_BATCH_SIZE,
} from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import type { TranslateRequest } from '~/src/engines/types';

function items(n: number): TranslateItem<number>[] {
  return Array.from({ length: n }, (_, i) => ({ text: `text-${i}`, ctx: i }));
}

describe('splitBatches — 批次拆分', () => {
  test('恰好一批：数量 ≤ 批次大小', () => {
    const batches = splitBatches(items(10), FULL_PAGE_BATCH_SIZE);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((b) => b.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `text-${i}`),
    );
  });

  test('40 项 → 3 批（15/15/10）：前 N-1 批满额，余数进最后一批', () => {
    const batches = splitBatches(items(40), FULL_PAGE_BATCH_SIZE);
    expect(batches.map((b) => b.length)).toEqual([15, 15, 10]);
  });

  test('批次顺序与文本顺序一致', () => {
    const batches = splitBatches(items(31), FULL_PAGE_BATCH_SIZE);
    const all = batches.flatMap((b) => b.map((x) => x.text));
    expect(all).toEqual(Array.from({ length: 31 }, (_, i) => `text-${i}`));
  });

  test('空数组 → 0 批', () => {
    expect(splitBatches([], FULL_PAGE_BATCH_SIZE)).toEqual([]);
  });
});

describe('createOrchestrator — 假消息层', () => {
  test('translatePage：发送回调次数 = 批次数，每批文本正确', async () => {
    const send = vi.fn(async (_req: TranslateRequest) => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    orch.start();

    await orch.translatePage(items(40), 'en', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]![0]).toEqual({
      texts: Array.from({ length: 15 }, (_, i) => `text-${i}`),
      from: 'en',
      to: 'zh-CN',
    });
    expect(send.mock.calls[2]![0]!.texts).toHaveLength(10);
    expect(send.mock.calls[2]![0]!.texts[9]).toBe('text-39');
  });

  test('自定义 batchSize 生效', async () => {
    const send = vi.fn(async (_req: TranslateRequest) => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send, batchSize: 7 });
    orch.start();

    await orch.translatePage(items(16), 'auto', 'zh');
    expect(send.mock.calls.map((c) => c[0]!.texts.length)).toEqual([7, 7, 2]);
  });

  test('未启动 → 翻译入口抛错', async () => {
    const send = vi.fn(async (_req: TranslateRequest) => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    await expect(orch.translatePage(items(1), 'en', 'zh')).rejects.toThrow(
      '未启动',
    );
    expect(send).not.toHaveBeenCalled();
  });

  test('stop 后翻译入口不再发送', async () => {
    const send = vi.fn(async (_req: TranslateRequest) => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    orch.start();
    orch.stop();
    await expect(orch.translatePage(items(1), 'en', 'zh')).rejects.toThrow(
      '未启动',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
