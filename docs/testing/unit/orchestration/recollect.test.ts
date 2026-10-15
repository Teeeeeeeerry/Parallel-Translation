/**
 * 整页翻译完成后补采集一轮（#1011，父 #1003）
 *
 * 经编排模块的整页开关入口断言：采集函数是注入的，用“第二次调用才返回新单元”
 * 的假采集函数模拟翻译期间懒加载出来的内容；发送函数是注入的，记录发了什么。
 * 只断言外部行为：新单元最后有没有发出去、观察器什么时候启动、还原之后还发不发、
 * 哪些情况一轮都不补。不断言补采集内部怎么循环。
 *
 * “已经带完成标记的单元不重翻”落在采集那一层（content 的采集函数与
 * src/dom/page-collect.ts），见 docs/testing/unit/dom/page-collect.test.ts。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  createOrchestrator,
  type TranslateItem,
  type OrchestratorOptions,
} from '~/src/orchestration/orchestrator';
import type { TranslateRequest } from '~/src/engines/types';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

const items = (tag: string, n: number): TranslateItem<string>[] =>
  Array.from({ length: n }, (_, i) => ({ text: `${tag}${i}`, ctx: `${tag}${i}` }));

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 按调用次数依次交出几组单元的假采集函数；第 n 次调用之后都交出空 */
function source(...rounds: TranslateItem<string>[][]) {
  const calls: string[] = [];
  const fn = vi.fn((mode?: { readOnly: boolean }) => {
    if (mode?.readOnly) return rounds[0] ?? [];
    calls.push('collect');
    return rounds[calls.length - 1] ?? [];
  });
  return { fn, collects: () => calls.length };
}

function harness(extra: Partial<OrchestratorOptions> = {}) {
  const events: string[] = [];
  const sent: string[] = [];
  let translated = false;
  const send = vi.fn(async (req: TranslateRequest) => {
    sent.push(...req.texts);
    return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
  });
  const orch = createOrchestrator({
    send,
    hasTranslated: () => translated,
    restore: () => {
      translated = false;
      events.push('restore');
    },
    onBatchResult: () => {
      translated = true;
    },
    pushStatus: (s) => events.push(`push:${s}`),
    onObserverStart: () => events.push('observer:start'),
    onObserverStop: () => events.push('observer:stop'),
    sleep: async () => {},
    ...extra,
  });
  orch.start();
  return { orch, send, sent, events };
}

describe('整页翻译完成后补采集一轮（#1011）', () => {
  test('翻译期间出现的新单元在整页翻译结束后被翻译，观察器在补完之后才启动', async () => {
    const h = harness();
    let observerSawSent = -1;
    h.events.push = ((orig) =>
      function (this: string[], ...xs: string[]) {
        if (xs.includes('observer:start')) observerSawSent = h.sent.length;
        return orig.apply(this, xs);
      })(h.events.push);
    const src = source(items('a', 30), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(src.collects()).toBe(2);
    expect(h.sent).toEqual([...items('a', 30), ...items('new', 3)].map((it) => it.text));
    // 观察器启动那一刻，补采集的单元已经全部发出并返回
    expect(observerSawSent).toBe(33);
    expect(h.events.filter((e) => e === 'observer:start')).toHaveLength(1);
  });

  test('补采集没有新单元：不多发任何请求，观察器照常启动', async () => {
    const h = harness();
    const src = source(items('a', 5), []);
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(src.collects()).toBe(2);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.events).toContain('observer:start');
  });

  test('整页翻译失败：一轮都不补，观察器不启动', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'HTTP 503', category: 'transient' as const }));
    const h = harness({ send });
    const src = source(items('a', 5), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('error');
    expect(src.collects()).toBe(1);
    expect(h.events).not.toContain('observer:start');
  });

  test('站点没准入：一次都不采集', async () => {
    const h = harness({
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: false }),
      getHostname: () => 'example.com',
    });
    const src = source(items('a', 5), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('disabled');
    expect(src.collects()).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  test('页面级闸门拦下：不采集、不补', async () => {
    const h = harness({ getPageLang: () => 'zh-CN' });
    const src = source(items('a', 5), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('same-language');
    expect(src.collects()).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  test('首轮翻译在飞时被中止：不补', async () => {
    let release!: () => void;
    const send = vi.fn(
      (req: TranslateRequest) =>
        new Promise((r) => {
          release = () => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
        }),
    );
    const h = harness({ send });
    const src = source(items('a', 5), items('new', 3));
    const pending = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    h.orch.abort();
    release();
    const result = await pending;
    expect(result.status).toBe('aborted');
    expect(src.collects()).toBe(1);
    expect(h.events).not.toContain('observer:start');
  });

  test('补采集在飞时点还原：排队的补翻不再发出，观察器不启动，这一次报中止', async () => {
    const releases: (() => void)[] = [];
    let translated = false;
    const sent: string[] = [];
    const send = vi.fn(
      (req: TranslateRequest) =>
        new Promise((r) => {
          sent.push(...req.texts);
          releases.push(() => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } }));
        }),
    );
    const h = harness({
      send,
      hasTranslated: () => translated,
      onBatchResult: () => {
        translated = true;
      },
      getSettings: () => ({ ...DEFAULT_SETTINGS, maxConcurrency: 2 }),
      getHostname: () => 'example.com',
    });
    // 首轮 1 批；补采集 200 个新单元，切成十批，并发 2
    const src = source(items('a', 3), items('new', 200));
    const pending = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    releases.shift()!(); // 首轮返回
    await flush();
    expect(src.collects()).toBe(2);
    const sentBeforeRestore = sent.length;
    expect(sentBeforeRestore).toBeLessThan(203);
    // 用户点还原
    const restored = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(restored.status).toBe('restored');
    // 放行在飞的补翻：排队的那些一批都不再发出
    while (releases.length) {
      releases.shift()!();
      await flush();
    }
    const result = await pending;
    expect(sent.length).toBe(sentBeforeRestore);
    expect(result.status).toBe('aborted');
    expect(h.events).not.toContain('observer:start');
  });

  test('准入不重判：首轮之后用户关了总开关，这一次的补采集照常补完', async () => {
    // 准入在整页入口判过一次，补采集是这一次整页翻译的延续；关掉总开关管的是
    // 之后的入口（下一次整页、逐段、观察器的增量补翻），不回头拦这一次
    let enabled = true;
    const send = vi.fn(async (req: TranslateRequest) => {
      enabled = false;
      return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
    });
    const h = harness({
      send,
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled }),
      getHostname: () => 'example.com',
    });
    const src = source(items('a', 5), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].texts).toEqual(['new0', 'new1', 'new2']);
  });

  test('补采集自身失败不把整页判成失败：首轮译文照常，观察器照常启动', async () => {
    let call = 0;
    const send = vi.fn(async (req: TranslateRequest) => {
      call++;
      if (call === 1) return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
      return { ok: false, error: 'HTTP 503', category: 'transient' as const };
    });
    const h = harness({ send });
    const src = source(items('a', 5), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(result.summary?.allFailed).toBe(false);
    expect(h.events).toContain('observer:start');
  });

  test('翻译项是现成的数组（不是采集函数）：没有可补的，行为与改动前一致', async () => {
    const h = harness();
    const result = await h.orch.togglePage(items('a', 5), 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.events).toContain('observer:start');
  });
});

