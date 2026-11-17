/**
 * 输入翻译圆点的定位模块：行高上限与就位状态（#1081，父 #1070）
 *
 * 定位模块持有测量、收小（行高上限）、回落位置与就位状态。jsdom 没有布局，
 * 测量在这里注入；时钟用假定时器推进。只断言外部行为：圆点何时就位、就位在
 * 哪里、多大，不断言内部计时器。ADR-0006 的三条规则不变。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDotPlacer, lineCap, INPUT_DOT_SAFE_DISTANCE, type MeasureEnd } from '~/src/ui/input-dot-place';
import { inputDotHitSize } from '~/src/ui/floating-ui-size';
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

  test('聚焦、滚动等立即对齐：当场已就位，贴在文字末尾之后（留安全距离，#1180）', () => {
    const p = createDotPlacer(dot, shadow, at(END));
    p.settle(box());
    expect(p.state()).toBe('settled');
    expect(parseFloat(dot.style.left)).toBe(END.x + INPUT_DOT_SAFE_DISTANCE);
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
    expect(parseFloat(dot.style.left)).toBe(END.x + INPUT_DOT_SAFE_DISTANCE);
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

/**
 * 安全距离（#1180）：误触发生在可点区，所以约束落在可点区上 —— 可点区与文字
 * 末尾（光标）至少隔开 INPUT_DOT_SAFE_DISTANCE，四种摆法都一样。可点区在视口里
 * 的范围由圆点位置加 --pt-hit-x / --pt-hit-y 偏移得出，边长按直径换算。
 */
describe('圆点与光标的安全距离（#1180）', () => {
  /** 可点区边长：收小过（行高上限）时取圆点上写的那一份，否则按直径换算 */
  function hitRect(size: number) {
    const hit = parseFloat(dot.style.getPropertyValue('--pt-input-dot-hit')) || inputDotHitSize(size);
    const left = parseFloat(dot.style.left) + parseFloat(dot.style.getPropertyValue('--pt-hit-x'));
    const top = parseFloat(dot.style.top) + parseFloat(dot.style.getPropertyValue('--pt-hit-y'));
    return { left, top, right: left + hit, bottom: top + hit };
  }

  function frame(rect: { left: number; top: number; right: number; bottom: number }, dir = 'ltr'): HTMLTextAreaElement {
    const ta = document.createElement('textarea');
    ta.style.lineHeight = '20px';
    ta.style.direction = dir;
    document.body.appendChild(ta);
    mockBoundingRect(ta, { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
    return ta;
  }

  for (const size of [14, 28]) {
    test(`末尾之后（LTR，直径 ${size}px）：可点区左边缘离末尾至少安全距离`, () => {
      sizeDot(size);
      createDotPlacer(dot, shadow, at(END)).settle(box());
      expect(hitRect(size).left).toBeGreaterThanOrEqual(END.x + INPUT_DOT_SAFE_DISTANCE);
    });

    test(`末尾之后（RTL，直径 ${size}px）：可点区右边缘离末尾至少安全距离`, () => {
      sizeDot(size);
      createDotPlacer(dot, shadow, at(END)).settle(frame({ left: 100, top: 50, right: 400, bottom: 250 }, 'rtl'));
      expect(hitRect(size).right).toBeLessThanOrEqual(END.x - INPUT_DOT_SAFE_DISTANCE);
    });

    test(`换到末尾那一行下方（直径 ${size}px）：可点区上边缘离那一行底部至少安全距离`, () => {
      sizeDot(size);
      const end: TextEnd = { x: 395, y: 120, height: 16 };
      createDotPlacer(dot, shadow, at(end)).settle(box());
      expect(hitRect(size).top).toBeGreaterThanOrEqual(end.y + end.height + INPUT_DOT_SAFE_DISTANCE);
    });

    test(`换到末尾那一行上方（直径 ${size}px）：可点区下边缘离那一行顶部至少安全距离`, () => {
      sizeDot(size);
      const end: TextEnd = { x: 395, y: 220, height: 16 };
      createDotPlacer(dot, shadow, at(end)).settle(box());
      expect(hitRect(size).bottom).toBeLessThanOrEqual(end.y - INPUT_DOT_SAFE_DISTANCE);
    });
  }

  test('单行框末尾顶到右边缘：换到光标另一侧，可点区右边缘离末尾至少安全距离', () => {
    const end: TextEnd = { x: 395, y: 52, height: 16 };
    createDotPlacer(dot, shadow, at(end)).settle(frame({ left: 100, top: 50, right: 400, bottom: 70 }));
    expect(hitRect(14).right).toBeLessThanOrEqual(end.x - INPUT_DOT_SAFE_DISTANCE);
  });

  test('窄单行框、末尾两侧都放不下：硬边界优先，圆点宁可出框也不挤进安全距离', () => {
    // 框宽 30px，末尾在正中：两侧都放不下 8px 加圆点。钳回框内就会压到光标
    const end: TextEnd = { x: 115, y: 52, height: 16 };
    createDotPlacer(dot, shadow, at(end)).settle(frame({ left: 100, top: 50, right: 130, bottom: 70 }));
    const r = hitRect(14);
    expect(r.right <= end.x - INPUT_DOT_SAFE_DISTANCE || r.left >= end.x + INPUT_DOT_SAFE_DISTANCE).toBe(true);
  });

  test('末尾滚出可见区域：圆点照旧钳在框的可见边缘（#669），不因安全距离被推出框', () => {
    const end: TextEnd = { x: 40, y: 52, height: 16 };
    createDotPlacer(dot, shadow, at(end)).settle(frame({ left: 100, top: 50, right: 400, bottom: 70 }));
    expect(parseFloat(dot.style.left)).toBeGreaterThanOrEqual(100);
  });

  test('行高上限收小之后换到下方：可点区仍离那一行底部至少安全距离', () => {
    sizeDot(40);
    const end: TextEnd = { x: 395, y: 120, height: 16 };
    createDotPlacer(dot, shadow, at(end)).settle(box('20px'));
    expect(dot.style.maxWidth).not.toBe('');
    expect(hitRect(40).top).toBeGreaterThanOrEqual(end.y + end.height + INPUT_DOT_SAFE_DISTANCE);
  });

  test('行高上限收小之后（直径 40 收到行高以内）：可点区仍离末尾至少安全距离', () => {
    sizeDot(40);
    createDotPlacer(dot, shadow, at(END)).settle(box('20px'));
    expect(dot.style.maxWidth).not.toBe('');
    expect(hitRect(40).left).toBeGreaterThanOrEqual(END.x + INPUT_DOT_SAFE_DISTANCE);
  });
});
