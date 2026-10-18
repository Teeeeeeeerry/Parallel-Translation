/**
 * 输入翻译入口 —— 提示的用途（#751）
 *
 * 输入翻译放弃写回时（框里内容已变动、焦点已移走、长度上限装不下、浏览器
 * 拒绝插入，#646、#654、#644）把译文交给提示组件。那是用户必须读完、多半
 * 还要复制走的内容，按内容类显示：停留时长随长度、悬停不计时、有关闭按钮。
 *
 * 输入翻译其余的提示（失败、超长、同语言不替换、判不出目标语言、站点禁用）
 * 仍是状态类：固定 3 秒、没有关闭按钮、悬停照样计时。
 *
 * 单文本翻译、源语言与本地识别由替身注入；浏览器原生插入（execCommand）
 * 由替身决定成败。只看外部可观察的行为：提示里显示了什么、属于哪一类、
 * 有没有关闭按钮、过了多久还在不在、框里的文字。
 */
import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createInputTranslator, type InputTranslatorDeps } from '~/src/ui/input-translate';
import type { SingleTextResult } from '~/src/orchestration/orchestrator';
import { singleTextMissNotice, type SingleTextMiss } from '~/src/orchestration/text-notice';
import { MAX_TEXT } from '~/src/dom/classify';
import { unmountIsolated } from '~/src/ui/mount';
import { createOrchestrator } from '~/src/orchestration/orchestrator';

