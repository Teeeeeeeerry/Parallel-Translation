/**
 * splitBatches 的两道闸：字符预算与个数上限（#1004，父 #1000）
 *
 * 断言性质，不断言“等于某个魔数”：预算一调，魔数用例就红，而它什么也没保住。
 *   1. 不丢、不重、不乱序：各批依次拼起来就是原输入；
 *   2. 没有批次超过个数上限；
 *   3. 没有批次超过字符预算，除非它只装了一个本身就超预算的单元；
 *   4. 贪心装满：相邻两批，前一批再装下后一批的第一项就会越过某道闸 ——
 *      挡住“每项自成一批”这种满足 1–3 却把往返次数翻几十倍的切法；
 *   5. 批次数随预算单调不增，随个数上限单调不增；
 *   6. 预算真的在起作用：长单元为主的输入上，有限预算比无穷预算切出更多批
 *      —— 把实现里的预算当成无穷大时这一条红。
 *
 * 输入用带种子的伪随机生成，形态覆盖维基成绩表那种一两个字的格子与长段落混排。
 */
import { describe, test, expect } from 'vitest';
import { splitBatches, type TranslateItem } from '~/src/orchestration/orchestrator';

/** mulberry32：带种子的伪随机，失败时可复现 */
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

/** 随机一页：七成是 1–8 字的格子，两成是 20–200 字的句子，一成是 300–3000 字的长段落 */
function page(seed: number, n: number): TranslateItem<number>[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const p = r();
    const len =
      p < 0.7 ? 1 + Math.floor(r() * 8) : p < 0.9 ? 20 + Math.floor(r() * 180) : 300 + Math.floor(r() * 2700);
    return { text: 'x'.repeat(len), ctx: i };
  });
}

const chars = (batch: TranslateItem<number>[]) => batch.reduce((n, it) => n + it.text.length, 0);

function checkInvariants(
  input: TranslateItem<number>[],
  batches: TranslateItem<number>[][],
  maxItems: number,
  maxChars: number,
): void {
  // 1. 不丢、不重、不乱序（按 ctx 比较身份，文本可能重复）
  expect(batches.flat().map((it) => it.ctx)).toEqual(input.map((it) => it.ctx));
  for (const [i, batch] of batches.entries()) {
    expect(batch.length, `第 ${i} 批非空`).toBeGreaterThan(0);
    // 2. 个数上限
    expect(batch.length, `第 ${i} 批个数`).toBeLessThanOrEqual(maxItems);
    // 3. 字符预算，只有单个超长单元可以例外
    if (chars(batch) > maxChars) expect(batch.length, `第 ${i} 批超预算却不止一项`).toBe(1);
    // 4. 贪心装满：再装下一批的第一项就越闸
    const next = batches[i + 1];
    if (next) {
      const wouldOverflow =
        batch.length + 1 > maxItems || chars(batch) + next[0]!.text.length > maxChars;
      expect(wouldOverflow, `第 ${i} 批还装得下下一项却收批了`).toBe(true);
    }
  }
}

describe('splitBatches：字符预算与个数上限双闸（#1004）', () => {
  test('边界：空输入 → 0 批', () => {
    expect(splitBatches([], { maxItems: 40, maxChars: 2000 })).toEqual([]);
  });

  test('边界：全部加起来不到一个预算、也不到个数上限 → 1 批，原样装下', () => {
    const input = page(1, 30).map((it) => ({ ...it, text: it.text.slice(0, 5) }));
    const batches = splitBatches(input, { maxItems: 40, maxChars: 2000 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(input);
  });

  test('边界：恰好等于预算的一批不切，多一个字才切', () => {
    const input = [{ text: 'a'.repeat(60), ctx: 0 }, { text: 'b'.repeat(40), ctx: 1 }];
    expect(splitBatches(input, { maxItems: 40, maxChars: 100 })).toHaveLength(1);
    expect(splitBatches(input, { maxItems: 40, maxChars: 99 })).toHaveLength(2);
  });

  test('单个单元本身超过预算：自成一批，前后的单元照常装批，一个都不丢', () => {
    const input = [
      { text: 'a'.repeat(10), ctx: 0 },
      { text: 'b'.repeat(500), ctx: 1 },
      { text: 'c'.repeat(10), ctx: 2 },
      { text: 'd'.repeat(10), ctx: 3 },
    ];
    const batches = splitBatches(input, { maxItems: 40, maxChars: 100 });
    expect(batches.map((b) => b.map((it) => it.ctx))).toEqual([[0], [1], [2, 3]]);
    checkInvariants(input, batches, 40, 100);
  });

  test('连续几个超长单元：各自一批', () => {
    const input = [0, 1, 2].map((i) => ({ text: 'x'.repeat(300), ctx: i }));
    const batches = splitBatches(input, { maxItems: 40, maxChars: 100 });
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });

  test('个数上限先到：一两个字的格子按个数切，不会因为字少挤进同一批', () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ text: 'ab', ctx: i }));
    const batches = splitBatches(input, { maxItems: 40, maxChars: 2000 });
    checkInvariants(input, batches, 40, 2000);
    for (const b of batches.slice(0, -1)) expect(b).toHaveLength(40);
  });

  test('随机页面上性质全部成立（多组种子 × 多组闸值）', () => {
    for (const seed of [1, 2, 3, 7, 42, 1004]) {
      const input = page(seed, 400);
      for (const maxItems of [1, 5, 15, 40, 1000]) {
        for (const maxChars of [1, 50, 500, 2000, 5000, Infinity]) {
          checkInvariants(input, splitBatches(input, { maxItems, maxChars }), maxItems, maxChars);
        }
      }
    }
  });

  test('批次数随预算单调不增、随个数上限单调不增', () => {
    for (const seed of [3, 11, 99]) {
      const input = page(seed, 500);
      for (const maxItems of [15, 40, 100]) {
        const counts = [100, 300, 1000, 2000, 4000, 8000, Infinity].map(
          (maxChars) => splitBatches(input, { maxItems, maxChars }).length,
        );
        for (let i = 1; i < counts.length; i++) {
          expect(counts[i], `种子 ${seed} 个数上限 ${maxItems}：${counts.join(',')}`).toBeLessThanOrEqual(counts[i - 1]!);
        }
      }
      for (const maxChars of [500, 2000]) {
        const counts = [5, 15, 40, 100].map((maxItems) => splitBatches(input, { maxItems, maxChars }).length);
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]!);
      }
    }
  });

  test('预算真的在起作用：长段落为主的输入上，有限预算比无穷预算切出更多批', () => {
    // 每段 300–3000 字，个数上限放到很大，只剩预算这一道闸能切
    const input = page(5, 200).map((it, i) => ({ ...it, text: 'y'.repeat(300 + ((i * 137) % 2700)) }));
    const finite = splitBatches(input, { maxItems: 1000, maxChars: 2000 }).length;
    const infinite = splitBatches(input, { maxItems: 1000, maxChars: Infinity }).length;
    expect(infinite).toBe(1);
    expect(finite).toBeGreaterThan(infinite);
  });
});