describe('补采集没做完时悬浮球保持进行中（#1012）', () => {
  /** 把发送也记进事件序列，断言推送的先后 */
  function ordered(extra: Partial<OrchestratorOptions> = {}) {
    const events: string[] = [];
    let translated = false;
    const releases: (() => void)[] = [];
    const send = vi.fn(
      (req: TranslateRequest) =>
        new Promise((r) => {
          events.push(`send:${req.texts[0]}`);
          releases.push(() => {
            events.push(`back:${req.texts[0]}`);
            r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
          });
        }),
    );
    const orch = createOrchestrator({
      send,
      hasTranslated: () => translated,
      restore: () => {
        translated = false;
      },
      onBatchResult: () => {
        translated = true;
      },
      pushStatus: (s) => events.push(`push:${s}`),
      onObserverStart: () => events.push('observer:start'),
      onObserverStop: () => events.push('observer:stop'),
      sleep: async () => {},
      ...extra,
    });
    orch.start();
    /** 放行所有在飞的请求，直到不再有新的发出 */
    const drain = async () => {
      for (let i = 0; i < 100; i++) {
        await flush();
        const now = releases.splice(0);
        if (now.length === 0) return;
        now.forEach((f) => f());
      }
    };
    return { orch, events, releases, drain };
  }

  test('完成态在补采集返回之后才推：首轮翻完时球仍是进行中', async () => {
    const h = ordered();
    const src = source(items('a', 3), items('new', 3));
    const done = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    h.releases.shift()!(); // 首轮返回
    await flush();
    // 首轮已经翻完、补采集在飞：此刻只推过进行中
    expect(h.events.filter((e) => e.startsWith('push:'))).toEqual(['push:loading']);
    await h.drain();
    await done;
    expect(h.events).toEqual([
      'push:loading',
      'send:a0',
      'back:a0',
      'send:new0',
      'back:new0',
      'push:done',
      'observer:start',
    ]);
  });

  test('补采集期间点还原：状态回到空闲，之后不再推完成', async () => {
    const h = ordered();
    const src = source(items('a', 3), items('new', 3));
    const first = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    h.releases.shift()!();
    await flush();
    expect(h.events.at(-1)).toBe('send:new0');
    const restored = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(restored.status).toBe('restored');
    await h.drain();
    expect((await first).status).toBe('aborted');
    const pushes = h.events.filter((e) => e.startsWith('push:'));
    expect(pushes).toEqual(['push:loading', 'push:idle']);
  });

  test('没有新内容：首轮一返回就推完成，不多等一轮请求', async () => {
    const h = ordered();
    const src = source(items('a', 3), []);
    const done = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    h.releases.shift()!();
    await done;
    expect(h.events).toEqual(['push:loading', 'send:a0', 'back:a0', 'push:done', 'observer:start']);
  });

  test('首轮失败：照旧推错误态，不进补采集', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'HTTP 503', category: 'transient' as const }));
    const h = ordered({ send });
    const src = source(items('a', 3), items('new', 3));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('error');
    expect(h.events).toEqual(['push:loading', 'push:error']);
  });
});
