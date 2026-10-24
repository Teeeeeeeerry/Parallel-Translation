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
  type OrchestratorOptions,
  type TranslateItem,
} from '~/src/orchestration/orchestrator';
import {
  createPageTranslation,
  RECOLLECT_MAX_ROUNDS,
  RECOLLECT_INTERVAL_MS,
  type IncrementalOutcome,
  type PageTranslation,
} from '~/src/orchestration/page-session';
import { allFailedNotice, incrementalNotice, partialFailNotice } from '~/src/orchestration/page-summary';
import type { TranslateRequest } from '~/src/engines/types';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import { translateItems } from './page-harness';

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

const translated = () => document.querySelector('[data-pt="done"]') !== null;

type TestPage = PageTranslation & { readonly collects: number };

interface HarnessOptions extends Partial<OrchestratorOptions> {
  /** 每一批发出时调用（第几次发送、这批的文字），用来模拟翻译期间懒加载出来的内容 */
  onSend?: (n: number, texts: string[]) => void;
  /** 渲染原语，缺省真实渲染 */
  render?: Renderer;
  /** 照常翻译的那次采集每调用一次就调用它 */
  onCollect?: () => void;
  /** 观察器启动时调用 */
  onObserve?: () => void;
}

let current: { page: TestPage } | null = null;

/** 这个用例的整页翻译（真实 DOM 原语搭的）；collects 数照常翻译的那次采集调用了几次。 */
function session(): TestPage {
  return current!.page;
}

/**
 * 编排模块 + 假发送层 + 真实 DOM 原语搭的整页翻译：翻译态以页面上的完成标记为准，
 * 还原撤回全部渲染，观察器启停记进事件序列。send 可整个替换。
 */
function harness(extra: HarnessOptions = {}) {
  const { onSend, render: renderOne = realRender, onCollect, onObserve, ...opts } = extra;
  const events: string[] = [];
  const sent: string[] = [];
  let sends = 0;
  let collects = 0;
  /** 观察器启动时会话交给它的回调：用例拿它模拟观察器看到新单元（#1118） */
  let onUnits: ((els: Element[]) => void) | null = null;
  const send = vi.fn(async (req: TranslateRequest) => {
    sent.push(...req.texts);
    onSend?.(++sends, req.texts);
    return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
  });
  const page = createPageTranslation<Element, Element>({
    collect: (onSkip, onHidden) => {
      collects++;
      onCollect?.();
      return collect(document.body, onHidden, { onSkip });
    },
    collectReadOnly: () => collect(document.body, undefined, { readOnly: true }),
    build: (el) => ({ text: el.textContent!.trim(), ctx: el }),
    render: renderOne,
    unrenderAll: () => {
      document.querySelectorAll('[data-pt="done"]').forEach((el) => unrender(el));
      events.push('restore');
    },
    hasTranslated: translated,
    observe: (deliver) => {
      onUnits = deliver;
      events.push('observer:start');
      onObserve?.();
      return {
        stop: () => events.push('observer:stop'),
        registerHidden: (el) => events.push(`hidden:${el.textContent!.split(' ')[0]}`),
      };
    },
  });
  Object.defineProperty(page, 'collects', { get: () => collects });
  // #1079：悬浮球的状态从整页翻译的状态流来
  page.subscribe((st) => events.push(`push:${st}`));
  const orch = createOrchestrator({
    send,
    sleep: async () => {},
    ...opts,
  });
  orch.start();
  current = { page: page as TestPage };
  /** 观察器看到这些元素（启动之前调用是用例写错了） */
  const observed = (els: Element[]) => onUnits!(els);
  return { orch, send, sent, events, observed, page: page as TestPage };
}

