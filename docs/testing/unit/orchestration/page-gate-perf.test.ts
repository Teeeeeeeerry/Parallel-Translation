/**
 * 页面级闸门的取样与识别不拖垮整页翻译的开始（#867，规格 #831）
 *
 * #843 之后，整页翻译在点下去到第一个请求发出之间多了一段：只读采集全部
 * 翻译单元、等距取样、送去本地识别。经整页开关入口 togglePage 断言，真实
 * DOM 加只读采集，识别是替身（记下喂给它的文字与被调用的时刻），假消息层
 * 记下第一个请求发出的时刻。
 *
 * 只断言相对关系与量级，不写死毫秒数（#818：写死数字的性能用例迟早偶发）：
 * - 喂给识别器的文字量不随页面变大：取样有 CONTENT_SAMPLE_MAX_CHARS 上限，
 *   段落数翻 16 倍，识别器拿到的字符数一个不多。识别是纯 CPU 操作，开销跟着
 *   输入长度走，输入不变它就不随页面线性增长（Chromium 151 实测：4000 字符
 *   约 3.7ms，整页十几万字符约 8.7ms，识别器内部自己也截断）
 * - 取样那一段（点下去到识别被调用）与随后整页采集到第一个请求那一段同一
 *   量级：两段都要把页面走一遍，取样不该比翻译本身的准备慢出几倍
 * - 页面放大 16 倍，取样那一段的耗时增长不超过翻译本身准备那一段增长的两倍
 *   （两段都随页面线性增长；比增长倍数而不比绝对值，机器忙闲两边一起受影响）
 * 耗时打出来看趋势。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { CONTENT_SAMPLE_MAX_CHARS, type ContentLang } from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { mockAllBoundingRects } from '../../setup';

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
  /** 喂给识别器的字符数 */
  sampleChars: number;
  /** 点下去到识别被调用：只读采集与取样 */
  gateMs: number;
  /** 识别返回到第一个请求发出：整页采集、判定、分批 */
  prepMs: number;
}

async function measure(n: number): Promise<Measure> {
  buildPage(n);
  const collectItems = (mode?: { readOnly: boolean }) =>
    collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
  let detectAt = 0;
  let sentAt = 0;
  let sampleChars = 0;
  const send = vi.fn(async (req: { texts: string[] }) => {
    sentAt ||= performance.now();
    return { ok: true, data: { translations: req.texts.map((t) => `[译] ${t}`) } };
  });
  const detect = vi.fn(async (sample: string): Promise<ContentLang> => {
    detectAt = performance.now();
    sampleChars = sample.length;
    return { reliable: true, languages: [{ lang: 'en', percentage: 100 }] };
  });
  const orch = createOrchestrator({
    send,
    getPageLang: () => 'zh-CN',
    hasTranslated: () => false,
    pushStatus: () => {},
    detectContentLang: detect,
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  const start = performance.now();
  const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');
  orch.stop();
  expect(result.status).toBe('translated');
  expect(detect).toHaveBeenCalledTimes(1);
  return { sampleChars, gateMs: detectAt - start, prepMs: sentAt - detectAt };
}

/** 同一页量三次取中位，压一压 jsdom 的抖动。 */
async function median(n: number): Promise<Measure> {
  const runs = [await measure(n), await measure(n), await measure(n)];
  const mid = <K extends keyof Measure>(k: K) => runs.map((r) => r[k]).sort((a, b) => a - b)[1]!;
  return { sampleChars: mid('sampleChars'), gateMs: mid('gateMs'), prepMs: mid('prepMs') };
}

let restoreRects: (() => void) | undefined;
afterEach(() => {
  restoreRects?.();
  restoreRects = undefined;
  document.body.innerHTML = '';
});

describe('取样与识别的开销不随页面变大而失控（#867）', () => {
  test('段落数翻 16 倍：喂给识别器的文字量不变，取样那一段与翻译本身的准备同一量级、增长不超过线性', async () => {
    restoreRects = mockAllBoundingRects();
    await measure(SIZES[0]); // 预热，第一次跑含 JIT 编译
    const results: Measure[] = [];
    for (const n of SIZES) results.push(await median(n));
    results.forEach((r, i) =>
      console.log(
        `#867 ${SIZES[i]} 段：识别输入 ${r.sampleChars} 字符，取样 ${r.gateMs.toFixed(1)}ms，` +
          `之后到第一个请求 ${r.prepMs.toFixed(1)}ms`,
      ),
    );

    // 喂给识别器的文字量：到上限为止，与页面大小无关
    for (const r of results) expect(r.sampleChars).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS);
    expect(new Set(results.map((r) => r.sampleChars)).size).toBe(1);

    // 取样那一段与随后的准备同一量级（实测约 1 比 1）
    const big = results.at(-1)!;
    expect(big.gateMs).toBeLessThan(big.prepMs * 3);

    // 页面放大 16 倍，取样那一段的增长不超过准备那一段增长的两倍（实测约 1 比 1）
    const small = results[0]!;
    expect(big.gateMs / small.gateMs).toBeLessThan((big.prepMs / small.prepMs) * 2);
  }, 120_000);
});
