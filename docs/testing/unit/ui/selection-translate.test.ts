/**
 * 划词翻译入口（#726）
 *
 * 拖选划词与右键菜单都走 translateSelection。单文本翻译由替身注入，每次调用
 * 返回一个由用例决定何时兑现的承诺，借此造出“先发后到”。
 *
 * #750：并发只认最后一次 —— 先发的结果后到时整条丢弃：不替换等待态、不弹
 * 提示、页面不变；被丢弃的那一轮也不能收掉后发那一轮的等待态。
 *
 * #748：失败到达时等待态就地变成失败提示 —— 同一条提示换掉文字、摘掉转圈，
 * 中间没有一个两条都不在的瞬间；替换之后按状态类计时。四类失败（key 无效、
 * 配额、瞬时故障、站点禁用）的文案与改动前一致：前两类展示引擎给的真实
 * 原因，瞬时故障展示泛化文案（#313），站点禁用是固定文案。
 *
 * #749：等待态有最短显示时间 —— 引擎在它之前返回就等满再替换，慢的引擎到了
 * 就替换。译文与失败两条替换路径都管。断言的是“快返回时替换的时刻与引擎
 * 多快无关”“慢返回时到了就替换”这类关系，不写死毫秒数。等满期间又发起
 * 了一轮的，等满的那次已不是最新，丢弃（与 #750 的序号共存）。
 *
 * 只看外部可观察的行为：提示里显示了什么、同一时刻页面上有几条提示、
 * 等待态还在不在、一共弹出过哪些提示。
 */
import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createSelectionTranslator } from '~/src/ui/selection-translate';
import type { SingleTextResult } from '~/src/orchestration/orchestrator';
import { toast } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';

function toastRoot(): ShadowRoot | null {
  return document.getElementById('pt-host-toast')?.shadowRoot ?? null;
}

