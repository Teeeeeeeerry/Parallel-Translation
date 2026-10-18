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
  RECOLLECT_MAX_ROUNDS,
  RECOLLECT_INTERVAL_MS,
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
    // 首轮采集、补采集第一轮补到 3 个、第二轮没有新单元结束（#1013）
    expect(src.collects()).toBe(3);
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
    expect(result.status).toBe('abandoned');
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
    expect(result.status).toBe('abandoned');
    expect(h.events).not.toContain('observer:start');
  });

  test('补采集在飞时点还原：在飞的补采集批次收到中止，回来的译文不渲染（#1073）', async () => {
    const replies: ((v: unknown) => void)[] = [];
    const signals: AbortSignal[] = [];
    const rendered: string[] = [];
    let translated = false;
    const send = vi.fn(
      (req: TranslateRequest, ctl?: { signal: AbortSignal }) =>
        new Promise((r) => {
          signals.push(ctl!.signal);
          replies.push(() => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } }));
        }),
    );
    const h = harness({
      send: send as OrchestratorOptions['send'],
      hasTranslated: () => translated,
      onBatchResult: (_i, batch) => {
        translated = true;
        rendered.push(...batch.map((b) => String(b.ctx)));
      },
    });
    const src = source(items('a', 3), items('new', 3));
    const pending = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    await flush();
    (replies.shift() as unknown as () => void)(); // 首轮返回
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);
    expect((await h.orch.togglePage(src.fn, 'en', 'zh-CN')).status).toBe('restored');
    expect(signals[1]!.aborted).toBe(true);
    // 后台没理会中止，照样把补采集这一批的译文送回来
    (replies.shift() as unknown as () => void)();
    expect((await pending).status).toBe('abandoned');
    expect(rendered).toEqual(['a0', 'a1', 'a2']);
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
    expect((await first).status).toBe('abandoned');
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

describe('补采集最多补几轮（#1013）', () => {
  test('第二轮才出现的内容被补到', async () => {
    const h = harness();
    const src = source(items('a', 5), items('new', 3), items('late', 2), []);
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(h.sent).toEqual([...items('a', 5), ...items('new', 3), ...items('late', 2)].map((it) => it.text));
    expect(src.collects()).toBe(4);
  });

  test('到达轮数上限后不再补：剩下的交给观察器', async () => {
    const h = harness();
    const rounds = Array.from({ length: RECOLLECT_MAX_ROUNDS + 2 }, (_, i) => items(`r${i}-`, 2));
    const src = source(items('a', 5), ...rounds);
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    await flush();
    // 首轮一次，补采集封顶 RECOLLECT_MAX_ROUNDS 次，到顶后在观察器启动那一刻
    // 再采一次交给增量补翻（#1036），之后不再有轮次
    expect(src.collects()).toBe(2 + RECOLLECT_MAX_ROUNDS);
    const expected = [items('a', 5), ...rounds.slice(0, RECOLLECT_MAX_ROUNDS + 1)].flat().map((it) => it.text);
    expect(h.sent).toEqual(expected);
    expect(h.sent).not.toContain(`r${RECOLLECT_MAX_ROUNDS + 1}-0`);
    expect(h.events.filter((e) => e === 'observer:start')).toHaveLength(1);
  });

  test('某一轮没有新单元就提前结束，后面的轮次不再采集', async () => {
    const h = harness();
    const src = source(items('a', 5), items('new', 3), [], items('never', 2));
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(src.collects()).toBe(3);
    expect(h.sent).not.toContain('never0');
  });

  test('轮与轮之间等一个间隔：第一轮紧接首轮，之后每轮先等再采集', async () => {
    const order: string[] = [];
    const h = harness({
      sleep: async (ms: number) => {
        order.push(`sleep:${ms}`);
      },
    });
    const src = source(items('a', 5), items('new', 3), items('late', 2), []);
    const fn = vi.fn((mode?: { readOnly: boolean }) => {
      if (!mode?.readOnly) order.push('collect');
      return src.fn(mode);
    });
    await h.orch.togglePage(fn, 'en', 'zh-CN');
    expect(order).toEqual([
      'collect',
      'collect',
      `sleep:${RECOLLECT_INTERVAL_MS}`,
      'collect',
      `sleep:${RECOLLECT_INTERVAL_MS}`,
      'collect',
    ]);
  });

  test('没有新内容的页面不多等：补采集第一轮为空时一次间隔都不等', async () => {
    const sleeps: number[] = [];
    const h = harness({
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    const src = source(items('a', 5), []);
    await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(sleeps).not.toContain(RECOLLECT_INTERVAL_MS);
  });

  test('轮间等待期间点还原：下一轮不再采集、不再发出，这一次报中止', async () => {
    let wake!: () => void;
    const h = harness({
      sleep: (ms: number) =>
        ms === RECOLLECT_INTERVAL_MS ? new Promise<void>((r) => (wake = r)) : Promise.resolve(),
    });
    const src = source(items('a', 5), items('new', 3), items('late', 2));
    const pending = h.orch.togglePage(src.fn, 'en', 'zh-CN');
    for (let i = 0; i < 20 && !wake; i++) await flush();
    expect(src.collects()).toBe(2);
    const restored = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(restored.status).toBe('restored');
    wake();
    const result = await pending;
    expect(result.status).toBe('abandoned');
    expect(src.collects()).toBe(2);
    expect(h.sent).not.toContain('late0');
    expect(h.events).not.toContain('observer:start');
  });

  test('控制台记下每轮补了多少', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const h = harness();
      const src = source(items('a', 5), items('new', 3), items('late', 2), []);
      await h.orch.togglePage(src.fn, 'en', 'zh-CN');
      const lines = info.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('第 1 轮') && l.includes('3'))).toBe(true);
      expect(lines.some((l) => l.includes('第 2 轮') && l.includes('2'))).toBe(true);
    } finally {
      info.mockRestore();
    }
  });
});