describe('补采集去重是会话自己保证的，不靠完成标记（#1056）', () => {
  test('渲染不落完成标记：补采集不重复送翻，每段只送一次', async () => {
    const first = addParas('a', 30);
    const late: string[] = [];
    const h = harness({ onSend: (n) => n === 1 && late.push(...addParas('lazy', 3)), render: unmarkedRender });
    const s = session();

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
      onObserve: () => (observerSawSent = h.sent.length),
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
      onCollect: () => order.push('collect'),
    });
    await h.orch.togglePage(session(), 'en', 'zh-CN');
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
      onObserve: () => order.push('observer:start'),
      onCollect: () => order.push('collect'),
      onSend: (_i, texts) => {
        order.push(`send:${texts[0]!.split(' ')[0]}`);
        // 首轮与补采集的每一轮在飞期间都冒出一段；第 RECOLLECT_MAX_ROUNDS 轮在飞期间冒出的那段只有到顶交接能接住
        if (n <= RECOLLECT_MAX_ROUNDS) late.push(...addParas(`r${n++}-`, 1));
      },
    });
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
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

  test('首轮全部渲染被拒：报错误态；首轮在飞时另一路送翻渲染成功，不掺进首轮的统计', async () => {
    addParas('same', 2);
    let incrementalRendered = 0;
    const h = harness();
    // 先拿到流水线（经一次整页开关，不发请求），首轮在飞时才能直接用
    await translateItems(h.orch, [], 'en', 'zh-CN');
    let first = true;
    h.send.mockImplementation(async (req: TranslateRequest) => {
      h.sent.push(...req.texts);
      if (first) {
        first = false;
        // 同一条流水线上另一路送翻（自己的 onBatch，不经会话）在首轮在飞时完成
        await translateItems(h.orch, [{ text: 'incremental text', ctx: null }], 'en', 'zh-CN', {
          onBatch: (batch, result) => {
            if (result.ok) incrementalRendered += batch.length;
          },
        });
      }
      return sameOrTranslated(req);
    });
    const s = session();
    const result = await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(incrementalRendered).toBe(1);
    expect(s.current()!.roundStats(0)).toMatchObject({ succeeded: 0, sameAsSource: 2 });
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
    expect(s.current()!.roundStats(0)).toMatchObject({ succeeded: 2, sameAsSource: 0 });
    expect(s.current()!.roundStats(1)).toMatchObject({ succeeded: 0, sameAsSource: 1 });
    expect(s.current()!.totals()).toMatchObject({ succeeded: 2, sameAsSource: 1, failed: 0 });
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
    expect(s.current()!.roundStats(0)).toMatchObject({ succeeded: 2, failed: 0 });
    expect(s.current()!.roundStats(1)).toMatchObject({ succeeded: 0, failed: 3 });
  });

  test('还原后再翻是新的会话：去重记录与统计从头来', async () => {
    const a = addParas('a', 3);
    const h = harness();
    await h.orch.togglePage(session(), 'en', 'zh-CN');
    const first = h.page.current();
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    expect(h.page.current()).toBeNull();
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(h.page.current()).not.toBe(first);
    expect(h.sent).toEqual([...a, ...a]);
    expect(h.page.current()!.totals()).toMatchObject({ succeeded: 3 });
  });

  test('跳过的单元只计一次：补采集不让“另有 N 段”翻倍', async () => {
    const long = document.createElement('p');
    long.textContent = 'word '.repeat(1200);
    document.body.appendChild(long);
    addParas('a', 2);
    const h = harness({ onSend: (n) => n === 1 && addParas('new', 1) });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    expect(s.current()!.skips()['too-long']).toBe(1);
  });

  test('闸门取样读的是只读采集：不计轮、不交出', async () => {
    addParas('a', 3);
    const s = harness().page;
    expect(s.readUnits()).toHaveLength(3);
    expect(s.collects).toBe(0);
    expect(s.begin().collectRound()).toHaveLength(3);
  });
});

