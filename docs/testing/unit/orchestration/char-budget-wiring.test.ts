/**
 * 整页翻译与增量补翻按字符预算切批（#1005，父 #1000）
 *
 * 经编排模块的两个整页入口（togglePage 是悬浮球那一路，translatePage 是增量补翻
 * 那一路）与注入的假发送函数断言：
 *   - 新旧两种切法送出去的文本完全相同，只是分组不同 —— 不多翻、不漏翻；
 *   - 维基成绩表形态的页面上往返次数不比旧切法多；
 *   - 长段落为主的页面上单次请求不再大得离谱；
 *   - 渐进渲染按批次下标回调、回调里的批次就是发出去的那一批。
 *
 * 断言比较新旧两种切法，不写死批次条数：预算由 #1006 实测调整时这里不该红。
 */
import { describe, test, expect, vi } from 'vitest';
import { splitBatches, FULL_PAGE_BATCH_LIMITS, type TranslateItem } from '~/src/orchestration/orchestrator';
import { createOrchestrator } from './page-harness';
import type { TranslateRequest } from '~/src/engines/types';

/** 改动前的切法：15 个单元一批，与长短无关 */
const OLD = { maxItems: 15, maxChars: Infinity };

/** 带种子的伪随机（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 维基 F1 车手页的形态（#1000 实测：2053 个单元，八成是表格格子，文字中位数
 * 5 字符，全页约 4.9 万字符）：八成 1–8 字的格子，其余是 40–200 字的句子与段落
 */
function wikiTablePage(): TranslateItem<number>[] {
  const r = rng(1000);
  return Array.from({ length: 2053 }, (_, i) => {
    const len = r() < 0.8 ? 1 + Math.floor(r() * 8) : 40 + Math.floor(r() * 160);
    return { text: `${i}:`.padEnd(len, 'w'), ctx: i };
  });
}

/** 长段落为主：60 段，每段 600–2400 字 */
function longParagraphPage(): TranslateItem<number>[] {
  const r = rng(7);
  return Array.from({ length: 60 }, (_, i) => ({
    text: `${i}:`.padEnd(600 + Math.floor(r() * 1800), 'p'),
    ctx: i,
  }));
}

/** 跑一次整页入口，收集每一批发出去的文本与渲染回调 */
async function run(
  input: TranslateItem<number>[],
  via: 'togglePage' | 'translatePage',
): Promise<{ sent: string[][]; rendered: [number, string[]][] }> {
  const sent: string[][] = [];
  const rendered: [number, string[]][] = [];
  const send = vi.fn(async (req: TranslateRequest) => {
    sent.push(req.texts);
    return { ok: true, data: { translations: req.texts.map((t) => `T(${t})`) } };
  });
  const orch = createOrchestrator({
    send,
    hasTranslated: () => false,
    onBatchResult: (i, batch) => rendered.push([i, batch.map((it) => it.text)]),
  });
  orch.start();
  if (via === 'togglePage') await orch.togglePage(input, 'en', 'zh-CN');
  else await orch.translatePage(input, 'en', 'zh-CN');
  orch.stop();
  return { sent, rendered };
}

const sorted = (xs: string[]) => [...xs].sort();

describe('整页翻译按字符预算切批（#1005）', () => {
  for (const via of ['togglePage', 'translatePage'] as const) {
    test(`${via}：新旧两种切法送出去的文本集合完全相同，只是分组不同`, async () => {
      const input = wikiTablePage();
      const { sent } = await run(input, via);
      const oldBatches = splitBatches(input, OLD).map((b) => b.map((it) => it.text));
      // 同一组文本：作为多重集相等，且按发送顺序拼起来也与原顺序一致
      expect(sorted(sent.flat())).toEqual(sorted(oldBatches.flat()));
      expect(sent.flat()).toEqual(input.map((it) => it.text));
      // 分组确实变了
      expect(sent.length).not.toBe(oldBatches.length);
    });
  }

  // #1006 实测之后放宽：个数上限从临时的 40 收到 20，往返次数不再腰斩。往返次数
  // 本来就不是瓶颈 —— Google 一条文本一个请求，分批只省 content 与后台之间的消息；
  // 真正要压的是单批耗时（条数乘单次请求耗时），见 docs/research/batch-char-budget.md。
  // 这里仍钉住“改用字符预算之后往返次数不比旧切法多”
  test('维基成绩表形态：往返次数比旧切法少', async () => {
    const input = wikiTablePage();
    const { sent } = await run(input, 'togglePage');
    const oldCount = splitBatches(input, OLD).length;
    expect(sent.length).toBeLessThan(oldCount);
  });

  test('长段落为主：没有一批超过字符预算，除非它只装了一个超长段落；旧切法下一批会大得多', async () => {
    const input = longParagraphPage();
    const { sent } = await run(input, 'togglePage');
    const len = (b: string[]) => b.reduce((n, t) => n + t.length, 0);
    for (const batch of sent) {
      if (len(batch) > FULL_PAGE_BATCH_LIMITS.maxChars) expect(batch).toHaveLength(1);
    }
    const oldMax = Math.max(...splitBatches(input, OLD).map((b) => len(b.map((it) => it.text))));
    expect(oldMax).toBeGreaterThan(FULL_PAGE_BATCH_LIMITS.maxChars * 5);
    expect(sent.flat()).toEqual(input.map((it) => it.text));
  });

  test('渐进渲染：每批按下标回调一次，回调里的批次就是发出去的那一批', async () => {
    const input = wikiTablePage();
    const { sent, rendered } = await run(input, 'togglePage');
    const byIndex = new Map(rendered);
    expect([...byIndex.keys()].sort((a, b) => a - b)).toEqual(sent.map((_, i) => i));
    expect(rendered).toHaveLength(sent.length);
    sent.forEach((texts, i) => expect(byIndex.get(i)).toEqual(texts));
  });
});
