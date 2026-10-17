/**
 * 页面级闸门的取样与识别不拖垮整页翻译的开始（#867，规格 #831）
 *
 * #843 之后，整页翻译在点下去到第一个请求发出之间多了一段：只读采集全部
 * 翻译单元、等距取样、送去本地识别。经整页开关入口 togglePage 断言，真实
 * DOM 加只读采集，识别是替身（记下喂给它的文字与被调用的时刻），假消息层
 * 记下第一个请求发出的时刻。
 *
 * 只断言量级，不量毫秒（#818、#924）：
 * - 喂给识别器的文字量不随页面变大：取样有 CONTENT_SAMPLE_MAX_CHARS 上限，
 *   段落数翻 16 倍，识别器拿到的字符数一个不多。识别是纯 CPU 操作，开销跟着
 *   输入长度走，输入不变它就不随页面线性增长（Chromium 151 实测：4000 字符
 *   约 3.7ms，整页十几万字符约 8.7ms，识别器内部自己也截断）
 * - 取样那一段（点下去到识别被调用）与随后整页采集到第一个请求那一段同一
 *   量级：两段都要把页面走一遍，取样走过的元素与读布局的次数不比翻译本身的
 *   准备多
 * - 页面放大 16 倍，取样那一段走过的元素与读布局的次数至多跟着放大 16 倍，
 *   不超过线性
 * 走过的元素数的是遍历回调被调用的次数，读布局数的是 getBoundingClientRect
 * 与 getComputedStyle —— 与 #737 的 countSerializations 同一做法：只记次数、
 * 不拦截，行为不变。
 *
 * #924：原先这两条是毫秒比值。全量 pnpm test 时 vitest 并行跑一百多个文件，
 * 几毫秒量级的基准被别的 worker 抢走 CPU，比值就放大几倍，偶发失败。次数
 * 与机器忙闲无关。毫秒数仍打出来看趋势，不进断言。
 *
 * #892 之后，取样阶段除了全页样本，还把按文字长度排在最前面的若干个单元
 * 各自送去识别。全页样本仍是第一次调用；单元那几次的个数与每次的文字量
 * 都有上限，同样不随页面变大。
 *
 * #1056：译好的单元要像真实渲染那样落上 data-pt="done"。#1013 起整页翻译之后
 * 还有补采集（最多 3 轮、轮间等 1500 毫秒）：替身不落标记时，每一轮都把全部
 * 单元当成新单元重采重发，十次 togglePage 白等二十次 1500 毫秒，覆盖率下这条
 * 用例因此贴到 120 秒上限。量的是点下去到第一个请求，补采集不在量的范围里；
 * 页面翻完之后补采集第 1 轮采不到新单元，就此结束 —— 与真实页面一致。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import {
  CONTENT_SAMPLE_MAX_CHARS,
  UNIT_DETECT_COUNT,
  UNIT_DETECT_MAX_CHARS,
  type ContentLang,
} from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { mockAllBoundingRects } from '../../setup';

/** 走过的元素与读布局的累计次数（只记次数，不改行为）。 */
const counts = { visits: 0, layout: 0 };

// 遍历回调：采集入口经它访问每一个元素，包一层计数
vi.mock('~/src/dom/shadow-walk', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/src/dom/shadow-walk')>();
  return {
    ...real,
    walkShadowTree: ((root, visit, opts) =>
      real.walkShadowTree(
        root,
        (el) => {
          counts.visits++;
          return visit(el);
        },
        opts,
      )) as typeof real.walkShadowTree,
  };
});

/** 读布局计数：getBoundingClientRect 与 getComputedStyle，在 mockAllBoundingRects 之后包上。 */
function countLayoutReads(): () => void {
  const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const rect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    counts.layout++;
    return rect.call(this);
  };
  const style = window.getComputedStyle;
  window.getComputedStyle = function (this: Window, ...args: Parameters<typeof style>) {
    counts.layout++;
    return style.apply(this, args);
  } as typeof style;
  return () => {
    proto.getBoundingClientRect = rect;
    window.getComputedStyle = style;
  };
}

const SIZES = [200, 800, 3200] as const;

/** 一页：中文导航加 n 段英文正文，每段约 90 字符，几十段就超过取样上限。 */
function buildPage(n: number): void {
  document.body.innerHTML =
    '<nav><a>商店</a> <a>社区</a> <a>愿望单</a></nav>' +
    Array.from(
      { length: n },
      (_, i) =>
        `<p>Paragraph ${i}: Explore a vast open world full of secrets and survive the night with friends.</p>`,
    ).join('');
}

interface Measure {
  /** 喂给识别器的全页样本字符数 */
  sampleChars: number;
  /** 单元级识别的次数（#892） */
  unitCalls: number;
  /** 单元级识别每次喂进去的最长字符数（#892） */
  unitMaxChars: number;
  /** 点下去到识别被调用：只读采集与取样 */
  gateMs: number;
  /** 识别返回到第一个请求发出：整页采集、判定、分批 */
  prepMs: number;
  /** 取样那一段走过的元素数（遍历回调被调用的次数） */
  gateVisits: number;
  /** 取样那一段读布局的次数 */
  gateLayout: number;
  /** 准备那一段走过的元素数 */
  prepVisits: number;
  /** 准备那一段读布局的次数 */
  prepLayout: number;
}