describe('到顶交接、观察器、隐藏单元缓冲、还原归会话（#1078）', () => {
  /** 一段在采集时不可见（0×0）的段落 —— 采集把它交给观察器的延迟队列（#23）。 */
  function hiddenPara(tag: string): HTMLElement {
    const p = document.createElement('p');
    p.textContent = `${tag} is a paragraph that is collapsed for now.`;
    p.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    document.body.appendChild(p);
    return p;
  }

  test('到顶交接被等待：交接那一批回来之前整页开关不返回', async () => {
    addParas('a', 2);
    let n = 0;
    let releaseHandoff: (() => void) | null = null;
    const h = harness({
      send: vi.fn(
        (req: TranslateRequest) =>
          new Promise((r) => {
            const reply = () => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
            // 首轮与每一轮补采集在飞时都冒出一段：补满轮数，到顶交接那一批由用例放行
            if (n <= RECOLLECT_MAX_ROUNDS) {
              addParas(`r${n++}-`, 1);
              reply();
            } else releaseHandoff = reply;
          }),
      ),
    });
    let settled = false;
    const pending = h.orch.togglePage(session(), 'en', 'zh-CN').then((r) => {
      settled = true;
      return r;
    });
    for (let i = 0; i < 50 && !releaseHandoff; i++) await flush();
    expect(releaseHandoff).not.toBeNull();
    expect(h.events).toContain('observer:start');
    await flush();
    expect(settled).toBe(false);
    releaseHandoff!();
    expect((await pending).status).toBe('translated');
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(2 + RECOLLECT_MAX_ROUNDS + 1);
  });

  test('到顶交接自身失败：整页照常完成，观察器照常在', async () => {
    addParas('a', 2);
    let n = 0;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) => {
        if (n <= RECOLLECT_MAX_ROUNDS) {
          addParas(`r${n++}-`, 1);
          return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
        }
        return { ok: false, error: 'HTTP 503', category: 'transient' };
      }),
    });
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(h.events.filter((e) => e === 'observer:start')).toHaveLength(1);
    expect(h.events).not.toContain('observer:stop');
  });

  test('观察器启动前采集到的隐藏单元：启动那一刻交给观察器，之前不交', async () => {
    addParas('a', 2);
    hiddenPara('folded');
    let hiddenBeforeStart = 0;
    const h = harness({
      onSend: () => {
        hiddenBeforeStart = h.events.filter((e) => e.startsWith('hidden:')).length;
      },
    });
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(hiddenBeforeStart).toBe(0);
    const start = h.events.indexOf('observer:start');
    expect(h.events.slice(start + 1)).toEqual(['hidden:folded']);
    // 隐藏的那段没有送翻：要等它展开、由观察器交给增量补翻
    expect(h.sent.some((t) => t.startsWith('folded'))).toBe(false);
  });

  test('观察器启动之后才出现的隐藏单元（补采集采到的）：直接交给观察器', async () => {
    addParas('a', 2);
    let n = 0;
    const h = harness({
      onSend: () => {
        // 首轮与补采集都在飞时冒出一段，补满轮数；到顶交接那一次采集里多一段隐藏的
        if (n <= RECOLLECT_MAX_ROUNDS) addParas(`r${n++}-`, 1);
        if (n === RECOLLECT_MAX_ROUNDS + 1) {
          hiddenPara('late');
          n++;
        }
      },
    });
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(h.events.filter((e) => e === 'hidden:late')).toHaveLength(1);
  });

  test('还原：观察器停下、页面上没有任何译文；之后回来的译文也不渲染', async () => {
    addParas('a', 3);
    const h = harness();
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(3);
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('restored');
    expect(h.events.filter((e) => e === 'observer:stop')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(0);
    expect(h.page.hasTranslated()).toBe(false);
  });

  test('首轮在飞时还原：观察器从没启动，隐藏单元也不再交给它', async () => {
    addParas('a', 2);
    hiddenPara('folded');
    let release!: () => void;
    const h = harness({
      send: vi.fn(
        (req: TranslateRequest) =>
          new Promise((r) => {
            release = () => r({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } });
          }),
      ),
    });
    const pending = h.orch.togglePage(session(), 'en', 'zh-CN');
    await flush();
    h.orch.abort();
    h.page.restore();
    release();
    expect((await pending).status).toBe('abandoned');
    expect(h.events).not.toContain('observer:start');
    expect(h.events.some((e) => e.startsWith('hidden:'))).toBe(false);
  });
});