describe('补采集到顶那一轮在飞期间插入的内容（#1036）', () => {
  /** 记下采集、观察器启动、发送三类事件的先后 */
  function ordered() {
    const order: string[] = [];
    const h = harness({ onObserverStart: () => order.push('observer:start') });
    h.send.mockImplementation(async (req: TranslateRequest) => {
      order.push(`send:${req.texts.join(',')}`);
      h.sent.push(...req.texts);
      return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
    });
    return { h, order };
  }

  test('补满轮数：观察器启动之前紧挨着再采一次，采到的发出去，观察器照常只启动一次', async () => {
    const { h, order } = ordered();
    const rounds = Array.from({ length: RECOLLECT_MAX_ROUNDS + 1 }, (_, i) => items(`r${i}-`, 1));
    const src = source(items('a', 2), ...rounds);
    const fn = vi.fn((mode?: { readOnly: boolean }) => {
      if (!mode?.readOnly) order.push('collect');
      return src.fn(mode);
    });
    const result = await h.orch.togglePage(fn, 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    await flush();
    const late = `r${RECOLLECT_MAX_ROUNDS}-0`;
    // 最后一次采集与观察器启动之间什么都没有；交出的单元在启动之后发出
    const start = order.indexOf('observer:start');
    expect(order[start - 1]).toBe('collect');
    expect(order.slice(start + 1)).toEqual([`send:${late}`]);
    expect(h.sent.filter((t) => t === late)).toHaveLength(1);
    expect(order.filter((e) => e === 'observer:start')).toHaveLength(1);
  });

  test('没补满（某一轮为空提前结束）：不多采一次，与改动前一致', async () => {
    const { h, order } = ordered();
    const src = source(items('a', 2), items('new', 1), [], items('never', 1));
    const fn = vi.fn((mode?: { readOnly: boolean }) => {
      if (!mode?.readOnly) order.push('collect');
      return src.fn(mode);
    });
    await h.orch.togglePage(fn, 'en', 'zh-CN');
    await flush();
    expect(src.collects()).toBe(3);
    expect(h.sent).not.toContain('never0');
    expect(order.at(-1)).toBe('observer:start');
  });

  test('整页翻译失败：观察器不启动，也不多采', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'HTTP 503', category: 'transient' as const }));
    const h = harness({ send });
    const rounds = Array.from({ length: RECOLLECT_MAX_ROUNDS + 1 }, (_, i) => items(`r${i}-`, 1));
    const src = source(items('a', 2), ...rounds);
    const result = await h.orch.togglePage(src.fn, 'en', 'zh-CN');
    expect(result.status).toBe('error');
    expect(src.collects()).toBe(1);
    expect(h.events).not.toContain('observer:start');
  });
});
