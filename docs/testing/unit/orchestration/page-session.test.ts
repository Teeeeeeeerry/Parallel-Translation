/**
 * 整页翻译会话：首轮与补采集的采集去重、按轮统计（#1077，父 #1067）
 *
 * 会话配真实的采集（walker 的 collect）与真实的渲染（renderer 的 render），
 * jsdom 搭页面，假发送层；经编排模块的整页开关入口 togglePage 断言外部行为：
 * 最终送翻了哪些文本、每段送了几次、什么时候推完成、观察器什么时候启动、还原
 * 之后还发不发。翻译期间懒加载出来的内容就是往 DOM 里插段落，不再用“按调用
 * 次数交出单元”的假采集（原 recollect.test.ts 的用例迁到这里，#1011、#1012、
 * #1013、#1036 的断言含义不变）。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { render, unrender, type RenderResult } from '~/src/dom/renderer';
import {
  createOrchestrator,
  RECOLLECT_MAX_ROUNDS,
  RECOLLECT_INTERVAL_MS,
  type OrchestratorOptions,
  type TranslateItem,
} from '~/src/orchestration/orchestrator';
import { createPageSession, type PageSession } from '~/src/orchestration/page-session';
import type { TranslateRequest } from '~/src/engines/types';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

const flush = () => new Promise((r) => setTimeout(r, 0));

let restoreRects: () => void;
beforeEach(() => {
  restoreRects = mockAllBoundingRects();
});
afterEach(() => {
  restoreRects();
  document.body.innerHTML = '';
});

/** 往页面末尾插 n 段英文正文，文字是 `${tag}${i} …`。 */
function addParas(tag: string, n: number): string[] {
  const texts = Array.from({ length: n }, (_, i) => `${tag}${i} is a paragraph of English text on the page.`);
  for (const t of texts) {
    const p = document.createElement('p');
    p.textContent = t;
    document.body.appendChild(p);
  }
  return texts;
}

/** 渲染原语：真实渲染（落完成标记）或不落标记的替身（#1056 的情形）。 */
type Renderer = (item: TranslateItem<Element>, translation: string) => RenderResult;
const realRender: Renderer = (item, t) => render(item.ctx, t, 'page', item.text);
const unmarkedRender: Renderer = (item, t) => {
  item.ctx.setAttribute('data-test-translated', t);
  return { rendered: true };
};

/** 真实 DOM 原语搭的会话；collects 数照常翻译的那次采集调用了几次。 */
function session(renderOne: Renderer = realRender) {
  const counter = { collects: 0 };
  const s = createPageSession<Element>({
    collect: (onSkip) => {
      counter.collects++;
      return collect(document.body, undefined, { onSkip });
    },
    collectReadOnly: () => collect(document.body, undefined, { readOnly: true }),
    build: (el) => ({ text: el.textContent!.trim(), ctx: el }),
    render: renderOne,
  });
  return Object.defineProperty(s, 'collects', { get: () => counter.collects }) as PageSession<Element> & {
    readonly collects: number;
  };
}

const translated = () => document.querySelector('[data-pt="done"]') !== null;

/**
 * 编排模块 + 假发送层。onSend 在每一批发出时调用（第几次发送、这批的文字），
 * 用来模拟翻译期间懒加载出来的内容；send 可整个替换。
 */
function harness(extra: Partial<OrchestratorOptions> & { onSend?: (n: number, texts: string[]) => void } = {}) {
  const { onSend, ...opts } = extra;
  const events: string[] = [];
  const sent: string[] = [];
  let sends = 0;
  const send = vi.fn(async (req: TranslateRequest) => {
    sent.push(...req.texts);
    onSend?.(++sends, req.texts);
    return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
  });
  const orch = createOrchestrator({
    send,
    hasTranslated: translated,
    restore: () => {
      document.querySelectorAll('[data-pt="done"]').forEach((el) => unrender(el));
      events.push('restore');
    },
    pushStatus: (s) => events.push(`push:${s}`),
    onObserverStart: () => events.push('observer:start'),
    onObserverStop: () => events.push('observer:stop'),
    sleep: async () => {},
    ...opts,
  });
  orch.start();
  return { orch, send, sent, events };
}

