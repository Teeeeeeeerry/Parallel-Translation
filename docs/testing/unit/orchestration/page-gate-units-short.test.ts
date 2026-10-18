/**
 * 整页翻译接上“最长的若干个单元”那一级：不到外文块下限的单元也送去识别（#904，父 #898）
 *
 * #903 加了一级判定：没有外文块时，最长的 LONGEST_UNITS_COUNT 个单元全部可靠
 * 地识别成目标语言就拦下。取单元时原先先按外文块下限（245 字符）过滤，不到
 * 下限的单元拿不到识别结果，这一级就没有数据 —— #902 实测里阮一峰的网络日志
 * 最长的单元只有 49 字。经整页开关入口 togglePage 断言：假消息层数请求条数，
 * 识别替身数调用次数与喂进去的文字，真实 DOM 看页面变没变。
 *
 * #1076：判定、识别次数上限与一秒上限在闸门的判定入口上测，见
 * page-gate-judge.test.ts；这里只留接线（不命中时送出的请求与改动前相同、真实
 * DOM 判定阶段页面不动）。
 *
 * 识别替身按文字本身给结论（汉字过半就是中文，否则是英文），全页样本另行
 * 给定；不调真实识别器（#851：可靠标记会在两次调用之间翻转）。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from './page-harness';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import {
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

