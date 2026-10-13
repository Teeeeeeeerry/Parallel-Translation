/**
 * 整页翻译接上“最长的若干个单元”那一级：不到外文块下限的单元也送去识别（#904，父 #898）
 *
 * #903 加了一级判定：没有外文块时，最长的 LONGEST_UNITS_COUNT 个单元全部可靠
 * 地识别成目标语言就拦下。取单元时原先先按外文块下限（245 字符）过滤，不到
 * 下限的单元拿不到识别结果，这一级就没有数据 —— #902 实测里阮一峰的网络日志
 * 最长的单元只有 49 字。经整页开关入口 togglePage 断言：假消息层数请求条数，
 * 识别替身数调用次数与喂进去的文字，真实 DOM 看页面变没变。
 *
 * 识别替身按文字本身给结论（汉字过半就是中文，否则是英文），全页样本另行
 * 给定；不调真实识别器（#851：可靠标记会在两次调用之间翻转）。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator, CONTENT_DETECT_TIMEOUT_MS } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import {
  CONTENT_SAMPLE_MAX_CHARS,
  FOREIGN_BLOCK_MIN_CHARS,
  UNIT_DETECT_COUNT,
  UNIT_DETECT_MAX_CHARS,
  type ContentLang,
  type PageGateDecision,
} from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { mockAllBoundingRects } from '../../setup';

type Detect = (sample: string) => Promise<ContentLang | null>;

const CJK = /[一-鿿]/g;

/** 按文字本身给结论的识别替身：汉字过半是中文，否则是英文，都可靠。 */
function byText(): Detect {
  return async (text) => {
    const zh = Math.round(((text.match(CJK)?.length ?? 0) / text.length) * 100);
    return { reliable: true, languages: [zh >= 50 ? { lang: 'zh', percentage: zh } : { lang: 'en', percentage: 100 - zh }] };
  };
}

/** 全页样本（含换行）识别器拿不准；单个单元按文字本身判。 */
const UNSURE: ContentLang = { reliable: false, languages: [{ lang: 'zh', percentage: 70 }, { lang: 'en', percentage: 20 }] };
function sampleUnsure(unit: Detect = byText()): Detect {
  return async (text) => (text.includes('\n') ? UNSURE : unit(text));
}