describe('补采集去重是会话自己保证的，不靠完成标记（#1056）', () => {
  test('渲染不落完成标记：补采集不重复送翻，每段只送一次', async () => {
    const first = addParas('a', 30);
    const late: string[] = [];
    const h = harness({ onSend: (n) => n === 1 && late.push(...addParas('lazy', 3)) });
    const s = session(unmarkedRender);

    const result = await h.orch.togglePage(s, 'en', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(document.querySelector('[data-pt="done"]')).toBeNull();
    expect(h.sent).toEqual([...first, ...late]);
    // 首轮、补采集第一轮补到 3 段、第二轮没有新单元结束
    expect(s.collects).toBe(3);
  });

  test('翻失败的、译文与原文相同没落标记的单元：补采集不再交出（失败的重试归批次重试管）', async () => {
    const texts = addParas('a', 3);
    let call = 0;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) => {
        call++;
        // 第一段译文与原文相同（被兜底拦下、不落标记），其余正常
        return { ok: true, data: { translations: req.texts.map((t, i) => (i === 0 ? t : `T(${t})`)) } };
      }),
    });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    expect(call).toBe(1);
    expect(s.collects).toBe(2);
    expect(texts).toHaveLength(3);
  });
});

describe('翻译期间插入的内容被补上（#1011）', () => {
  test('首轮在飞期间插入段落：整页翻译结束后被翻译，观察器在补完之后才启动', async () => {
    const first = addParas('a', 30);
    const late: string[] = [];
    let observerSawSent = -1;
    const h = harness({
      onSend: (n) => n === 1 && late.push(...addParas('new', 3)),
      onObserverStart: () => (observerSawSent = h.sent.length),
    });
    const result = await h.orch.togglePage(session(), 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(h.sent).toEqual([...first, ...late]);
    expect(observerSawSent).toBe(first.length + late.length);
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(first.length + late.length);
  });

  test('补采集没有新单元：不多发任何请求，观察器照常启动', async () => {
    addParas('a', 5);
    const h = harness();
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(s.collects).toBe(2);
    expect(h.events).toContain('observer:start');
  });

  test('整页翻译失败：一轮都不补，观察器不启动', async () => {
    addParas('a', 5);
    const h = harness({
      send: vi.fn(async () => {
        addParas('new', 3);
        return { ok: false, error: 'HTTP 503', category: 'transient' };
      }),
    });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('error');
    expect(s.collects).toBe(1);
    expect(h.events).not.toContain('observer:start');
  });

  test('站点没准入：一次都不采集', async () => {
    addParas('a', 5);
    const h = harness({
      getSettings: () => ({ ...DEFAULT_SETTINGS, siteList: { mode: 'blacklist', list: ['example.com'] } }),
      getHostname: () => 'example.com',
    });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('blocked');
    expect(s.collects).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  test('页面级闸门拦下：不采集、不补', async () => {
    addParas('a', 5);
    const h = harness({ getPageLang: () => 'zh-CN' });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('same-language');
    expect(s.collects).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });

  test('首轮翻译在飞时被中止：不补', async () => {
    addParas('a', 3);
    let release!: () => void;
    const h = harness({
      send: vi.fn(
        (req: TranslateRequest) =>
          new Promise((r) => {
            addParas('new', 3);
            release = () => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
          }),
      ),
    });
    const s = session();
    const pending = h.orch.togglePage(s, 'en', 'zh-CN');
    await flush();
    h.orch.abort();
    release();
    expect((await pending).status).toBe('abandoned');
    expect(s.collects).toBe(1);
    expect(h.events).not.toContain('observer:start');
  });

  test('补采集在飞时点还原：在飞的补采集批次收到中止、回来的译文不渲染，观察器不启动', async () => {
    const first = addParas('a', 3);
    const replies: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const sent: string[] = [];
    const h = harness({
      send: vi.fn(
        (req: TranslateRequest, ctl?: { signal: AbortSignal }) =>
          new Promise((r) => {
            if (signals.length === 0) addParas('new', 3);
            sent.push(...req.texts);
            signals.push(ctl!.signal);
            replies.push(() => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } }));
          }),
      ) as OrchestratorOptions['send'],
    });
    const pending = h.orch.togglePage(session(), 'en', 'zh-CN');
    await flush();
    replies.shift()!(); // 首轮返回
    await flush();
    expect(signals).toHaveLength(2);
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    expect(signals[1]!.aborted).toBe(true);
    // 后台没理会中止，照样把补采集这一批的译文送回来
    replies.shift()!();
    expect((await pending).status).toBe('abandoned');
    expect(sent.slice(0, first.length)).toEqual(first);
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(0);
    expect(h.events).not.toContain('observer:start');
  });

  test('准入不重判：首轮之后用户关了总开关，这一次的补采集照常补完', async () => {
    addParas('a', 5);
    let enabled = true;
    const late: string[] = [];
    const h = harness({
      onSend: (n) => {
        enabled = false;
        if (n === 1) late.push(...addParas('new', 3));
      },
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled }),
      getHostname: () => 'example.com',
    });
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1]![0].texts).toEqual(late);
  });

  test('补采集自身失败不把整页判成失败：首轮译文照常，观察器照常启动', async () => {
    addParas('a', 5);
    let call = 0;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) => {
        call++;
        if (call === 1) {
          addParas('new', 3);
          return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
        }
        return { ok: false, error: 'HTTP 503', category: 'transient' };
      }),
    });
    const result = await h.orch.togglePage(session(), 'en', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(result.summary?.allFailed).toBe(false);
    expect(h.events).toContain('observer:start');
  });
});