function toasts(): HTMLElement[] {
  const root = toastRoot();
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

function shown(): string[] {
  return toasts().map((el) => el.textContent ?? '');
}

function isPending(el: HTMLElement | undefined): boolean {
  return el?.dataset.state === 'pending';
}

const translating = () => chrome.i18n.getMessage('toastTranslating');

/** 引擎慢到超过等待态最短显示时间的一个时长（只要求“够慢”，不依赖具体数值）。 */
const SLOW = 2000;

/** 逐步推进假定时器直到这一轮划词收尾（十秒封顶）。 */
async function settle(run: Promise<void>): Promise<void> {
  let done = false;
  void run.finally(() => (done = true));
  for (let i = 0; i < 1000 && !done; i++) await vi.advanceTimersByTimeAsync(10);
  await run;
}

/** 让微任务（承诺兑现后的续体）跑完。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** 单文本翻译的替身：每次调用排一个由用例兑现的承诺。 */
function engine() {
  const calls: { text: string; resolve: (r: SingleTextResult) => void }[] = [];
  const translateText = vi.fn(
    (text: string) =>
      new Promise<SingleTextResult>((resolve) => {
        calls.push({ text, resolve });
      }),
  );
  const ok = (translation: string): SingleTextResult => ({ admission: 'allowed', ok: true, translation });
  return { calls, translateText, ok };
}

function translator(translateText: (text: string) => Promise<SingleTextResult>) {
  return createSelectionTranslator({
    translateText: (text) => translateText(text),
    getLangs: () => ({ from: 'auto', to: 'zh-CN' }),
    isMainFrame: true,
  });
}

/**
 * 记下从现在起页面上出现过的每一条提示的文字（含后来被替换掉的）—— 只看
 * 最终状态抓不住“弹出一下又被盖掉”的那一条。
 */
function recordShown(): { seen: string[]; stop(): void } {
  const seen: string[] = [];
  const snap = () => {
    const now = shown().join('|');
    if (seen[seen.length - 1] !== now) seen.push(now);
  };
  snap();
  const mo = new MutationObserver(snap);
  // 宿主可能还没挂上：挂在 document 上，subtree 不跨 shadow root，另挂 shadow
  mo.observe(document.documentElement, { childList: true, subtree: true });
  const root = toastRoot();
  if (root) mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  return {
    seen,
    stop() {
      snap();
      mo.disconnect();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  toasts().forEach((el) => el.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  unmountIsolated('toast');
});

describe('单次划词：行为不变', () => {
  test('先出现等待态，译文到达时就地替换', async () => {
    const e = engine();
    const run = translator(e.translateText)('Hello world');
    expect(shown()).toEqual([translating()]);
    vi.advanceTimersByTime(SLOW); // 引擎慢：过了最短显示时间才返回
    e.calls[0]!.resolve(e.ok('你好世界'));
    await run;
    expect(shown()).toEqual(['你好世界']);
    expect(toasts()[0]!.dataset.purpose).toBe('content');
  });
});

describe('并发只认最后一次（#750）', () => {
  test('先发后到：页面上留下的是最后一次的译文，先发那次的结果整条丢弃', async () => {
    const e = engine();
    const translate = translator(e.translateText);
    const first = translate('First sentence');
    const second = translate('Second sentence');
    const rec = recordShown();

    // 后发的先回来
    vi.advanceTimersByTime(SLOW); // 引擎慢：过了最短显示时间才返回
    e.calls[1]!.resolve(e.ok('第二句'));
    await second;
    expect(shown()).toEqual(['第二句']);

    // 先发的后回来：不盖掉第二句
    e.calls[0]!.resolve(e.ok('第一句'));
    await first;
    await flush();
    rec.stop();

    expect(shown()).toEqual(['第二句']);
    expect(toasts()).toHaveLength(1);
    // 第一句一次都没出现过
    expect(rec.seen.some((s) => s.includes('第一句'))).toBe(false);
  });

  test('先发的那轮先回来但已不是最新：不替换后发那轮的等待态、不弹提示，也不收掉它', async () => {
    const e = engine();
    const translate = translator(e.translateText);
    const first = translate('First sentence');
    void translate('Second sentence');
    const pendingEl = toasts()[0];
    const rec = recordShown();

    vi.advanceTimersByTime(SLOW); // 引擎慢：过了最短显示时间才返回
    e.calls[0]!.resolve(e.ok('第一句'));
    await first;
    await flush();
    rec.stop();

    // 后发那轮的转圈还在，还是同一条
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toBe(pendingEl);
    expect(isPending(toasts()[0])).toBe(true);
    expect(shown()).toEqual([translating()]);
    expect(rec.seen).toEqual([translating()]);

    // 后发那轮到达时照常就地替换
    e.calls[1]!.resolve(e.ok('第二句'));
    await flush();
    expect(shown()).toEqual(['第二句']);
  });

  test('先发那轮的失败同样丢弃：不弹失败提示', async () => {
    const e = engine();
    const translate = translator(e.translateText);
    const first = translate('First sentence');
    void translate('Second sentence');
    const rec = recordShown();

    e.calls[0]!.resolve({ admission: 'allowed', ok: false, error: 'timeout', display: { showRealReason: false } } as SingleTextResult);
    await first;
    await flush();
    rec.stop();

    expect(rec.seen).toEqual([translating()]);
    expect(isPending(toasts()[0])).toBe(true);
  });

  test('先发那轮抛错同样不收掉后发那轮的等待态', async () => {
    const calls: { reject: (e: Error) => void; resolve: (r: SingleTextResult) => void }[] = [];
    const translateText = (_: string) =>
      new Promise<SingleTextResult>((resolve, reject) => {
        calls.push({ resolve, reject });
      });
    const translate = translator(translateText);
    const first = translate('First sentence').catch(() => {});
    void translate('Second sentence');

    calls[0]!.reject(new Error('boom'));
    await first;
    await flush();

    expect(isPending(toasts()[0])).toBe(true);
  });
});

describe('状态类不受影响（#750）', () => {
  /** 一条状态类提示的外部表现：文字、样式、有没有关闭按钮、多久消失。 */
  function statusLook(msg: string, kind: 'info' | 'error') {
    toast(msg, { purpose: 'status', kind });
    const el = toasts()[0]!;
    const look = {
      text: el.textContent,
      kind: el.dataset.kind,
      purpose: el.dataset.purpose,
      close: el.querySelector('.pt-toast-close') !== null,
    };
    let elapsed = 0;
    while (shown().includes(msg) && elapsed < 600_000) {
      vi.advanceTimersByTime(100);
      elapsed += 100;
    }
    return { ...look, elapsed };
  }

  test('失败、配额、站点禁用：时长、样式、没有关闭按钮，三条一致', () => {
    const fail = statusLook(chrome.i18n.getMessage('toastTranslateFail'), 'error');
    const quota = statusLook('DeepL 返回 456：本月配额已用完。', 'error');
    const blocked = statusLook(chrome.i18n.getMessage('toastSiteBlocked'), 'error');
    for (const look of [fail, quota, blocked]) {
      expect(look).toMatchObject({ kind: 'error', purpose: 'status', close: false, elapsed: 3000 });
    }
  });

  test('经划词入口弹出的失败与站点禁用仍是状态类', async () => {
    const blocked = translator(async () => ({ admission: 'blocked', ok: false }));
    await settle(blocked('Hello'));
    expect(shown()).toEqual([chrome.i18n.getMessage('toastSiteBlocked')]);
    expect(toasts()[0]!.dataset.purpose).toBe('status');
    expect(toasts()[0]!.querySelector('.pt-toast-close')).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);

    const quota = translator(async () => ({
      admission: 'allowed',
      ok: false,
      error: 'DeepL 返回 456：本月配额已用完。',
      display: { showRealReason: true },
    }) as SingleTextResult);
    await settle(quota('Hello'));
    expect(shown()).toEqual(['DeepL 返回 456：本月配额已用完。']);
    expect(toasts()[0]!.dataset.purpose).toBe('status');
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);
  });
});

describe('失败到达时就地替换等待态（#748）', () => {
  const longReason = 'DeepL 返回 456：本月配额已用完，请到账户页查看用量与续费。'.repeat(8);
  const cases: { name: string; result: SingleTextResult; text: () => string }[] = [
    {
      name: 'key 无效：展示真实原因',
      result: {
        admission: 'allowed',
        ok: false,
        category: 'invalid-key',
        error: 'DeepL 返回 403：key 无效',
        display: { showRealReason: true, reason: 'DeepL 返回 403：key 无效' },
      },
      text: () => 'DeepL 返回 403：key 无效',
    },
    {
      name: '配额：展示真实原因，长原因也按状态类计时',
      result: {
        admission: 'allowed',
        ok: false,
        category: 'quota',
        error: longReason,
        display: { showRealReason: true, reason: longReason },
      },
      text: () => longReason,
    },
    {
      name: '瞬时故障：展示泛化文案，不露出引擎原因',
      result: {
        admission: 'allowed',
        ok: false,
        category: 'transient',
        error: 'HTTP 503',
        display: { showRealReason: false },
      },
      text: () => chrome.i18n.getMessage('toastTranslateFail'),
    },
    {
      name: '站点禁用：固定文案',
      result: { admission: 'blocked', ok: false },
      text: () => chrome.i18n.getMessage('toastSiteBlocked'),
    },
  ];

  for (const c of cases) {
    test(`${c.name}：等待态原地变成失败提示，满 3 秒消失`, async () => {
      let resolve!: (r: SingleTextResult) => void;
      const run = translator(() => new Promise((r) => (resolve = r)))('Hello world');
      const pendingEl = toasts()[0]!;
      const root = toastRoot()!;
      let removed = 0;
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          removed += Array.from(r.removedNodes).filter(
            (n) => n instanceof HTMLElement && n.classList.contains('pt-toast'),
          ).length;
        }
      });
      mo.observe(root, { childList: true });

      vi.advanceTimersByTime(SLOW); // 引擎慢：过了最短显示时间才返回
      resolve(c.result);
      await run;
      for (const r of mo.takeRecords()) {
        removed += Array.from(r.removedNodes).filter(
          (n) => n instanceof HTMLElement && n.classList.contains('pt-toast'),
        ).length;
      }
      mo.disconnect();

      // 还是那一条提示，从没被摘下来过
      expect(removed).toBe(0);
      expect(toasts()).toHaveLength(1);
      expect(toasts()[0]).toBe(pendingEl);
      // 文案与改动前一致
      expect(shown()).toEqual([c.text()]);
      // 状态类：错误样式、转圈与关闭按钮都没有
      expect(isPending(pendingEl)).toBe(false);
      expect(pendingEl.dataset.kind).toBe('error');
      expect(pendingEl.dataset.purpose).toBe('status');
      expect(pendingEl.querySelector('.pt-toast-spinner')).toBeNull();
      expect(pendingEl.querySelector('.pt-toast-close')).toBeNull();
      // 按状态类计时，不随文字长短延长
      vi.advanceTimersByTime(2999);
      expect(shown()).toEqual([c.text()]);
      vi.advanceTimersByTime(1);
      expect(shown()).toEqual([]);
    });
  }

  test('等了很久才失败：从失败到达起按状态类计 3 秒，不从发起时算', async () => {
    let resolve!: (r: SingleTextResult) => void;
    const run = translator(() => new Promise((r) => (resolve = r)))('Hello world');
    vi.advanceTimersByTime(10_000);
    resolve(cases[2]!.result);
    await run;
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual([chrome.i18n.getMessage('toastTranslateFail')]);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });

  test('子 frame 的站点禁用不弹提示，等待态照常收掉', async () => {
    const sub = createSelectionTranslator({
      translateText: async () => ({ admission: 'blocked', ok: false }),
      getLangs: () => ({ from: 'auto', to: 'zh-CN' }),
      isMainFrame: false,
    });
    await settle(sub('Hello'));
    expect(shown()).toEqual([]);
  });
});