function setup(pageLang: string | null, detect?: Detect) {
  const send = vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: { translations: req.texts.map((t) => `[译] ${t}`) },
  }));
  const pushes: string[] = [];
  const decisions: PageGateDecision[] = [];
  const orch = createOrchestrator({
    send,
    getPageLang: () => pageLang,
    hasTranslated: () => false,
    pushStatus: (s) => pushes.push(s),
    onGateDecision: (d: PageGateDecision) => decisions.push(d),
    ...(detect ? { detectContentLang: detect } : {}),
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  return { orch, send, pushes, decisions };
}

function items(texts: string[]): TranslateItem<number>[] {
  return texts.map((text, i) => ({ text, ctx: i }));
}

/** 阮一峰的网络日志的形状（#902）：中文博客首页，单元都很短。 */
const BLOG = items([
  '阮一峰的网络日志',
  '科技爱好者周刊（第 300 期）：开发者的工具箱，这一期介绍几个常用的命令行工具',
  '我是怎么学习新技术的：先读官方文档，再动手写一个最小的例子，最后看源码',
  '为什么要写博客：把想清楚的事情写下来，写下来的过程本身就是一次整理',
  '本周的文章、工具与资源，欢迎投稿，也欢迎推荐你觉得值得一读的内容',
  '订阅 · 归档 · 关于',
]);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('不到外文块下限的单元也送去识别，接上“最长的几个单元”那一级', () => {
  test('短单元的中文页，全页识别拿不准：最长的三个单元都是中文，拦下，零请求', async () => {
    for (const u of BLOG) expect(u.text.length).toBeLessThan(FOREIGN_BLOCK_MIN_CHARS);
    const detect = vi.fn(sampleUnsure());
    const { orch, send, pushes, decisions } = setup('zh-CN', detect);

    const result = await orch.togglePage(BLOG, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(result.gate).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN', basis: 'longest-units' });
    expect(decisions).toEqual([result.gate]);
    expect(send).toHaveBeenCalledTimes(0);
    expect(pushes).toEqual(['idle']);
    // 全页样本一次，六个单元各一次
    expect(detect).toHaveBeenCalledTimes(1 + BLOG.length);
    orch.stop();
  });

  test('短单元的外文内容页（中文界面、英文标题），全页识别拿不准：不拦，照常翻译', async () => {
    // YouTube 大模型入门第二遍的形状（#902）：最长的单元都是 60 到 80 字符的英文标题
    const page = items([
      '首页',
      'Intro to Large Language Models',
      'Let us build GPT: from scratch, in code, spelled out. Neural networks: zero to hero',
      'The spelled-out intro to neural networks and backpropagation: building micrograd',
      'Deep Dive into LLMs like ChatGPT, a general audience deep dive into the technology',
      '订阅',
    ]);
    const { orch, send, decisions } = setup('zh-Hans-CN', vi.fn(sampleUnsure()));

    expect((await orch.togglePage(page, 'auto', 'zh-CN')).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(decisions).toEqual([{ translate: true, basis: 'pass' }]);
    orch.stop();
  });

  test('不命中时整页翻译与没注入识别时完全一致：送出的请求逐条相同', async () => {
    const page = items([
      '首页',
      'Let us build GPT: from scratch, in code, spelled out. Neural networks: zero to hero',
      'The spelled-out intro to neural networks and backpropagation: building micrograd',
      'Deep Dive into LLMs like ChatGPT, a general audience deep dive into the technology',
    ]);
    const a = setup('zh-CN', sampleUnsure());
    await a.orch.togglePage(page, 'auto', 'zh-CN');
    const b = setup('en');
    await b.orch.togglePage(page, 'auto', 'zh-CN');

    expect(a.send).toHaveBeenCalledTimes(1);
    expect(a.send.mock.calls).toEqual(b.send.mock.calls);
    a.orch.stop();
    b.orch.stop();
  });

  test('真实 DOM：短段落的中文页，判定阶段页面一个字不动、没有切块，零请求', async () => {
    document.body.innerHTML =
      '<h1>阮一峰的网络日志</h1>' +
      BLOG.slice(1, 5).map((u) => `<p>${u.text}</p>`).join('') +
      // 不带换行：替身按“含换行”认出全页样本
      `<p>${Array.from({ length: 60 }, (_, i) => `第 ${i} 行：本周的文章与工具。`).join('<br>')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = (mode?: { readOnly: boolean }) =>
      collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
    const { orch, send } = setup('en', vi.fn(sampleUnsure()));

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    restoreRects();
    expect(result.status).toBe('same-language');
    expect(result.gate).toMatchObject({ basis: 'longest-units' });
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.pt-chunk, [data-pt-split]')).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('识别次数的上限：短单元也进来之后，仍不随单元数增长（#867）', () => {
  /** n 段一样长、不到外文块下限的英文短段，开头是中文导航。 */
  const page = (n: number) =>
    items([
      '商店',
      '社区',
      ...Array.from({ length: n }, (_, i) => `Item ${String(i).padStart(4, '0')}: explore a vast open world full of secrets and hidden rooms.`),
    ]);

  test('段落数 200、800、3200：识别都是 1 加单元上限次，喂进去的文字量相同', async () => {
    const calls: number[] = [];
    const fed: number[] = [];
    for (const n of [200, 800, 3200]) {
      expect(page(n)[2]!.text.length).toBeLessThan(FOREIGN_BLOCK_MIN_CHARS);
      const detect = vi.fn(sampleUnsure());
      const { orch } = setup('zh-CN', detect);
      expect((await orch.togglePage(page(n), 'auto', 'zh-CN')).status).toBe('translated');
      orch.stop();
      const inputs = detect.mock.calls.map((c) => c[0]);
      calls.push(inputs.length);
      fed.push(inputs.reduce((sum, t) => sum + t.length, 0));
      for (const t of inputs) expect(t.length).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS);
    }
    expect(calls).toEqual([1 + UNIT_DETECT_COUNT, 1 + UNIT_DETECT_COUNT, 1 + UNIT_DETECT_COUNT]);
    expect(new Set(fed).size).toBe(1);
    expect(fed[0]).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS + UNIT_DETECT_COUNT * UNIT_DETECT_MAX_CHARS);
  });

  test('单元少于上限时，每个单元各识别一次，不重复', async () => {
    const detect = vi.fn(sampleUnsure());
    const { orch } = setup('zh-CN', detect);
    await orch.togglePage(BLOG, 'auto', 'zh-CN');
    const units = detect.mock.calls.map((c) => c[0]).filter((t) => !t.includes('\n'));
    expect(units.sort()).toEqual(BLOG.map((u) => u.text).sort());
    orch.stop();
  });
});

describe('一秒上限（#866）仍是整个识别阶段共用', () => {
  const hang: Detect = () => new Promise<ContentLang | null>(() => {});

  test('短单元的识别全部挂住：到一秒就判，证据不足照常翻译，不是单元数乘一秒', async () => {
    vi.useFakeTimers();
    const detect = vi.fn<Detect>((text) => (text.includes('\n') ? Promise.resolve(UNSURE) : hang(text)));
    const { orch, send } = setup('zh-CN', detect);

    const first = orch.togglePage(BLOG, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS - 1);
    expect(send).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);

    expect((await first).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledTimes(1 + BLOG.length);
    orch.stop();
  });

  test('最长的三个里有一个挂住：到一秒判，那一个当拿不到，不拦', async () => {
    vi.useFakeTimers();
    const longest = [...BLOG].sort((a, b) => b.text.length - a.text.length)[0]!.text;
    const ok = sampleUnsure();
    const detect = vi.fn<Detect>((text) => (text === longest ? hang(text) : ok(text)));
    const { orch, send } = setup('zh-CN', detect);

    const first = orch.togglePage(BLOG, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS);

    expect((await first).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});
