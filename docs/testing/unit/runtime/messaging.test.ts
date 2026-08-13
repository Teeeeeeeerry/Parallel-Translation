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
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'pt:translate',
      payload: PAYLOAD,
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

describe('translateViaBackground — 失败语义', () => {
  test('SW 响应 {ok:false}（引擎级失败）→ 原样返回，不重试', async () => {
    sendMessage.mockImplementation(async (msg: unknown) => {
      const m = msg as { type?: string };
      if (m.type === 'pt:ping') return { ok: true };
      return { ok: false, error: '所有引擎均失败' };
    });

    const result = await translateViaBackground(PAYLOAD);

    expect(result).toEqual({ ok: false, error: '所有引擎均失败' });
    // 1 ping + 1 translate，translate 没有重试
    expect(sendMessage).toHaveBeenCalledTimes(2);
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
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('无响应');
    }
  });
});