describe('会话的采集一轮：只交出新出现、没交出过的单元（#1011，原 page-collect 的用例）', () => {
  const para = (id: string, text: string) => {
    const p = document.createElement('p');
    p.id = id;
    p.textContent = text;
    document.body.appendChild(p);
    return p;
  };

  test('首轮翻好的、翻失败的、被兜底拦下的都不再交出；带完成标记的新段落不重翻', () => {
    para('ok', 'This paragraph was translated in the first pass.');
    para('failed', 'This paragraph failed in the first pass and stays original.');
    para('same', 'This paragraph came back identical and was not inserted.');
    const s = harness().page.begin();

    expect(s.collectRound().map((it) => (it.ctx as Element).id)).toEqual(['ok', 'failed', 'same']);
    render(document.getElementById('ok')!, 'Translated text for the first paragraph.');
    // failed：引擎失败，不渲染；same：译文与原文相同，渲染层不插入、不落标记（#783）
    const same = document.getElementById('same')!;
    expect(render(same, same.textContent!).rendered).toBe(false);
    expect(same.getAttribute('data-pt')).toBeNull();

    // 翻译期间懒加载出来两段；其中一段在补采集之前已经被逐段翻译翻好
    para('lazy', 'This paragraph appeared while the page was being translated.');
    const manual = para('manual', 'This paragraph was translated by hovering over it.');
    render(manual, 'Hover translation of the manual paragraph.', 'para');

    expect(s.collectRound().map((it) => (it.ctx as Element).id)).toEqual(['lazy']);
    // 再补一次：没有新的了
    expect(s.collectRound()).toEqual([]);
  });

  test('每次整页翻译新建一个会话：还原之后再点，所有单元重新交出', () => {
    para('a', 'First paragraph of the page.');
    const page = harness().page;
    expect(page.begin().collectRound().map((it) => (it.ctx as Element).id)).toEqual(['a']);
    page.restore();
    expect(page.begin().collectRound().map((it) => (it.ctx as Element).id)).toEqual(['a']);
  });
});