describe('补采集没做完时悬浮球保持进行中（#1012）', () => {
  /** 把发送也记进事件序列；回复由用例放行 */
  function ordered(extra: Partial<OrchestratorOptions> = {}) {
    const releases: (() => void)[] = [];
    const h = harness({
      send: vi.fn(
        (req: TranslateRequest) =>
          new Promise((r) => {
            h.events.push(`send:${req.texts[0]!.split(' ')[0]}`);
            releases.push(() => {
              h.events.push(`back:${req.texts[0]!.split(' ')[0]}`);
              r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
            });
          }),
      ),
      ...extra,
    });
    const drain = async () => {
      for (let i = 0; i < 100; i++) {
        await flush();
        const now = releases.splice(0);
        if (now.length === 0) return;
        now.forEach((f) => f());
      }
    };
    return { ...h, releases, drain };
  }

  test('完成态在补采集返回之后才推：首轮翻完时球仍是进行中', async () => {
    addParas('a', 3);
    const h = ordered();
    const done = h.orch.togglePage(session(), 'en', 'zh-CN');
    await flush();
    addParas('new', 3);
    h.releases.shift()!(); // 首轮返回
    await flush();
    expect(h.events.filter((e) => e.startsWith('push:'))).toEqual(['push:loading']);
    await h.drain();
    await done;
    expect(h.events).toEqual(['push:loading', 'send:a0', 'back:a0', 'send:new0', 'back:new0', 'push:done', 'observer:start']);
  });

  test('补采集期间点还原：状态回到空闲，之后不再推完成', async () => {
    addParas('a', 3);
    const h = ordered();
    const first = h.orch.togglePage(session(), 'en', 'zh-CN');
    await flush();
    addParas('new', 3);
    h.releases.shift()!();
    await flush();
    expect(h.events.at(-1)).toBe('send:new0');
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    await h.drain();
    expect((await first).status).toBe('abandoned');
    expect(h.events.filter((e) => e.startsWith('push:'))).toEqual(['push:loading', 'push:idle']);
  });

  test('没有新内容：首轮一返回就推完成，不多等一轮请求', async () => {
    addParas('a', 3);
    const h = ordered();
    const done = h.orch.togglePage(session(), 'en', 'zh-CN');
    await flush();
    h.releases.shift()!();
    await done;
    expect(h.events).toEqual(['push:loading', 'send:a0', 'back:a0', 'push:done', 'observer:start']);
  });

  test('首轮失败：照旧推错误态，不进补采集', async () => {
    addParas('a', 3);
    const h = harness({ send: vi.fn(async () => ({ ok: false, error: 'HTTP 503', category: 'transient' })) });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('error');
    expect(h.events).toEqual(['push:loading', 'push:error']);
    expect(s.collects).toBe(1);
  });
});

