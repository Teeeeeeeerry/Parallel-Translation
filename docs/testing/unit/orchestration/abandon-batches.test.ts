/**
 * content 放弃的批次通知后台停止翻译（#1001）
 *
 * 编排模块放弃一次整页翻译（用户点还原、某一批判了失效）时，交给发送层的
 * 中止信号触发；发送层据此通知后台中止那几批的引擎调用（见 messaging 的用例）。
 * 这里只断言外部行为：发出去的批次手里的信号什么时候触发、什么时候不触发；
 * 后台没理会信号、照样把译文送回来时，结果仍按纪元丢弃（回到原来的行为）。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator, type TranslateItem } from '~/src/orchestration/orchestrator';
import type { TranslateRequest } from '~/src/engines/types';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

const items = (tag: string, n: number): TranslateItem<string>[] =>
  Array.from({ length: n }, (_, i) => ({ text: `${tag}${i}`, ctx: `${tag}${i}` }));

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 每一批发出时记下它的信号；回复由用例手动放行 */
function harness() {
  const signals: AbortSignal[] = [];
  const replies: ((v: unknown) => void)[] = [];
  let translated = false;
  const rendered: string[] = [];
  const send = vi.fn(
    (req: TranslateRequest, ctl?: { signal: AbortSignal }) =>
      new Promise<unknown>((r) => {
        signals.push(ctl!.signal);
        replies.push(r);
        void req;
      }),
  );
  const ok = (req: TranslateRequest) => ({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
  const orch = createOrchestrator({
    send,
    hasTranslated: () => translated,
    restore: () => {
      translated = false;
    },
    onBatchResult: (_i, batch, result) => {
      if (!result.ok) return;
      translated = true;
      rendered.push(...batch.map((b) => String(b.ctx)));
    },
    getSettings: () => ({ ...DEFAULT_SETTINGS, maxConcurrency: 2 }),
    getHostname: () => 'example.com',
    sleep: async () => {},
  });
  orch.start();
  return { orch, send, signals, replies, ok, rendered };
}

describe('放弃的批次通知后台中止（#1001）', () => {
  test('用户点还原：在飞的批次手里的信号触发，结果不渲染', async () => {
    const h = harness();
    // 两批，各 20 个单元；第一批先回来（页面上有了译文，才能还原），第二批在飞
    const pending = h.orch.togglePage(items('a', 40), 'en', 'zh-CN');
    await flush();
    expect(h.signals).toHaveLength(2);
    h.replies[0]!(h.ok(h.send.mock.calls[0]![0]));
    await flush();
    expect(h.signals[1]!.aborted).toBe(false);

    const restored = await h.orch.togglePage(items('a', 40), 'en', 'zh-CN');
    expect(restored.status).toBe('restored');
    expect(h.signals[1]!.aborted).toBe(true);

    // 后台中止了引擎调用，这一批回“已中止”
    h.replies[1]!({ ok: false, error: '已中止', category: 'aborted', aborted: true });
    expect((await pending).status).toBe('aborted');
    expect(h.rendered).toHaveLength(20);
  });

  test('中止消息丢了、后台照样翻完送回来：结果仍按纪元丢弃，回到原来的行为', async () => {
    const h = harness();
    const pending = h.orch.togglePage(items('a', 40), 'en', 'zh-CN');
    await flush();
    h.replies[0]!(h.ok(h.send.mock.calls[0]![0]));
    await flush();
    await h.orch.togglePage(items('a', 40), 'en', 'zh-CN');
    // 无视信号，正常回译文
    h.replies[1]!(h.ok(h.send.mock.calls[1]![0]));
    expect((await pending).status).toBe('aborted');
    expect(h.rendered).toHaveLength(20);
  });

  test('某一批判了失效：别的在飞批次的信号触发（它们的结果反正要作废）', async () => {
    const h = harness();
    const pending = h.orch.togglePage(items('a', 40), 'en', 'zh-CN');
    await flush();
    h.replies[0]!({ ok: false, error: '配额耗尽', invalidated: true, category: 'quota' });
    await flush();
    expect(h.signals[1]!.aborted).toBe(true);
    h.replies[1]!({ ok: false, error: '已中止', category: 'aborted', aborted: true });
    await pending;
  });

  test('外部中止入口 abort()：在飞批次的信号同样触发', async () => {
    const h = harness();
    const pending = h.orch.translatePage(items('a', 20), 'en', 'zh-CN');
    await flush();
    h.orch.abort();
    expect(h.signals[0]!.aborted).toBe(true);
    h.replies[0]!({ ok: false, error: '已中止', category: 'aborted', aborted: true });
    expect((await pending).aborted).toBe(true);
  });

  test('正常翻完：没有任何一批的信号触发', async () => {
    const h = harness();
    const pending = h.orch.translatePage(items('a', 40), 'en', 'zh-CN');
    await flush();
    h.replies[0]!(h.ok(h.send.mock.calls[0]![0]));
    h.replies[1]!(h.ok(h.send.mock.calls[1]![0]));
    const summary = await pending;
    expect(summary.allFailed).toBe(false);
    expect(h.signals.map((s) => s.aborted)).toEqual([false, false]);
    // 翻完之后再还原：已经结束的这一次不再收到通知
    h.orch.abort();
    expect(h.signals.map((s) => s.aborted)).toEqual([false, false]);
  });
});