describe('悬浮球订阅整页翻译的状态流（#1079）', () => {
  test('补采集没做完时是进行中，补完才报完成；之后还原立即回到空闲', async () => {
    addParas('a', 3);
    const states: string[] = [];
    let seenWhileRecollecting: string | undefined;
    const h = harness({
      onSend: (n) => {
        if (n === 1) addParas('new', 2);
        if (n === 2) seenWhileRecollecting = states.at(-1);
      },
    });
    h.page.subscribe((st) => states.push(st));
    expect((await h.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('translated');
    expect(seenWhileRecollecting).toBe('loading');
    expect(states).toEqual(['loading', 'done']);
    const restoring = h.orch.togglePage(session(), 'en', 'zh-CN');
    // 还原是同步完成的：状态流在开关返回之前就报了空闲
    expect(states.at(-1)).toBe('idle');
    expect((await restoring).status).toBe('restored');
    expect(states).toEqual(['loading', 'done', 'idle']);
  });

  test('首轮全部失败报失败；页面级闸门拦下报空闲（不是完成）', async () => {
    addParas('a', 2);
    const failing = harness({ send: vi.fn(async () => ({ ok: false, error: 'HTTP 503', category: 'transient' })) });
    const a: string[] = [];
    failing.page.subscribe((st) => a.push(st));
    await failing.orch.togglePage(session(), 'en', 'zh-CN');
    expect(a).toEqual(['loading', 'error']);

    const gated = harness({ getPageLang: () => 'zh-CN' });
    const b: string[] = [];
    gated.page.subscribe((st) => b.push(st));
    expect((await gated.orch.togglePage(session(), 'en', 'zh-CN')).status).toBe('same-language');
    expect(b).toEqual(['idle']);
  });

  test('退订之后不再收到', async () => {
    addParas('a', 2);
    const h = harness();
    const states: string[] = [];
    const off = h.page.subscribe((st) => states.push(st));
    off();
    await h.orch.togglePage(session(), 'en', 'zh-CN');
    expect(states).toEqual([]);
  });
});

describe('增量补翻归会话（#1118）', () => {
  /** 下一次增量补翻的结局 */
  const nextIncremental = (page: PageTranslation) =>
    new Promise<IncrementalOutcome>((resolve) => {
      const off = page.onIncremental((o) => {
        off();
        resolve(o);
      });
    });

  /** 往页面末尾插几段，返回插进去的元素 */
  function lateParas(tag: string, n: number): Element[] {
    addParas(tag, n);
    return [...document.querySelectorAll('p')].slice(-n);
  }

  test('整页翻译完成后观察器看到的新段落被补翻、渲染，统计单独记一轮', async () => {
    addParas('a', 2);
    const h = harness();
    const s = session();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('translated');
    const rounds = s.current()!.totals();

    const els = lateParas('late', 2);
    const outcome = nextIncremental(s);
    h.observed(els);
    expect(await outcome).toMatchObject({ status: 'translated', stats: { succeeded: 2, failed: 0 } });
    for (const el of els) {
      expect(el.getAttribute('data-pt')).toBe('done');
      expect(el.querySelector('.pt-trans')!.textContent).toBe(`T(${el.querySelector('.pt-origin')!.textContent})`);
    }
    expect(s.current()!.totals().succeeded).toBe(rounds.succeeded + 2);
  });

  test('已翻过的段落不会在增量补翻里二次送翻', async () => {
    addParas('a', 2);
    const h = harness();
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    const before = h.sent.length;

    const late = addParas('late', 1);
    const first = nextIncremental(s);
    // 观察器把首轮翻过的段落与新段落一起交过来
    h.observed([...document.querySelectorAll('p')]);
    await first;
    expect(h.sent.slice(before)).toEqual(late);

    // 同一批再交一次：一个都不送，不报结局
    const sends = h.send.mock.calls.length;
    h.observed([...document.querySelectorAll('p')]);
    await flush();
    expect(h.send.mock.calls.length).toBe(sends);
  });

  test('部分段落失败：结局带失败数，提示与首轮同一套判定', async () => {
    addParas('a', 1);
    let partial = false;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) => ({
        ok: true,
        data: { translations: req.texts.map((t) => `T(${t})`), ...(partial && { failedIndices: [0] }) },
      })),
    });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    partial = true;

    const outcome = nextIncremental(s);
    h.observed(lateParas('late', 2));
    const o = await outcome;
    expect(o).toMatchObject({ status: 'translated', stats: { succeeded: 1, failed: 1 } });
    expect(incrementalNotice(o)).toEqual(partialFailNotice(o.stats, o.summary.display));
    expect(incrementalNotice(o)).not.toBeNull();
  });

  test('全部失败：结局是失败，提示与首轮全部失败同一条', async () => {
    addParas('a', 1);
    let failing = false;
    const h = harness({
      send: vi.fn(async (req: TranslateRequest) =>
        failing
          ? { ok: false, error: 'HTTP 503', category: 'transient' }
          : { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } },
      ),
    });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    failing = true;

    const outcome = nextIncremental(s);
    h.observed(lateParas('late', 2));
    const o = await outcome;
    expect(o.status).toBe('error');
    expect(o.stats.failed).toBe(2);
    expect(incrementalNotice(o)).toEqual(allFailedNotice(o.summary.display));
  });

  test('补翻在飞时还原：结局是被放弃、不提示，译文不落回页面', async () => {
    addParas('a', 1);
    let reply: ((v: unknown) => void) | null = null;
    let hold = false;
    const h = harness({
      send: vi.fn((req: TranslateRequest) =>
        hold
          ? new Promise((r) => (reply = r))
          : Promise.resolve({ ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } }),
      ),
    });
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    hold = true;

    const els = lateParas('late', 1);
    const outcome = nextIncremental(s);
    h.observed(els);
    await flush();
    expect((await h.orch.togglePage(s, 'en', 'zh-CN')).status).toBe('restored');
    reply!({ ok: true, data: { translations: ['T(late)'] } });
    const o = await outcome;
    expect(o.status).toBe('abandoned');
    expect(incrementalNotice(o)).toBeNull();
    expect(els[0]!.getAttribute('data-pt')).toBeNull();
    expect(document.querySelector('[data-pt="done"]')).toBeNull();
  });

  test('还原之后观察器才交来的单元：不送翻（会话已经结束）', async () => {
    addParas('a', 1);
    const h = harness();
    const s = session();
    await h.orch.togglePage(s, 'en', 'zh-CN');
    await h.orch.togglePage(s, 'en', 'zh-CN');
    const sends = h.send.mock.calls.length;
    h.observed(lateParas('late', 1));
    await flush();
    expect(h.send.mock.calls.length).toBe(sends);
  });
});