describe('补采集最多补几轮（#1013）', () => {
  test('第二轮才出现的内容被补到', async () => {
    const a = addParas('a', 5);
    const more: string[] = [];
    const h = harness({
      onSend: (n) => {
        if (n === 1) more.push(...addParas('new', 3));
        if (n === 2) more.push(...addParas('late', 2));
      },
    });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    expect(h.sent).toEqual([...a, ...more]);
    expect(s.collects).toBe(4);
  });

  test('持续懒加载：到达轮数上限后不再补，到顶那一刻再采一次交给增量补翻（#1036）', async () => {
    const a = addParas('a', 5);
    const rounds: string[][] = [];
    // 每发一批就再冒出两段：补采集永远补不完
    const h = harness({ onSend: () => rounds.push(addParas(`r${rounds.length}-`, 2)) });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    await flush();
    // 首轮一次，补采集封顶 RECOLLECT_MAX_ROUNDS 次，到顶后在观察器启动那一刻再采一次
    expect(s.collects).toBe(2 + RECOLLECT_MAX_ROUNDS);
    expect(h.sent).toEqual([...a, ...rounds.slice(0, RECOLLECT_MAX_ROUNDS + 1).flat()]);
    expect(h.events.filter((e) => e === 'observer:start')).toHaveLength(1);
  });

  test('某一轮没有新单元就提前结束，后面的轮次不再采集', async () => {
    addParas('a', 5);
    const h = harness({ onSend: (n) => n === 1 && addParas('new', 3) });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    addParas('never', 2);
    expect(s.collects).toBe(3);
    expect(h.sent.some((t) => t.startsWith('never'))).toBe(false);
  });

  test('轮与轮之间等一个间隔：第一轮紧接首轮，之后每轮先等再采集', async () => {
    addParas('a', 5);
    const order: string[] = [];
    const h = harness({
      onSend: (n) => {
        if (n === 1) addParas('new', 3);
        if (n === 2) addParas('late', 2);
      },
      sleep: async (ms: number) => {
        order.push(`sleep:${ms}`);
      },
    });
    const s = session();
    const orig = s.collectRound.bind(s);
    s.collectRound = () => {
      order.push('collect');
      return orig();
    };
    await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(order).toEqual(['collect', 'collect', `sleep:${RECOLLECT_INTERVAL_MS}`, 'collect', `sleep:${RECOLLECT_INTERVAL_MS}`, 'collect']);
  });

  test('没有新内容的页面不多等：补采集第一轮为空时一次间隔都不等', async () => {
    addParas('a', 5);
    const sleeps: number[] = [];
    const h = harness({ sleep: async (ms: number) => void sleeps.push(ms) });
    await h.orch.togglePage(session(), 'en', 'zh-CN');
    expect(sleeps).not.toContain(RECOLLECT_INTERVAL_MS);
  });

  test('轮间等待期间点还原：下一轮不再采集、不再发出，这一次报中止', async () => {
    addParas('a', 5);
    let wake!: () => void;
    const h = harness({
      onSend: (n) => {
        if (n === 1) addParas('new', 3);
        if (n === 2) addParas('late', 2);
      },
      sleep: (ms: number) => (ms === RECOLLECT_INTERVAL_MS ? new Promise<void>((r) => (wake = r)) : Promise.resolve()),
    });
    const s = session();
    const pending = h.orch.togglePage(s, 'en', 'zh-CN');
    for (let i = 0; i < 20 && !wake; i++) await flush();
    expect(s.collects).toBe(2);
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    wake();
    expect((await pending).status).toBe('abandoned');
    expect(s.collects).toBe(2);
    expect(h.sent.some((t) => t.startsWith('late'))).toBe(false);
    expect(h.events).not.toContain('observer:start');
  });

  test('控制台记下每轮补了多少', async () => {
    addParas('a', 5);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const h = harness({
        onSend: (n) => {
          if (n === 1) addParas('new', 3);
          if (n === 2) addParas('late', 2);
        },
      });
      await h.orch.togglePage(session(), 'en', 'zh-CN');
      const lines = info.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('第 1 轮') && l.includes('3'))).toBe(true);
      expect(lines.some((l) => l.includes('第 2 轮') && l.includes('2'))).toBe(true);
    } finally {
      info.mockRestore();
    }
  });
});

describe('补采集到顶那一轮在飞期间插入的内容（#1036）', () => {
  test('补满轮数：最后一轮在飞期间插入的段落被补上，只送一次，观察器只启动一次', async () => {
    addParas('a', 2);
    const order: string[] = [];
    let n = 0;
    const late: string[] = [];
    const h = harness({
      onObserverStart: () => order.push('observer:start'),
      onSend: (_i, texts) => {
        order.push(`send:${texts[0]!.split(' ')[0]}`);
        // 首轮与补采集的每一轮在飞期间都冒出一段；第 RECOLLECT_MAX_ROUNDS 轮在飞期间冒出的那段只有到顶交接能接住
        if (n <= RECOLLECT_MAX_ROUNDS) late.push(...addParas(`r${n++}-`, 1));
      },
    });
    const s = session();
    const orig = s.collectRound.bind(s);
    s.collectRound = () => {
      order.push('collect');
      return orig();
    };
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    await flush();
    const last = late.at(-1)!;
    const start = order.indexOf('observer:start');
    expect(order[start - 1]).toBe('collect');
    expect(order.slice(start + 1)).toEqual([`send:${last.split(' ')[0]}`]);
    expect(h.sent.filter((t) => t === last)).toHaveLength(1);
    expect(order.filter((e) => e === 'observer:start')).toHaveLength(1);
  });

  test('没补满（某一轮为空提前结束）：不多采一次', async () => {
    addParas('a', 2);
    const h = harness({ onSend: (n) => n === 1 && addParas('new', 1) });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    await flush();
    expect(s.collects).toBe(3);
    expect(h.events.at(-1)).toBe('observer:start');
  });
});