async function measure(n: number): Promise<Measure> {
  buildPage(n);
  const collectItems = (mode?: { readOnly: boolean }) =>
    collect(document.body, undefined, mode).map((el) => ({ text: el.textContent!, ctx: el }));
  let detectAt = 0;
  let sentAt = 0;
  let atDetect = { ...counts };
  let atSend = { ...counts };
  const inputs: string[] = [];
  let sentUnits = 0;
  const send = vi.fn(async (req: { texts: string[] }) => {
    if (!sentAt) atSend = { ...counts };
    sentAt ||= performance.now();
    sentUnits += req.texts.length;
    return { ok: true, data: { translations: req.texts.map((t) => `[译] ${t}`) } };
  });
  const detect = vi.fn(async (sample: string): Promise<ContentLang> => {
    // 第一次调用是全页样本：取样那一段到这里为止
    if (!detectAt) atDetect = { ...counts };
    detectAt ||= performance.now();
    inputs.push(sample);
    return { reliable: true, languages: [{ lang: 'en', percentage: 100 }] };
  });
  const orch = createOrchestrator({
    send,
    getPageLang: () => 'zh-CN',
    hasTranslated: () => false,
    pushStatus: () => {},
    detectContentLang: detect,
    // #1056：与真实渲染一样，译好的单元落上完成标记，补采集据此不再重采
    onBatchResult: (_i: number, batch: { ctx: unknown }[], r: { ok: boolean }) => {
      if (r.ok) for (const it of batch) (it.ctx as Element).setAttribute('data-pt', 'done');
    },
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  counts.visits = 0;
  counts.layout = 0;
  const start = performance.now();
  const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');
  orch.stop();
  expect(result.status).toBe('translated');
  // #1056：每段只发一次 —— 补采集没有把翻好的段落当成新单元再发
  expect(sentUnits).toBe(n);
  const [sample, ...units] = inputs;
  return {
    sampleChars: sample!.length,
    unitCalls: units.length,
    unitMaxChars: Math.max(0, ...units.map((t) => t.length)),
    gateMs: detectAt - start,
    prepMs: sentAt - detectAt,
    gateVisits: atDetect.visits,
    gateLayout: atDetect.layout,
    prepVisits: atSend.visits - atDetect.visits,
    prepLayout: atSend.layout - atDetect.layout,
  };
}

/** 同一页量三次取中位：毫秒数压一压 jsdom 的抖动（只打印）；次数三次本来就一样。 */
async function median(n: number): Promise<Measure> {
  const runs = [await measure(n), await measure(n), await measure(n)];
  const mid = <K extends keyof Measure>(k: K) => runs.map((r) => r[k]).sort((a, b) => a - b)[1]!;
  return {
    sampleChars: mid('sampleChars'),
    unitCalls: mid('unitCalls'),
    unitMaxChars: mid('unitMaxChars'),
    gateMs: mid('gateMs'),
    prepMs: mid('prepMs'),
    gateVisits: mid('gateVisits'),
    gateLayout: mid('gateLayout'),
    prepVisits: mid('prepVisits'),
    prepLayout: mid('prepLayout'),
  };
}

let restoreRects: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
afterEach(() => {
  restoreLayout?.();
  restoreLayout = undefined;
  restoreRects?.();
  restoreRects = undefined;
  document.body.innerHTML = '';
});

describe('取样与识别的开销不随页面变大而失控（#867）', () => {
  test('段落数翻 16 倍：喂给识别器的文字量不变，取样那一段与翻译本身的准备同一量级、增长不超过线性', async () => {
    restoreRects = mockAllBoundingRects();
    restoreLayout = countLayoutReads();
    await measure(SIZES[0]); // 预热，第一次跑含 JIT 编译
    const results: Measure[] = [];
    for (const n of SIZES) results.push(await median(n));
    results.forEach((r, i) =>
      console.log(
        `#867 ${SIZES[i]} 段：识别输入 ${r.sampleChars} 字符，单元识别 ${r.unitCalls} 次，` +
          `取样 ${r.gateMs.toFixed(1)}ms（走过 ${r.gateVisits} 个元素、读布局 ${r.gateLayout} 次），` +
          `之后到第一个请求 ${r.prepMs.toFixed(1)}ms（走过 ${r.prepVisits} 个元素、读布局 ${r.prepLayout} 次）`,
      ),
    );

    // 喂给识别器的文字量：到上限为止，与页面大小无关
    for (const r of results) expect(r.sampleChars).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS);
    expect(new Set(results.map((r) => r.sampleChars)).size).toBe(1);
    // #892：单元级识别的次数与每次的文字量同样到上限为止
    for (const r of results) {
      expect(r.unitCalls).toBeLessThanOrEqual(UNIT_DETECT_COUNT);
      expect(r.unitMaxChars).toBeLessThanOrEqual(UNIT_DETECT_MAX_CHARS);
    }
    expect(new Set(results.map((r) => r.unitCalls)).size).toBe(1);

    // 取样那一段与随后的准备同一量级：走过的元素、读布局的次数都不比准备多。
    // 两段都确实把页面走了一遍，不是空转
    const small = results[0]!;
    const big = results.at(-1)!;
    for (const r of results) {
      expect(r.gateVisits).toBeGreaterThan(0);
      expect(r.gateLayout).toBeGreaterThan(0);
      expect(r.gateVisits).toBeLessThanOrEqual(r.prepVisits);
      expect(r.gateLayout).toBeLessThanOrEqual(r.prepLayout);
    }

    // 页面放大 16 倍，取样那一段走过的元素与读布局的次数至多放大 16 倍
    const scale = SIZES.at(-1)! / SIZES[0];
    expect(big.gateVisits).toBeLessThanOrEqual(small.gateVisits * scale);
    expect(big.gateLayout).toBeLessThanOrEqual(small.gateLayout * scale);
  }, 120_000);
});