describe('状态类不受影响（#748）', () => {
  test('不经等待态直接弹出的失败提示：新起一条、错误样式、没有关闭按钮、满 3 秒消失', () => {
    toast('之前的提示', { purpose: 'status' });
    const before = toasts()[0];
    toast(chrome.i18n.getMessage('toastTranslateFail'), { purpose: 'status', kind: 'error' });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).not.toBe(before);
    expect(toasts()[0]!.dataset.kind).toBe('error');
    expect(toasts()[0]!.querySelector('.pt-toast-close')).toBeNull();
    vi.advanceTimersByTime(2999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });
});

describe('等待态的最短显示时间（#749）', () => {
  const ok: SingleTextResult = { admission: 'allowed', ok: true, translation: '你好世界' };
  const fail: SingleTextResult = {
    admission: 'allowed',
    ok: false,
    category: 'transient',
    error: 'HTTP 503',
    display: { showRealReason: false },
  };

  /** 引擎在 after 毫秒时返回 result；返回从发起到等待态被替换经过了多久（10 毫秒一步）。 */
  async function replacedAt(after: number, result: SingleTextResult): Promise<number> {
    let resolve!: (r: SingleTextResult) => void;
    const run = translator(() => new Promise((r) => (resolve = r)))('Hello world');
    const el = toasts()[0]!;
    vi.advanceTimersByTime(after);
    resolve(result);
    await flush();
    let elapsed = after;
    while (isPending(el) && el.isConnected && elapsed < 60_000) {
      await vi.advanceTimersByTimeAsync(10);
      elapsed += 10;
    }
    await run;
    return elapsed;
  }

  for (const [name, result] of [
    ['译文', ok],
    ['失败', fail],
  ] as const) {
    test(`${name}：引擎很快返回时等满再替换 —— 替换时刻与引擎多快无关`, async () => {
      const at0 = await replacedAt(0, result);
      const at30 = await replacedAt(30, result);
      expect(at0).toBeGreaterThan(30);
      expect(at30).toBe(at0);
    });

    test(`${name}：引擎很快返回时，返回那一刻等待态仍在、还在转圈`, async () => {
      let resolve!: (r: SingleTextResult) => void;
      const run = translator(() => new Promise((r) => (resolve = r)))('Hello world');
      vi.advanceTimersByTime(10);
      resolve(result);
      await flush();
      expect(shown()).toEqual([translating()]);
      expect(toasts()[0]!.querySelector('.pt-toast-spinner')).not.toBeNull();
      await settle(run);
      expect(isPending(toasts()[0])).toBe(false);
    });

    test(`${name}：引擎慢时不受影响，到了就替换`, async () => {
      expect(await replacedAt(SLOW, result)).toBe(SLOW);
      // 快返回要等的那段时间比慢引擎短得多：最短显示时间只是不闪，不是拖慢
      expect(await replacedAt(0, result)).toBeLessThan(SLOW);
    });
  }

  test('替换之后照常计时：快返回的译文从替换那一刻起算，与慢返回停留一样久', async () => {
    /** 等待态被替换之后，提示还能停留多久。 */
    async function lingers(after: number): Promise<number> {
      const at = await replacedAt(after, ok);
      void at;
      let elapsed = 0;
      while (shown().length > 0 && elapsed < 600_000) {
        vi.advanceTimersByTime(100);
        elapsed += 100;
      }
      return elapsed;
    }
    expect(await lingers(0)).toBe(await lingers(SLOW));
  });

  test('等满期间又发起了一轮：等满的那次已不是最新，丢弃而不是替换（与 #750 共存）', async () => {
    const e = engine();
    const translate = translator(e.translateText);
    const first = translate('First sentence');
    vi.advanceTimersByTime(10);
    e.calls[0]!.resolve(e.ok('第一句'));
    await flush();
    // 第一轮已拿到结果、正在等满；这时发起第二轮
    const rec = recordShown();
    void translate('Second sentence');
    const secondPending = toasts()[0];
    await settle(first);
    rec.stop();

    expect(rec.seen.some((s) => s.includes('第一句'))).toBe(false);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toBe(secondPending);
    expect(isPending(secondPending)).toBe(true);
  });
});

