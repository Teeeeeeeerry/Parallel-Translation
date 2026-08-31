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

describe('跨三条路径的失败提示契约（#316）', () => {
  // 三条翻译路径（整页 / 逐段 / 划词）最终都消费编排模块的
  // display 决策；本契约断言两个模块入口对同一失败类别产出同一决策，
  // 内容脚本侧只是渲染该决策（#313 边界：模块不触碰 UI）。
  const CATEGORIES = ['invalid-key', 'quota', 'transient'] as const;

  for (const category of CATEGORIES) {
    test(`失败类别 ${category}：整页入口与单文本入口产出同一提示决策`, async () => {
      const send = vi.fn(async () => ({
        ok: false,
        category,
        error: '引擎给出的原因',
        retryable: true,
      }));
      const orch = createOrchestrator({ send });
      orch.start();

      const page = await orch.translatePage(items(2), 'en', 'zh-CN');
      const single = await orch.translateText('Hello', 'en', 'zh-CN');

      expect(page.display).toEqual(single.display);
      if (category === 'transient') {
        expect(page.display).toEqual({ showRealReason: false });
      } else {
        expect(page.display).toEqual({
          showRealReason: true,
          reason: '引擎给出的原因',
        });
      }
      orch.stop();
    });
  }
});

describe('整页开关入口（#325）', () => {
  test('页面无译文 → 执行翻译并返回 translated', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: ['译'] } }));
    const restore = vi.fn();
    const orch = createOrchestrator({
      send,
      hasTranslated: () => false,
      restore,
    });
    orch.start();

    const result = await orch.togglePage(items(2), 'en', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(result.status).toBe('translated');
    expect(result.summary?.allFailed).toBe(false);
    orch.stop();
  });

  test('页面已有译文 → 执行还原并返回 restored，零请求', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const restore = vi.fn();
    const orch = createOrchestrator({
      send,
      hasTranslated: () => true,
      restore,
    });
    orch.start();

    const result = await orch.togglePage(items(2), 'en', 'zh-CN');

    expect(restore).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe('restored');
    orch.stop();
  });

  test('翻译态查询与还原动作均为注入项：无 DOM 环境假注入可完整测试', async () => {
    // 本测试本身即证明：hasTranslated / restore 只是普通闭包，
    // 模块不访问 document / location
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    let state = false;
    const orch = createOrchestrator({
      send,
      hasTranslated: () => state,
      restore: () => {
        state = false;
      },
    });
    orch.start();

    state = false;
    const t = await orch.togglePage(items(1), 'en', 'zh-CN');
    expect(t.status).toBe('translated');

    state = true;
    const r = await orch.togglePage(items(1), 'en', 'zh-CN');
    expect(r.status).toBe('restored');
    expect(state).toBe(false);
    orch.stop();
  });

  test('准入拦截：站点被屏蔽 / 总开关关闭 → 零请求、不执行还原', async () => {
    const settings = (enabled: boolean): Settings => ({
      ...DEFAULT_SETTINGS,
      enabled,
      siteList: { mode: 'blacklist', list: ['example.com'] },
    });
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const restore = vi.fn();
    const orch = createOrchestrator({
      send,
      restore,
      hasTranslated: () => true,
      getSettings: () => settings(true),
      getHostname: () => 'example.com',
    });
    orch.start();

    const blocked = await orch.togglePage(items(1), 'en', 'zh-CN');
    expect(blocked.status).toBe('blocked');
    expect(send).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    orch.stop();

    const orch2 = createOrchestrator({
      send,
      restore,
      hasTranslated: () => true,
      getSettings: () => settings(false),
      getHostname: () => 'other.com',
    });
    orch2.start();
    const disabled = await orch2.togglePage(items(1), 'en', 'zh-CN');
    expect(disabled.status).toBe('disabled');
    expect(send).not.toHaveBeenCalled();
    orch2.stop();
  });

  test('无翻译项（空 items）→ no-elements，零请求', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: [] } }));
    const orch = createOrchestrator({ send, hasTranslated: () => false });
    orch.start();

    const result = await orch.togglePage([], 'en', 'zh-CN');

    expect(result.status).toBe('no-elements');
    expect(send).not.toHaveBeenCalled();
    orch.stop();
  });
});

