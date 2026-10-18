/**
 * 输入翻译圆点的定位模块：行高上限与就位状态（#1081，父 #1070）
 *
 * 定位模块持有测量、收小（行高上限）、回落位置与就位状态。jsdom 没有布局，
 * 测量在这里注入；时钟用假定时器推进。只断言外部行为：圆点何时就位、就位在
 * 哪里、多大，不断言内部计时器。ADR-0006 的三条规则不变。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDotPlacer, lineCap, type MeasureEnd } from '~/src/ui/input-dot-place';
import { SHOW_DELAY } from '~/src/ui/float-common';
import { mockBoundingRect } from '~/docs/testing/setup';
import type { TextEnd } from '~/src/ui/input-measure';

let shadow: ShadowRoot;
let dot: HTMLButtonElement;

/** 圆点的布局直径（jsdom 没有布局，直接给）。 */
function sizeDot(px: number): void {
  Object.defineProperty(dot, 'offsetWidth', { configurable: true, get: () => px });
}

function box(lineHeight = '20px'): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.style.lineHeight = lineHeight;
  document.body.appendChild(ta);
  mockBoundingRect(ta, { left: 100, top: 50, right: 400, bottom: 250, width: 300, height: 200 });
  return ta;
}

const END: TextEnd = { x: 200, y: 120, height: 16 };
const at = (end: TextEnd | null): MeasureEnd => vi.fn(() => end);

beforeEach(() => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  dot = document.createElement('button');
  shadow.appendChild(dot);
  sizeDot(14);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('就位状态（#1081）', () => {
  test('打字：停手计时到之前是跟随中、不测量；停手后对齐一次，已就位', () => {
    const measure = at(END);
    const p = createDotPlacer(dot, shadow, measure);
    const ta = box();
    p.follow(ta, true);
    expect(p.state()).toBe('following');
    expect(dot.dataset.placement).toBe('following');
    vi.advanceTimersByTime(SHOW_DELAY - 1);
    expect(p.state()).toBe('following');
    expect(measure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(p.state()).toBe('settled');
    expect(dot.dataset.placement).toBe('settled');
    expect(measure).toHaveBeenCalledTimes(1);
  });

  test('连续打字重置停手计时：最后一次之后满 SHOW_DELAY 才就位，只量一次', () => {
    const measure = at(END);
    const p = createDotPlacer(dot, shadow, measure);
    const ta = box();
    p.follow(ta, true);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(SHOW_DELAY - 10);
      p.follow(ta, false);
    }
    expect(p.state()).toBe('following');
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(p.state()).toBe('settled');
    expect(measure).toHaveBeenCalledTimes(1);
  });

  test('聚焦、滚动等立即对齐：当场已就位，贴在文字末尾之后（留 GAP 的间隙）', () => {
    const p = createDotPlacer(dot, shadow, at(END));
    p.settle(box());
    expect(p.state()).toBe('settled');
    expect(parseFloat(dot.style.left)).toBe(END.x + 4);
  });

  test('测量失败：回落到框内右下角，且为已就位', () => {
    const p = createDotPlacer(dot, shadow, at(null));
    p.settle(box());
    expect(p.state()).toBe('settled');
    expect(parseFloat(dot.style.left)).toBeGreaterThan(400 - 40);
    expect(parseFloat(dot.style.top)).toBeGreaterThan(250 - 40);
  });

  test('打字时刚浮出：先放回落位置（跟随中），停手后挪到文字末尾', () => {
    const p = createDotPlacer(dot, shadow, at(END));
    p.follow(box(), true);
    expect(parseFloat(dot.style.left)).toBeGreaterThan(400 - 40);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(parseFloat(dot.style.left)).toBe(END.x + 4);
  });

  test('状态变化可订阅；隐藏（reset）时报 null、属性去掉、等着的对齐不再发生', () => {
    const measure = at(END);
    const p = createDotPlacer(dot, shadow, measure);
    const seen: (string | null)[] = [];
    p.subscribe((s) => seen.push(s));
    p.follow(box(), true);
    p.reset();
    vi.advanceTimersByTime(SHOW_DELAY * 2);
    expect(seen).toEqual(['following', null]);
    expect(dot.dataset.placement).toBeUndefined();
    expect(measure).not.toHaveBeenCalled();
  });

  test('等停手时 waiting 为真（滚动、改尺寸交给停手后的对齐）', () => {
    const p = createDotPlacer(dot, shadow, at(END));
    p.follow(box(), true);
    expect(p.waiting()).toBe(true);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(p.waiting()).toBe(false);
  });
});

describe('行高上限只在定位模块算（#997、#1017、#1081）', () => {
  test('调大后不越过上一行：多行框按框的行高收小，圆点上沿不高于上一行字形的下沿', () => {
    sizeDot(40);
    const lh = 20;
    const p = createDotPlacer(dot, shadow, at(END));
    p.settle(box(`${lh}px`));
    const cap = 2 * lh - END.height;
    expect(dot.style.maxWidth).toBe(`${cap}px`);
    expect(parseFloat(dot.style.top)).toBeGreaterThanOrEqual(END.y - (lh - END.height));
  });

  test('设置的直径装得下：不收小', () => {
    sizeDot(14);
    const p = createDotPlacer(dot, shadow, at(END));
    p.settle(box('20px'));
    expect(dot.style.maxWidth).toBe('');
  });

  test('单行框上下没有别的行：不收', () => {
    const input = document.createElement('input');
    expect(lineCap(input, END)).toBeNull();
  });

  test('contenteditable 读末尾那段文字所在元素的行高，不是宿主的（#1017）', () => {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    host.style.lineHeight = '40px';
    host.innerHTML = '<p>first</p><p style="line-height: 18px">last line</p>';
    document.body.appendChild(host);
    expect(lineCap(host, END)).toBe(2 * 18 - END.height);
  });

  test('行高是 normal：按字形高算', () => {
    const ta = box('normal');
    expect(lineCap(ta, END)).toBe(END.height);
  });
});
