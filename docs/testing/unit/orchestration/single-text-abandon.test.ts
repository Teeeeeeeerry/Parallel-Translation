/**
 * 单文本入口放弃时通知后台中止（#1044，#1001 的同类）
 *
 * 逐段、划词、输入翻译共用编排模块的 translateText。经它的外部行为断言：发送
 * 层收到的中止信号在什么时候触发、这一次报什么。口径：
 * - 逐段与划词（默认）：页面还原算放弃 —— 信号触发，报 abandoned；
 * - 划词：调用方自己的信号（后发一轮顶掉）算放弃；
 * - 输入翻译（从输入根派生，#1072 前是 keepOnRestore）：页面还原不算 —— 信号不触发，照常返回译文。
 * 信号之后怎么变成一条 pt:cancel-batches 消息由消息层负责，见 messaging 的用例。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { TranslateRequest } from '~/src/engines/types';

/** 发送替身：记下每次收到的信号，结果由用例决定何时兑现 */
function slowSend() {
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  const send = vi.fn(
    (req: TranslateRequest, ctl?: { signal: AbortSignal }) =>
      new Promise((r) => {
        signals.push(ctl!.signal);
        releases.push(() => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } }));
      }),
  );
  return { send, signals, release: () => releases.shift()!() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('单文本入口放弃时通知后台中止（#1044）', () => {
  test('逐段 / 划词：在飞时页面还原 → 发送层的信号触发，这一次报 abandoned', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('Hello', 'en', 'zh-CN');
    await flush();
    expect(s.signals[0]!.aborted).toBe(false);
    orch.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, abandoned: true });
  });

  test('输入翻译（输入根）：在飞时页面还原 → 信号不触发，照常返回译文', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('你好', 'auto', 'en', { noCache: true, root: 'input' });
    await flush();
    orch.abort();
    expect(s.signals[0]!.aborted).toBe(false);
    s.release();
    expect(await pending).toMatchObject({ ok: true, translation: 'T(你好)' });
  });

  test('调用方自己的信号触发 → 发送层的信号跟着触发，这一次报 abandoned', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    const pending = orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal });
    await flush();
    caller.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, abandoned: true });
  });

  test('输入翻译带了调用方信号时同样认它：输入根只是不随页面还原', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    const pending = orch.translateText('你好', 'auto', 'en', { root: 'input', signal: caller.signal });
    await flush();
    caller.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, abandoned: true });
  });

  test('调用方的信号在发送前已触发 → 零请求', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    caller.abort();
    expect(await orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal })).toMatchObject({
      ok: false,
      abandoned: true,
    });
    expect(s.send).not.toHaveBeenCalled();
  });

  test('已经翻完的一条，之后的页面还原不再触发它的信号（登记随结束撤掉）', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('Hello', 'en', 'zh-CN');
    await flush();
    s.release();
    expect(await pending).toMatchObject({ ok: true });
    orch.abort();
    expect(s.signals[0]!.aborted).toBe(false);
  });
});

describe('放弃不算失败：结果只以 abandoned 表示（#1053、#1074）', () => {
  test('在飞时页面还原 → abandoned', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('Hello', 'en', 'zh-CN');
    await flush();
    orch.abort();
    s.release();
    expect(await pending).toMatchObject({ ok: false, abandoned: true });
  });

  test('调用方信号触发（划词被后发一轮顶掉）→ abandoned；发起前已触发的同样', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    const pending = orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal });
    await flush();
    caller.abort();
    s.release();
    expect(await pending).toMatchObject({ ok: false, abandoned: true });
    expect(await orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal })).toMatchObject({
      ok: false,
      abandoned: true,
    });
  });

  test('判据是类别不是文案：后台报 aborted 时文案换成什么都不提示；瞬时故障照常提示', async () => {
    const orch = createOrchestrator({
      send: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, category: 'aborted', error: 'some other wording' })
        .mockResolvedValueOnce({ ok: false, category: 'transient', error: '已中止' }),
    });
    orch.start();
    expect(await orch.translateText('a', 'en', 'zh-CN')).toEqual({ admission: 'allowed', ok: false, abandoned: true });
    // 文案恰好是“已中止”的瞬时故障仍是失败
    const b = await orch.translateText('b', 'en', 'zh-CN');
    expect(b.abandoned).toBeUndefined();
    expect(b.display).toEqual({ showRealReason: false });
  });
});