describe('在飞互斥（#326）', () => {
  test('在飞期间二次触发且页面尚无译文：假消息层只收到一轮请求，第二次返回忙碌', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveSend = r)));
    const orch = createOrchestrator({
      send,
      hasTranslated: () => false,
    });
    orch.start();

    const first = orch.togglePage(items(1), 'en', 'zh-CN');
    const second = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('busy');

    resolveSend({ ok: true, data: { translations: ['译'] } });
    const firstResult = await first;
    expect(firstResult.status).toBe('translated');
    orch.stop();
  });

  test('在飞期间页面已有译文时再次触发：放行还原且在飞批次被中止', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveSend = r)));
    const restore = vi.fn();
    let translated = false; // 首批渲染完成后置 true（模拟内容脚本渲染）
    const orch = createOrchestrator({
      send,
      hasTranslated: () => translated,
      restore,
    });
    orch.start();

    const first = orch.togglePage(items(1), 'en', 'zh-CN');
    // 首批在飞期间译文已落 DOM（渲染回调置位）→ 再次触发放行还原
    translated = true;
    const second = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(second.status).toBe('restored');
    expect(restore).toHaveBeenCalledTimes(1);

    // 在飞批次被中止：首轮返回 aborted，不产生译文
    resolveSend({ ok: true, data: { translations: ['译'] } });
    const firstResult = await first;
    expect(firstResult.status).toBe('aborted');
    orch.stop();
  });

  test('忙碌状态不被调用方当作错误：正常返回而非抛错', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveSend = r)));
    const orch = createOrchestrator({ send, hasTranslated: () => false });
    orch.start();

    const first = orch.togglePage(items(1), 'en', 'zh-CN');
    const second = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(second.status).toBe('busy');
    expect(second.summary).toBeUndefined();
    // 忙碌结果不携带错误信息（区别于 error 状态）
    expect(() => second).not.toThrow();

    resolveSend({ ok: true, data: { translations: ['译'] } });
    await first;
    orch.stop();
  });
});

describe('状态推送与中止记账（#327）', () => {
  function orchWith(opts: Record<string, unknown>): {
    orch: ReturnType<typeof createOrchestrator>;
    pushes: string[];
  } {
    const pushes: string[] = [];
    const orch = createOrchestrator({
      send: vi.fn(async () => ({ ok: true, data: { translations: ['译'] } })),
      hasTranslated: () => false,
      pushStatus: (s) => pushes.push(s),
      ...opts,
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();
    return { orch, pushes };
  }

  test('翻译在飞时执行还原：结果标记为已中止、推送空闲而非错误', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveSend = r)));
    const restore = vi.fn();
    const pushes: string[] = [];
    let translated = false;
    const orch = createOrchestrator({
      send,
      restore,
      hasTranslated: () => translated,
      pushStatus: (s) => pushes.push(s),
    });
    orch.start();

    const first = orch.togglePage(items(1), 'en', 'zh-CN');
    translated = true; // 在飞期间首批已渲染
    const second = await orch.togglePage(items(1), 'en', 'zh-CN');
    expect(second.status).toBe('restored');

    resolveSend({ ok: true, data: { translations: ['译'] } });
    const firstResult = await first;

    // 首轮被中止：不产生错误，推送空闲而非错误
    expect(firstResult.status).toBe('aborted');
    expect(pushes).toEqual(['loading', 'idle', 'idle']);
    expect(pushes).not.toContain('error');
    orch.stop();
  });

  test('还原恰好发生在最后一批返回与整体返回之间：同样报告为已中止', async () => {
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveSend = r)));
    const restore = vi.fn();
    const pushes: string[] = [];
    const orch = createOrchestrator({
      send,
      restore,
      hasTranslated: () => false,
      pushStatus: (s) => pushes.push(s),
    });
    orch.start();

    const first = orch.togglePage(items(1), 'en', 'zh-CN');
    // 批次已 resolve（最后一批返回），但整体返回前用户还原
    resolveSend({ ok: true, data: { translations: ['译'] } });
    orch.abort();
    restore();

    const firstResult = await first;
    expect(firstResult.status).toBe('aborted');
    expect(pushes).toEqual(['loading', 'idle']);
    orch.stop();
  });

  test('引擎全部失败：推送错误状态', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      category: 'invalid-key',
      error: 'API key 无效',
      retryable: false,
    }));
    const pushes: string[] = [];
    const orch = createOrchestrator({
      send,
      hasTranslated: () => false,
      pushStatus: (s) => pushes.push(s),
    });
    orch.start();

    const result = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(result.status).toBe('error');
    expect(pushes).toEqual(['loading', 'error']);
    orch.stop();
  });

  test('引擎返回结果但全部渲染被拒：不推送已完成状态', async () => {
    const { orch, pushes } = orchWith({ allRenderRejected: () => true });

    const result = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(result.status).toBe('error');
    expect(pushes).toEqual(['loading', 'error']);
    orch.stop();
  });

  test('状态推送为注入回调：模块不直接操作 UI（假回调可完整测试）', async () => {
    const { orch, pushes } = orchWith({});

    const result = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(pushes).toEqual(['loading', 'done']);
    orch.stop();
  });

  test('子框架不推送状态，但照常执行翻译', async () => {
    const send = vi.fn(async () => ({ ok: true, data: { translations: ['译'] } }));
    const pushes: string[] = [];
    const orch = createOrchestrator({
      send,
      hasTranslated: () => false,
      isMainFrame: () => false,
      pushStatus: (s) => pushes.push(s),
    });
    orch.start();

    const result = await orch.togglePage(items(1), 'en', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1); // 子框架照常翻译
    expect(pushes).toEqual([]); // 但不推送状态
    orch.stop();
  });
});
