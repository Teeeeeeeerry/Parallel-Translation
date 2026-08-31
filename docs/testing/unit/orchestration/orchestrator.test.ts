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
  displayDecision,
  FULL_PAGE_BATCH_SIZE,
} from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import type { TranslateRequest } from '~/src/engines/types';
import type { Settings } from '~/src/storage/schema';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

/** 冲刷微任务 + 一个宏任务，让异步链（send → retry → 回调）完整推进。 */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

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

describe('渐进渲染回调注入（#256）', () => {
  test('每批返回即触发回调，不等待最慢段（批次节奏）', async () => {
    const order: number[] = [];
    let resolveSlow!: () => void;
    const slowResult = { ok: true, data: { translations: ['慢批'] } };
    const fastResult = { ok: true, data: { translations: ['快批'] } };
    const send = vi
      .fn()
      // 第 0 批（慢）：手动控制完成时机
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveSlow = () => r(slowResult);
          }),
      )
      // 第 1 批（快）：立即完成
      .mockImplementation(async () => fastResult);

    const orch = createOrchestrator({
      send,
      onBatchResult: (i) => order.push(i),
    });
    orch.start();

    const pending = orch.translatePage(items(20), 'en', 'zh');
    await Promise.resolve();
    await Promise.resolve();
    // 快批先返回并触发渲染回调 —— 首屏不等最慢段
    expect(order).toEqual([1]);

    resolveSlow();
    await pending;
    expect(order).toEqual([1, 0]);
  });

  test('渲染顺序 = 完成顺序，回调携带批次下标与结果', async () => {
    const seen: Array<[number, string]> = [];
    const send = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false,
        error: '批0失败',
        category: 'invalid-key' as const,
      }))
      .mockImplementationOnce(async () => ({ ok: true, data: { translations: ['批1'] } }));

    const orch = createOrchestrator({
      send,
      sleep: () => Promise.resolve(),
      onBatchResult: (i, _batch, result) => {
        seen.push([i, result.ok ? 'ok' : result.error!]);
      },
    });
    orch.start();

    await orch.translatePage(items(20), 'en', 'zh');
    expect(seen).toEqual([
      [0, '批0失败'],
      [1, 'ok'],
    ]);
  });

  test('未提供渲染回调 → 仅发送（兼容无渲染场景）', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    orch.start();
    await expect(orch.translatePage(items(16), 'en', 'zh')).resolves.toMatchObject({
      allFailed: false,
      aborted: false,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('epoch 中止语义（#262）', () => {
  test('abort 后：在飞批次完成也不触发渲染回调，汇总报 aborted', async () => {
    const order: number[] = [];
    let resolveSlow!: () => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveSlow = () => r({ ok: true, data: { translations: ['慢批'] } });
          }),
      )
      .mockImplementation(async () => ({ ok: true, data: { translations: ['快批'] } }));

    const orch = createOrchestrator({
      send,
      sleep: () => Promise.resolve(),
      onBatchResult: (i) => order.push(i),
    });
    orch.start();

    const pending = orch.translatePage(items(20), 'en', 'zh');
    await flush();
    // 快批已返回并渲染
    expect(order).toEqual([1]);

    // 还原：中止在途翻译
    orch.abort();
    resolveSlow();

    const summary = await pending;
    expect(summary.aborted).toBe(true);
    // 中止后回调不再触发 —— 慢批完成但不渲染（过期译文丢弃）
    expect(order).toEqual([1]);
  });

  test('abort 后新翻译不被旧批次干扰：新翻译正常完成', async () => {
    const order: number[] = [];
    let resolveOld!: () => void;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveOld = () => r({ ok: true, data: { translations: ['旧批'] } });
          }),
      )
      .mockImplementation(async () => ({ ok: true, data: { translations: ['新批'] } }));

    const orch = createOrchestrator({
      send,
      sleep: () => Promise.resolve(),
      onBatchResult: (i) => order.push(i),
    });
    orch.start();

    // 旧翻译在飞
    const oldPending = orch.translatePage(items(20), 'en', 'zh');
    await flush();
    orch.abort();

    // 新翻译开始 —— 不受旧批次干扰
    const newSummary = await orch.translatePage(items(16), 'en', 'zh');
    expect(newSummary.aborted).toBe(false);
    expect(newSummary.allFailed).toBe(false);
    // 新翻译的批次全部渲染
    expect(order).toEqual([1, 0, 1]);

    // 旧翻译收尾：aborted，不渲染
    resolveOld();
    const oldSummary = await oldPending;
    expect(oldSummary.aborted).toBe(true);
    expect(order).toEqual([1, 0, 1]);
  });
});

