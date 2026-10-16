/**
 * 单文本入口放弃时通知后台中止（#1044，#1001 的同类）
 *
 * 逐段、划词、输入翻译共用编排模块的 translateText。经它的外部行为断言：发送
 * 层收到的中止信号在什么时候触发、这一次报什么。口径：
 * - 逐段与划词（默认）：页面还原（纪元递增）算放弃 —— 信号触发，报 aborted；
 * - 划词：调用方自己的信号（后发一轮顶掉）算放弃；
 * - 输入翻译（keepOnRestore）：页面还原不算 —— 信号不触发，照常返回译文。
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
  test('逐段 / 划词：在飞时页面还原 → 发送层的信号触发，这一次报 aborted', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('Hello', 'en', 'zh-CN');
    await flush();
    expect(s.signals[0]!.aborted).toBe(false);
    orch.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, category: 'aborted' });
  });

  test('输入翻译（keepOnRestore）：在飞时页面还原 → 信号不触发，照常返回译文', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const pending = orch.translateText('你好', 'auto', 'en', { noCache: true, keepOnRestore: true });
    await flush();
    orch.abort();
    expect(s.signals[0]!.aborted).toBe(false);
    s.release();
    expect(await pending).toMatchObject({ ok: true, translation: 'T(你好)' });
  });

  test('调用方自己的信号触发 → 发送层的信号跟着触发，这一次报 aborted', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    const pending = orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal });
    await flush();
    caller.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, category: 'aborted' });
  });

  test('输入翻译带了调用方信号时同样认它：keepOnRestore 只管页面还原', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    const pending = orch.translateText('你好', 'auto', 'en', { keepOnRestore: true, signal: caller.signal });
    await flush();
    caller.abort();
    expect(s.signals[0]!.aborted).toBe(true);
    s.release();
    expect(await pending).toMatchObject({ ok: false, category: 'aborted' });
  });

  test('调用方的信号在发送前已触发 → 零请求', async () => {
    const s = slowSend();
    const orch = createOrchestrator({ send: s.send });
    orch.start();
    const caller = new AbortController();
    caller.abort();
    expect(await orch.translateText('Hello', 'en', 'zh-CN', { signal: caller.signal })).toMatchObject({
      ok: false,
      category: 'aborted',
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
