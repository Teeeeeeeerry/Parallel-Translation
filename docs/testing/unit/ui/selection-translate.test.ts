/**
 * 划词翻译入口（#726）
 *
 * 拖选划词与右键菜单都走 translateSelection。单文本翻译由替身注入，每次调用
 * 返回一个由用例决定何时兑现的承诺，借此造出“先发后到”。
 *
 * #750：并发只认最后一次 —— 先发的结果后到时整条丢弃：不替换等待态、不弹
 * 提示、页面不变；被丢弃的那一轮也不能收掉后发那一轮的等待态。
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
    await blocked('Hello');
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
    await quota('Hello');
    expect(shown()).toEqual(['DeepL 返回 456：本月配额已用完。']);
    expect(toasts()[0]!.dataset.purpose).toBe('status');
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);
  });
});