describe('设置变更订阅（#265）', () => {
  test('start 订阅设置变更、stop 退订；回调转发 onSettingsChange', async () => {
    // #310: 订阅回调类型收紧为真实 Settings（断言与行为不变）
    let handler: ((s: Settings) => void) | null = null;
    let unsubscribed = false;
    const seen: Settings[] = [];
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));

    const orch = createOrchestrator({
      send,
      subscribeSettings: (fn) => {
        handler = fn;
        return () => {
          unsubscribed = true;
        };
      },
      onSettingsChange: (s) => seen.push(s),
    });

    orch.start();
    expect(handler).not.toBeNull();

    handler!({ style: 'bold' } as Settings);
    expect(seen).toEqual([{ style: 'bold' }]);

    orch.stop();
    expect(unsubscribed).toBe(true);
  });

  test('未注入订阅 → start/stop 为空操作', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    expect(() => {
      orch.start();
      orch.stop();
    }).not.toThrow();
  });
});


describe('准入判定（#311）', () => {
  const settings = (patch: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...patch,
  });

  test('黑名单命中：零请求并返回 blocked', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({
          enabled: true,
          siteList: { mode: 'blacklist', list: ['example.com'] },
        }),
      getHostname: () => 'www.example.com',
    });
    orch.start();
    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');
    expect(send).not.toHaveBeenCalled();
    expect(summary.admission).toBe('blocked');
    orch.stop();
  });

  test('白名单未命中：零请求并返回 blocked', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({
          enabled: true,
          siteList: { mode: 'whitelist', list: ['example.com'] },
        }),
      getHostname: () => 'other.example.org',
    });
    orch.start();
    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');
    expect(send).not.toHaveBeenCalled();
    expect(summary.admission).toBe('blocked');
    orch.stop();
  });

  test('总开关关闭：零请求并返回 disabled', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({ enabled: false, siteList: { mode: 'blacklist', list: [] } }),
      getHostname: () => 'example.com',
    });
    orch.start();
    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');
    expect(send).not.toHaveBeenCalled();
    expect(summary.admission).toBe('disabled');
    orch.stop();
  });

  test('准入放行：正常发送并返回 allowed', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({ enabled: true, siteList: { mode: 'blacklist', list: [] } }),
      getHostname: () => 'example.com',
    });
    orch.start();
    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.admission).toBe('allowed');
    orch.stop();
  });

  test('未注入设置读取 / 主机名 → 放行（兼容旧装配）', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send });
    orch.start();
    const summary = await orch.translatePage(items(1), 'en', 'zh-CN');
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.admission).toBe('allowed');
    orch.stop();
  });
});