function toasts(): HTMLElement[] {
  const root = document.getElementById('pt-host-toast')?.shadowRoot;
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

function shown(): string[] {
  return toasts().map((el) => el.textContent ?? '');
}

/** 提示从现在起还能停留多久（100 毫秒一步，十分钟封顶）。 */
function lifetime(): number {
  const msg = shown()[0];
  let elapsed = 0;
  while (msg !== undefined && shown()[0] === msg && elapsed < 600_000) {
    vi.advanceTimersByTime(100);
    elapsed += 100;
  }
  return elapsed;
}

const ok = (translation: string): SingleTextResult => ({ ok: true, translation });
/** 入口没给出译文时的结果：提示由入口那一处判定给出（#1075），这里只看输入翻译怎么显示它。 */
const fail = (miss: SingleTextMiss): SingleTextResult => ({ ok: false, notice: singleTextMissNotice(miss) });

let box: HTMLTextAreaElement;
/** 浏览器原生插入的替身：true 时照常写回，false 时拒绝。 */
let insertAccepted = true;

function translator(over: Partial<InputTranslatorDeps> = {}) {
  return createInputTranslator({
    translateText: async () => ok('Hello, nice to meet you.'),
    sourceLang: () => 'en',
    detectedLang: () => null,
    reliableLang: async () => 'zh',
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  insertAccepted = true;
  document.execCommand = ((cmd: string, _ui?: boolean, value?: string) => {
    if (cmd !== 'insertText' || !insertAccepted) return false;
    box.value = value ?? '';
    return true;
  }) as typeof document.execCommand;
  box = document.createElement('textarea');
  box.value = '你好，很高兴认识你。';
  document.body.appendChild(box);
  box.focus();
});

afterEach(() => {
  toasts().forEach((el) => el.remove());
  box.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  unmountIsolated('toast');
});

describe('写回成功：不弹提示', () => {
  test('译文替换框里的文字，页面上没有提示', async () => {
    await translator()(box);
    expect(box.value).toBe('Hello, nice to meet you.');
    expect(toasts()).toHaveLength(0);
  });
});

describe('放弃写回时交出的译文按内容类显示（#751）', () => {
  /** 四条放弃写回的路径：都把译文交给提示组件，框里文字不动。 */
  const handoffs: { name: string; arrange(translation: string): Partial<InputTranslatorDeps> }[] = [
    {
      name: '送翻期间框里内容已变动',
      arrange: (translation) => ({
        translateText: async () => {
          box.value = '你好，很高兴认识你。我刚又打了几个字';
          return ok(translation);
        },
      }),
    },
    {
      name: '送翻期间焦点移走了',
      arrange: (translation) => ({
        translateText: async () => {
          box.blur();
          return ok(translation);
        },
      }),
    },
    {
      name: '长度上限装不下译文',
      arrange: (translation) => {
        box.maxLength = 10;
        return { translateText: async () => ok(translation) };
      },
    },
    {
      name: '浏览器拒绝插入',
      arrange: (translation) => {
        insertAccepted = false;
        return { translateText: async () => ok(translation) };
      },
    },
  ];

  for (const h of handoffs) {
    test(`${h.name}：译文是内容类，有关闭按钮，框里文字不被吞`, async () => {
      const translation = 'Hello, nice to meet you.';
      const deps = h.arrange(translation);
      const typed = box.value;
      await translator(deps)(box);

      expect(shown()).toEqual([translation]);
      const el = toasts()[0]!;
      expect(el.dataset.purpose).toBe('content');
      expect(el.querySelector('.pt-toast-close')).not.toBeNull();
      // 放弃写回：框里还是用户自己的文字（变动的那条是变动之后的文字）
      expect(box.value).not.toBe(translation);
      if (h.name !== '送翻期间框里内容已变动') expect(box.value).toBe(typed);
    });
  }

  test('停留时长随长度：长译文比短译文停得久，都比状态类的 3 秒久', async () => {
    const short = 'Hello.';
    const long = 'Hello, nice to meet you. I have been meaning to write to you about the project. '.repeat(4);
    insertAccepted = false;

    await translator({ translateText: async () => ok(short) })(box);
    const shortLife = lifetime();
    await translator({ translateText: async () => ok(long) })(box);
    const longLife = lifetime();

    expect(shortLife).toBeGreaterThan(3000);
    expect(longLife).toBeGreaterThan(shortLife);
  });

  test('鼠标悬停时不计时，移开后重新计满一整轮', async () => {
    insertAccepted = false;
    await translator()(box);
    const el = toasts()[0]!;
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual(['Hello, nice to meet you.']);
    el.dispatchEvent(new MouseEvent('mouseleave'));
    expect(lifetime()).toBeGreaterThan(3000);
  });

  test('点关闭按钮立即消失', async () => {
    insertAccepted = false;
    await translator()(box);
    toasts()[0]!.querySelector<HTMLButtonElement>('.pt-toast-close')!.click();
    expect(toasts()).toHaveLength(0);
  });
});

describe('输入翻译其余的提示仍是状态类（#751 反向）', () => {
  const longText = 'a'.repeat(MAX_TEXT + 1);
  const cases: { name: string; deps: Partial<InputTranslatorDeps>; text?: string; expected: () => string }[] = [
    {
      name: '翻译失败（瞬时故障，泛化文案）',
      deps: {
        translateText: async () => fail({ kind: 'failed', category: 'transient', error: 'HTTP 503' }),
      },
      expected: () => chrome.i18n.getMessage('toastTranslateFail'),
    },
    {
      name: '翻译失败（配额，真实原因）',
      deps: {
        translateText: async () =>
          fail({ kind: 'failed', category: 'quota', error: 'DeepL 返回 456：本月配额已用完。'.repeat(10) }),
      },
      expected: () => 'DeepL 返回 456：本月配额已用完。'.repeat(10),
    },
    {
      name: '超长不翻',
      deps: {},
      text: longText,
      expected: () => chrome.i18n.getMessage('toastInputTooLong', String(MAX_TEXT)),
    },
    {
      name: '写的已经是对方的语言，不替换',
      deps: { reliableLang: async () => 'en' },
      text: 'Hello there, how are you doing today?',
      expected: () => chrome.i18n.getMessage('toastInputSameLanguage'),
    },
    {
      name: '判不出目标语言',
      deps: { sourceLang: () => 'auto' },
      expected: () => chrome.i18n.getMessage('toastInputSourceLangNeeded'),
    },
    {
      name: '站点禁用',
      deps: { translateText: async () => fail({ kind: 'blocked', mainFrame: true }) },
      expected: () => chrome.i18n.getMessage('toastSiteBlocked'),
    },
  ];

  for (const c of cases) {
    test(`${c.name}：状态类，没有关闭按钮，悬停照样计时，满 3 秒消失`, async () => {
      if (c.text !== undefined) box.value = c.text;
      document.documentElement.removeAttribute('lang');
      await translator(c.deps)(box);

      expect(shown()).toEqual([c.expected()]);
      const el = toasts()[0]!;
      expect(el.dataset.purpose).toBe('status');
      expect(el.querySelector('.pt-toast-close')).toBeNull();
      el.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(2999);
      expect(toasts()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(toasts()).toHaveLength(0);
    });
  }
});

describe('输入翻译不随页面还原作废（#1044、#1072）', () => {
  test('在飞时还原整页：接真实的编排模块，译文照常写回框里', async () => {
    let reply: (v: unknown) => void = () => {};
    const signals: AbortSignal[] = [];
    const orch = createOrchestrator({
      send: (_req, ctl) =>
        new Promise((r) => {
          signals.push(ctl!.signal);
          reply = r;
        }),
    });
    orch.start();
    const pending = translator({ translateText: orch.translateText })(box);
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    orch.abort();
    expect(signals[0]!.aborted).toBe(false);
    reply({ ok: true, data: { translations: ['Hello, nice to meet you.'] } });
    await pending;
    expect(box.value).toBe('Hello, nice to meet you.');
  });
});

describe('输入翻译被放弃时不提示（#1075，此前这里缺这一句）', () => {
  test('后台报了已中止：接真实的编排模块，不弹“翻译失败”，框里文字不动', async () => {
    const orch = createOrchestrator({
      send: async () => ({ ok: false, error: '已中止', category: 'aborted', aborted: true }),
    });
    orch.start();
    const before = box.value;
    await translator({ translateText: orch.translateText })(box);
    expect(shown()).toEqual([]);
    expect(box.value).toBe(before);
  });
});
