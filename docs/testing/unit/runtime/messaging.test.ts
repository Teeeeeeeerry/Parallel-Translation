/**
 * runtime/messaging.ts — content → background 消息通道健壮性 单元测试
 *
 * #89：Chrome MV3 headless 下 SW 冷启动/监听器未注册时，
 * content script 发出的 pt:translate 会被丢弃（sendMessage 解析为
 * undefined 或 reject "Receiving end does not exist"）。
 *
 * translateViaBackground 的公开契约：
 * 1. 发送前先 ping（pt:ping）确认 SW 消息通道就绪，有界重试
 * 2. pt:translate 在传输层失败（无响应/连接被拒）时有界重试
 * 3. SW 已响应的 {ok:false}（引擎级失败）不重试，原样返回
 * 4. 预算耗尽返回 {ok:false} + 错误说明，永不抛出
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { translateViaBackground } from '~/src/runtime/messaging';

const sendMessage = vi.mocked(chrome.runtime.sendMessage);

afterEach(() => {
  vi.useRealTimers();
  sendMessage.mockReset();
});

const PAYLOAD = { texts: ['Hello'], from: 'en', to: 'zh-CN' };

describe('translateViaBackground — SW 就绪时', () => {
  test('ping 一次 + translate 一次，直接返回译文', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string; payload?: unknown };
      if (m.type === 'pt:ping') return { ok: true };
      return { ok: true, data: { translations: ['你好'] } };
    });

    const result = await translateViaBackground(PAYLOAD);

    expect(result).toEqual({ ok: true, data: { translations: ['你好'] } });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'pt:ping' });
    // #1001：每次发送带一个批次身份，后台凭它登记在飞表
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'pt:translate',
      payload: { ...PAYLOAD, batchId: expect.any(String) },
    });
  });
});

describe('translateViaBackground — SW 冷启动（#89 根因）', () => {
  test('ping 前两次无响应，第三次就绪后翻译成功', async () => {
    vi.useFakeTimers();
    let pings = 0;
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') {
        pings++;
        return pings >= 3 ? { ok: true } : undefined;
      }
      return { ok: true, data: { translations: ['就绪后译文'] } };
    });

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(pings).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(pings).toBe(2);

    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(result).toEqual({ ok: true, data: { translations: ['就绪后译文'] } });
    // 3 次 ping + 1 次 translate
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });

  test('translate 首次无响应（SW 在 ping 后失联）→ 自动重试成功', async () => {
    vi.useFakeTimers();
    let translates = 0;
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      translates++;
      return translates >= 2
        ? { ok: true, data: { translations: ['重试后译文'] } }
        : undefined;
    });

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(translates).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(result).toEqual({ ok: true, data: { translations: ['重试后译文'] } });
  });

  test('sendMessage reject（Receiving end does not exist）→ 重试成功', async () => {
    vi.useFakeTimers();
    let translates = 0;
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      translates++;
      if (translates === 1) {
        throw new Error(
          'Could not establish connection. Receiving end does not exist.',
        );
      }
      return { ok: true, data: { translations: ['连接恢复'] } };
    });

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(result).toEqual({ ok: true, data: { translations: ['连接恢复'] } });
  });
});

describe('translateViaBackground — 扩展上下文失效', () => {
  test('chrome.runtime 为 undefined → 立即失败并提示刷新页面，不空等重试预算', async () => {
    // 扩展重载 / 更新后，已注入页面的 content script 上下文失效：
    // chrome.runtime 变 undefined，且永不恢复。修复前此处被当作
    // SW 冷启动重试 10+15 秒，最终报“消息通道不可用: Cannot read
    // properties of undefined (reading 'sendMessage')”。
    vi.useFakeTimers();
    // setup.ts 用 vi.stubGlobal 挂载 chrome —— 不能用 unstubAllGlobals
    // 恢复（会把 setup 的 mock 一并撤销），测试内手动保存 / 恢复
    const savedChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = { runtime: undefined };
    try {
      const pending = translateViaBackground(PAYLOAD);
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // #116: 类型化失效标志透出，供 batch-retry 短路而不匹配文案
        expect(result.invalidated).toBe(true);
        expect(result.error).toContain('已失效');
        expect(result.error).toContain('刷新');
        // #579: 扩展上下文失效以单独的类型化字段透出，与配额耗尽区分
        expect(result.contextInvalidated).toBe(true);
      }
    } finally {
      (globalThis as { chrome?: unknown }).chrome = savedChrome;
    }
  });

  test('sendMessage 抛 TypeError 且上下文随后失效（传输中失效）→ 同样立即失败', async () => {
    // #139：失效判定只认结构化状态（chrome.runtime.id 为 null），
    // 不再匹配错误文案 —— 这里模拟传输中途上下文失效：
    // 首次检查时上下文仍有效，sendMessage 抛错前把 chrome.runtime 置空。
    vi.useFakeTimers();
    const savedChrome = (globalThis as { chrome?: unknown }).chrome;
    const savedRuntime = (savedChrome as { runtime?: unknown }).runtime;
    (globalThis as { chrome?: unknown }).chrome = { runtime: savedRuntime };
    sendMessage.mockImplementation(async () => {
      (globalThis as { chrome?: unknown }).chrome = { runtime: undefined };
      throw new TypeError(
        "Cannot read properties of undefined (reading 'sendMessage')",
      );
    });

    try {
      const pending = translateViaBackground(PAYLOAD);
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.invalidated).toBe(true);
        expect(result.error).toContain('已失效');
        expect(result.contextInvalidated).toBe(true);
      }
    } finally {
      (globalThis as { chrome?: unknown }).chrome = savedChrome;
    }
  });
});

describe('translateViaBackground — 失败语义', () => {
  test('SW 响应 {ok:false}（引擎级失败）→ 原样返回，不重试', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      return { ok: false, error: '所有引擎均失败' };
    });

    const result = await translateViaBackground(PAYLOAD);

    expect(result).toEqual({
      ok: false,
      error: '所有引擎均失败',
      invalidated: false,
      // #263: 未携带类型化字段 → 按瞬时处理；不再转述 retryable
      category: 'transient',
      aborted: false,
    });
    // 1 ping + 1 translate，translate 没有重试
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test('SW 响应携带类型化类别 → 原样透传（#236 新形态端到端）', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      return {
        ok: false,
        error: 'API key 无效',
        retryable: false,
        category: 'invalid-key',
        invalidated: false,
        aborted: false,
      };
    });

    const result = await translateViaBackground(PAYLOAD);

    expect(result).toEqual({
      ok: false,
      error: 'API key 无效',
      invalidated: false,
      category: 'invalid-key',
      aborted: false,
    });
  });

  test('SW 响应配额耗尽（带失效标志）→ 不标记为扩展上下文失效（#579）', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      return {
        ok: false,
        error: '配额已用尽',
        category: 'quota',
        invalidated: true,
        aborted: false,
      };
    });

    const result = await translateViaBackground(PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidated).toBe(true);
      expect(result.contextInvalidated).toBeFalsy();
    }
  });

  test('SW 始终无响应：ping 预算耗尽 → {ok:false}，不发送 translate', async () => {
    vi.useFakeTimers();
    sendMessage.mockImplementation(async () => undefined);

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('无响应');
    }
    // translate 从未发送 —— 通道未就绪就不浪费引擎配额
    const translateCalls = sendMessage.mock.calls.filter(
      ([m]) => (m as { type?: string })?.type === 'pt:translate',
    );
    expect(translateCalls).toHaveLength(0);
  });

  test('translate 持续无响应：重试预算耗尽 → {ok:false}', async () => {
    vi.useFakeTimers();
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      return m.type === 'pt:ping' ? { ok: true } : undefined;
    });

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(46_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('无响应');
    }
  });

  test('translate 永不 settle（SW 挂起）→ 响应级超时中断，预算内有界失败（#154）', async () => {
    vi.useFakeTimers();
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      // 永不 settle —— 修复前这里会让 deadline 检查永远走不到
      return new Promise(() => {});
    });

    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(0);
    // 首次 translate 在 30s 响应级超时中断（而非无限挂起）
    await vi.advanceTimersByTimeAsync(30_000);
    // 预算（45s）耗尽 → 有界返回失败
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('响应超时');
    }
  });
});

describe('放弃的批次通知后台中止（#1001）', () => {
  const sent = () => sendMessage.mock.calls.map((c) => c[0] as unknown as { type: string; payload?: { batchId?: string }; ids?: string[] });

  test('单次响应超时：把这一次的批次身份发给后台中止；重发用新的身份', async () => {
    vi.useFakeTimers();
    let translates = 0;
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      if (m.type === 'pt:cancel-batches') return undefined;
      // 第一次后台一直没回（还在翻），第二次正常回
      if (++translates === 1) return new Promise(() => {});
      return { ok: true, data: { translations: ['你好'] } };
    });
    const pending = translateViaBackground(PAYLOAD);
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await pending;
    expect(result.ok).toBe(true);

    const translatesSent = sent().filter((m) => m.type === 'pt:translate');
    const cancels = sent().filter((m) => m.type === 'pt:cancel-batches');
    expect(translatesSent).toHaveLength(2);
    const [first, second] = translatesSent.map((m) => m.payload!.batchId!);
    expect(first).not.toBe(second);
    expect(cancels).toEqual([{ type: 'pt:cancel-batches', ids: [first] }]);
  });

  test('调用方中止（用户点还原）：正在等的那一次发给后台中止，不再多等一轮', async () => {
    let reply: (v: unknown) => void = () => {};
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      if (m.type === 'pt:cancel-batches') {
        // 后台中止了引擎调用，这一批的回复是“已中止”
        reply({ ok: false, error: '已中止', category: 'aborted', aborted: true });
        return undefined;
      }
      return new Promise<unknown>((r) => (reply = r as (v: unknown) => void));
    });
    const ctrl = new AbortController();
    const pending = translateViaBackground(PAYLOAD, { signal: ctrl.signal });
    await vi.waitFor(() => expect(sent().some((m) => m.type === 'pt:translate')).toBe(true));
    ctrl.abort();
    const result = await pending;

    const id = sent().find((m) => m.type === 'pt:translate')!.payload!.batchId!;
    expect(sent().filter((m) => m.type === 'pt:cancel-batches')).toEqual([{ type: 'pt:cancel-batches', ids: [id] }]);
    expect(result).toMatchObject({ ok: false, aborted: true });
  });

  test('中止消息丢了（后台没在听、实例已换）：不报错，照旧等到这一批的回复', async () => {
    let reply: (v: unknown) => void = () => {};
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      if (m.type === 'pt:cancel-batches') throw new Error('Could not establish connection. Receiving end does not exist.');
      return new Promise<unknown>((r) => (reply = r as (v: unknown) => void));
    });
    const ctrl = new AbortController();
    const pending = translateViaBackground(PAYLOAD, { signal: ctrl.signal });
    await vi.waitFor(() => expect(sent().some((m) => m.type === 'pt:translate')).toBe(true));
    ctrl.abort();
    // 回落到原来的行为：后台把这一批翻完，回复照常交给调用方（由调用方按纪元丢弃）
    reply({ ok: true, data: { translations: ['你好'] } });
    expect(await pending).toEqual({ ok: true, data: { translations: ['你好'] } });
  });

  test('回复到了之后才中止：不再发中止消息', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      return { ok: true, data: { translations: ['你好'] } };
    });
    const ctrl = new AbortController();
    await translateViaBackground(PAYLOAD, { signal: ctrl.signal });
    ctrl.abort();
    expect(sent().filter((m) => m.type === 'pt:cancel-batches')).toEqual([]);
  });
});
