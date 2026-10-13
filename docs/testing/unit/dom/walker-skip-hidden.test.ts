/**
 * 不可见而进延迟队列的单元不计入跳过（#755，规格 #727）
 *
 * 不可见的翻译单元经 onHidden 登记进延迟队列，等观察器发现它可见了再补翻
 * （#23）。它们不是被丢掉，是还没轮到 —— 算进跳过数会让提示虚高，用户以为
 * 丢了内容。
 *
 * 切入点只有采集入口 collect：看 onHidden 收到了谁、onSkip 收到了谁、采到了
 * 哪些单元。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect } from '../../setup';
import { collect, type SkipCategory } from '~/src/dom/walker';

const TOO_LONG = `<p id="long">${'This sentence keeps going on and on. '.repeat(100)}</p>`;

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  document.body.innerHTML = '';
});

function run(root: Node = document.body) {
  const hidden: string[] = [];
  const skipped: [string, SkipCategory][] = [];
  const units = collect(root, (el) => hidden.push(el.id), {
    onSkip: (el, category) => skipped.push([el.id, category]),
  });
  return { units: units.map((u) => u.id), hidden, skipped };
}

describe('不可见单元不计入跳过（#755）', () => {
  test('折叠起来的段落进延迟队列，不算跳过；同页超长的段落仍算（反向）', () => {
    restore = mockAllBoundingRects();
    document.body.innerHTML =
      '<p id="a">A normal visible paragraph.</p>' +
      '<details><p id="folded">A paragraph inside a collapsed section.</p></details>' +
      TOO_LONG;
    mockBoundingRect(document.getElementById('folded')!, { width: 0, height: 0 });

    expect(run()).toEqual({
      units: ['a'],
      hidden: ['folded'],
      skipped: [['long', 'too-long']],
    });
  });

  test('可见之后观察器重新采集它：照常采到，也不报跳过', () => {
    restore = mockAllBoundingRects();
    document.body.innerHTML = '<p id="a">A normal visible paragraph.</p><p id="later">Shown after a click.</p>';
    const later = document.getElementById('later')!;
    mockBoundingRect(later, { width: 0, height: 0 });
    expect(run().hidden).toEqual(['later']);

    mockBoundingRect(later);
    expect(run(later)).toEqual({ units: ['later'], hidden: [], skipped: [] });
  });

  test('整页都还没显示出来（如懒加载的标签页）：报零，不是满页跳过', () => {
    restore = mockAllBoundingRects({ width: 0, height: 0 });
    document.body.innerHTML = '<p id="a">First paragraph.</p><p id="b">Second paragraph.</p>';
    const { units, hidden, skipped } = run();
    expect(units).toEqual([]);
    expect(hidden).toEqual(['a', 'b']);
    expect(skipped).toEqual([]);
  });
});