describe('统计按轮分开记（#1077）', () => {
  /** 发送替身：以 same 开头的段落译文与原文相同（渲染层不插入，#783），其余正常。 */
  const sameOrTranslated = (req: TranslateRequest) => ({
    ok: true,
    data: { translations: req.texts.map((t) => (t.startsWith('same') ? t : `T(${t})`)) },
  });

  test('首轮全部渲染被拒：报错误态；首轮在飞时另一路增量补翻渲染成功，不掺进首轮的统计', async () => {
    addParas('same', 2);
    let incrementalRendered = 0;
    const h = harness({
      onBatchResult: (_i, batch, result) => {
        if (result.ok) incrementalRendered += batch.length;
      },
    });
    let first = true;
    h.send.mockImplementation(async (req: TranslateRequest) => {
      h.sent.push(...req.texts);
      if (first) {
        first = false;
        // 观察器那一路的增量补翻（走 onBatchResult，不经会话）在首轮在飞时完成
        await h.orch.translatePage([{ text: 'incremental text', ctx: null }], 'en', 'zh-CN');
      }
      return sameOrTranslated(req);
    });
    const s = session();
    const result = await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(incrementalRendered).toBe(1);
    expect(s.roundStats(0)).toMatchObject({ succeeded: 0, sameAsSource: 2 });
    expect(result.status).toBe('error');
  });

  test('首轮成功、补采集那一轮全部被拒：首轮判定不受影响；汇总是两轮相加', async () => {
    addParas('a', 2);
    const h = harness({ send: vi.fn(async (req: TranslateRequest) => {
      if (req.texts[0]!.startsWith('a')) addParas('same', 1);
      return sameOrTranslated(req);
    }) });
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    expect(s.roundStats(0)).toMatchObject({ succeeded: 2, sameAsSource: 0 });
    expect(s.roundStats(1)).toMatchObject({ succeeded: 0, sameAsSource: 1 });
    expect(s.totals()).toMatchObject({ succeeded: 2, sameAsSource: 1, failed: 0 });
  });

  test('某一批引擎失败：失败的段落记在它所在那一轮', async () => {
    addParas('a', 2);
    let call = 0;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) => {
        call++;
        if (call === 1) {
          addParas('new', 3);
          return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
        }
        return { ok: false, error: 'HTTP 503', category: 'transient' };
      }),
    });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(s.roundStats(0)).toMatchObject({ succeeded: 2, failed: 0 });
    expect(s.roundStats(1)).toMatchObject({ succeeded: 0, failed: 3 });
  });

  test('还原后再翻是新的会话：去重记录与统计从头来', async () => {
    const a = addParas('a', 3);
    const h = harness();
    const s1 = session();
    await h.orch.togglePage(s1, 'en', 'zh-CN');
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    const s2 = session();
    expect((await h.orch.togglePage(s2, 'en', 'zh-CN')).status).toBe('translated');
    expect(h.sent).toEqual([...a, ...a]);
    expect(s2.totals()).toMatchObject({ succeeded: 3 });
  });

  test('跳过的单元只计一次：补采集不让“另有 N 段”翻倍', async () => {
    const long = document.createElement('p');
    long.textContent = 'word '.repeat(1200);
    document.body.appendChild(long);
    addParas('a', 2);
    const h = harness({ onSend: (n) => n === 1 && addParas('new', 1) });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(s.skips()['too-long']).toBe(1);
  });

  test('闸门取样读的是只读采集：不计轮、不交出', async () => {
    addParas('a', 3);
    const s = session();
    expect(s.readUnits()).toHaveLength(3);
    expect(s.collects).toBe(0);
    expect(s.collectRound()).toHaveLength(3);
  });
});