describe('单文本翻译入口（#312）', () => {
  const settings = (patch: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...patch,
  });

  test('成功时返回译文，且译文未被改写（逐字透传）', async () => {
    const send = vi.fn(async () => ({
      ok: true,
      data: { translations: ['  你好，世界！  '] },
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const result = await orch.translateText('Hello, World!', 'en', 'zh-CN');

    expect(result.ok).toBe(true);
    expect(result.translation).toBe('  你好，世界！  ');
    expect(send).toHaveBeenCalledWith({
      texts: ['Hello, World!'],
      from: 'en',
      to: 'zh-CN',
    });
    orch.stop();
  });

  test('站点被屏蔽：零请求并返回 blocked', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({
          enabled: true,
          siteList: { mode: 'blacklist', list: ['example.com'] },
        }),
      getHostname: () => 'example.com',
    });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(send).not.toHaveBeenCalled();
    expect(result.admission).toBe('blocked');
    expect(result.ok).toBe(false);
    orch.stop();
  });

  test('总开关关闭：零请求并返回 disabled', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({
      send,
      getSettings: () =>
        settings({ enabled: false, siteList: { mode: 'blacklist', list: [] } }),
      getHostname: () => 'example.com',
    });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(send).not.toHaveBeenCalled();
    expect(result.admission).toBe('disabled');
    expect(result.ok).toBe(false);
    orch.stop();
  });

  test('失败时携带类别与原因', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'invalid-key',
      error: 'API key 无效',
      retryable: false,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(result.ok).toBe(false);
    expect(result.category).toBe('invalid-key');
    expect(result.error).toBe('API key 无效');
    orch.stop();
  });

  test('在飞期间被中止（还原递增纪元）→ 不返回译文', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(
      () => new Promise((r) => (resolveSend = r)),
    );
    const orch = createOrchestrator({ send });
    orch.start();

    const pending = orch.translateText('Hello', 'en', 'zh-CN');
    orch.abort(); // 还原：递增纪元
    resolveSend({ ok: true, data: { translations: ['你好'] } });

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.category).toBe('aborted');
    expect(result.translation).toBeUndefined();
    orch.stop();
  });
});

describe('失败提示语义映射（#313）', () => {
  test('单文本：key 无效 → 展示真实原因并携带引擎原因文本', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'invalid-key',
      error: 'API key 无效',
      retryable: false,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(result.ok).toBe(false);
    expect(result.display).toEqual({
      showRealReason: true,
      reason: 'API key 无效',
    });
    orch.stop();
  });

  test('单文本：配额耗尽 → 展示真实原因并携带引擎原因文本', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'quota',
      error: '配额已用尽',
      retryable: false,
      invalidated: true,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(result.ok).toBe(false);
    expect(result.display).toEqual({
      showRealReason: true,
      reason: '配额已用尽',
    });
    orch.stop();
  });

  test('单文本：瞬时故障 → 泛化文案', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'transient',
      error: 'HTTP 503',
      retryable: true,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const result = await orch.translateText('Hello', 'en', 'zh-CN');

    expect(result.ok).toBe(false);
    expect(result.display).toEqual({ showRealReason: false });
    orch.stop();
  });

  test('整页：全部引擎 key 无效 → 汇总展示真实原因', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'invalid-key',
      error: 'API key 无效',
      retryable: false,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');

    expect(summary.allFailed).toBe(true);
    expect(summary.display).toEqual({
      showRealReason: true,
      reason: 'API key 无效',
    });
    orch.stop();
  });

  test('整页：瞬时故障 → 泛化文案', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'transient',
      error: 'HTTP 503',
      retryable: true,
    }));
    const orch = createOrchestrator({ send });
    orch.start();

    const summary = await orch.translatePage(items(2), 'en', 'zh-CN');

    expect(summary.allFailed).toBe(true);
    expect(summary.display).toEqual({ showRealReason: false });
    orch.stop();
  });

  test('整页与单文本共用同一份映射（displayDecision 模块级单测）', () => {
    // 同一份映射函数被两个入口共用（#313）
    expect(displayDecision('invalid-key', 'API key 无效')).toEqual({
      showRealReason: true,
      reason: 'API key 无效',
    });
    expect(displayDecision('quota', '配额已用尽')).toEqual({
      showRealReason: true,
      reason: '配额已用尽',
    });
    expect(displayDecision('transient', 'HTTP 503')).toEqual({
      showRealReason: false,
    });
    expect(displayDecision(undefined, undefined)).toEqual({
      showRealReason: false,
    });
  });
});