describe('状态类不受影响（#749）', () => {
  test('不经等待态的状态类提示立即出现，满 3 秒消失，不等最短显示时间', () => {
    toast(chrome.i18n.getMessage('toastTranslateFail'), { purpose: 'status', kind: 'error' });
    expect(shown()).toEqual([chrome.i18n.getMessage('toastTranslateFail')]);
    expect(toasts()[0]!.dataset.purpose).toBe('status');
    expect(toasts()[0]!.querySelector('.pt-toast-close')).toBeNull();
    vi.advanceTimersByTime(2999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });
});

describe('后发一轮顶掉先发的一轮时通知中止（#1044）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('第二次划词发起时，第一次的放弃信号触发；第二次自己的信号不触发', async () => {
    const signals: AbortSignal[] = [];
    const releases: ((r: SingleTextResult) => void)[] = [];
    const translate = createSelectionTranslator({
      translateText: (_t, _f, _to, opts) =>
        new Promise<SingleTextResult>((r) => {
          signals.push(opts!.signal!);
          releases.push(r);
        }),
      getLangs: () => ({ from: 'en', to: 'zh-CN' }),
      isMainFrame: true,
    });
    const first = translate('first');
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0]!.aborted).toBe(false);
    const second = translate('second');
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    releases[0]!({ admission: 'allowed', ok: false, category: 'aborted' });
    releases[1]!({ admission: 'allowed', ok: true, translation: 'T(second)' });
    await settle(Promise.all([first, second]).then(() => {}));
    expect(signals[1]!.aborted).toBe(false);
  });
});
