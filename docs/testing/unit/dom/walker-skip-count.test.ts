/**
 * 采集入口报出被跳过的单元（#753，规格 #727）
 *
 * 整页翻译只统计采集之后的失败，进不了采集的内容无声消失。采集遍历本来就要
 * 对每个候选元素做跳过判定，在那里顺带记一次：collect 照 onHidden 的样子收
 * 一个注入的回调 onSkip，每跳过一个单元调用一次。调用方不传就什么都不发生，
 * collect 的返回类型不变。
 *
 * 最硬的一条：同一份 DOM，加统计前后采到的单元完全一致 —— 统计没有任何副作用，
 * 也不额外序列化 DOM、不额外读布局。
 *
 * 切入点只有采集入口 collect。只看外部可观察的行为：返回了哪些单元、回调
 * 被调了几次。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';

/** 超过文字长度上限的段落：真正超长、不该被翻的那种。 */
const TOO_LONG = `<p id="long">${'This sentence keeps going on and on. '.repeat(100)}</p>`;
/** 标记复杂度超限的段落：文字不长，子树元素个数超过兜底阈值。 */
const TOO_COMPLEX = `<p id="dense">${'<b>w</b> '.repeat(400)}</p>`;
/** 正常页面：段落、列表、标题，外加本来就不算单元的东西（纯数字、两个字母、容器）。 */
const NORMAL =
  '<h1 id="h">A title for the page</h1>' +
  '<p id="a">A normal paragraph with some words.</p>' +
  '<ul><li id="b">First item in the list</li><li id="c">Second item in the list</li></ul>' +
  '<p id="num">2026-10-13</p>' +
  '<p id="short">ab</p>' +
  '<div id="wrap"><p id="d">Nested paragraph inside a container.</p></div>';

let restoreRects: (() => void) | null = null;

function page(html: string): void {
  restoreRects ??= mockAllBoundingRects();
  document.body.innerHTML = html;
}

afterEach(() => {
  restoreRects?.();
  restoreRects = null;
  document.body.innerHTML = '';
});

function collectCounting(root: Node = document.body): { units: Element[]; skipped: number } {
  let skipped = 0;
  const units = collect(root, undefined, { onSkip: () => skipped++ });
  return { units, skipped };
}

describe('被跳过的总数（#753）', () => {
  test('正常段落里夹着一段超长、一段标记过密：报出 2，采到的是其余正常单元', () => {
    page(NORMAL + TOO_LONG + TOO_COMPLEX);
    const { units, skipped } = collectCounting();
    expect(units.map((u) => u.id)).toEqual(['h', 'a', 'b', 'c', 'd']);
    expect(skipped).toBe(2);
  });

  test('没有任何跳过时计数为零：纯数字、太短、容器本来就不是单元，不算跳过', () => {
    page(NORMAL);
    const { units, skipped } = collectCounting();
    expect(units.map((u) => u.id)).toEqual(['h', 'a', 'b', 'c', 'd']);
    expect(skipped).toBe(0);
  });

  test('每个被跳过的单元只报一次', () => {
    page(NORMAL + TOO_LONG + TOO_LONG.replace('id="long"', 'id="long2"'));
    const seen: Element[] = [];
    collect(document.body, undefined, { onSkip: (el) => seen.push(el) });
    expect(seen.map((el) => el.id)).toEqual(['long', 'long2']);
  });

  test('只读采集（闸门取样）同样能报，计数与普通采集一致', () => {
    page(NORMAL + TOO_LONG + TOO_COMPLEX);
    let readOnly = 0;
    collect(document.body, undefined, { readOnly: true, onSkip: () => readOnly++ });
    expect(readOnly).toBe(collectCounting().skipped);
  });
});

describe('统计没有副作用（#753）', () => {
  /** 一页里各种会走到跳过判定的东西，含会被切块的超长 br 段落与超大 pre。 */
  const MIXED =
    NORMAL +
    TOO_LONG +
    TOO_COMPLEX +
    `<p id="br">${Array.from({ length: 80 }, (_, i) => `Line number ${i} of a long poem that keeps going.`).join('<br>')}</p>` +
    `<div class="plain"><pre id="pre">${Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of plain text.\n\nMore words here.`).join('\n\n')}</pre></div>` +
    '<nav><p id="nav">Navigation link text here</p></nav>' +
    '<p id="hidden" style="display:none">Hidden paragraph text here</p>';

  test('同一份 DOM：不统计与统计各采一遍，采到的单元是同一批元素、顺序相同', () => {
    page(MIXED);
    // 第一遍会切块（改动 DOM），先采一遍让切块落定，再比较前后两遍
    collect();
    const plain = collect();
    const { units: counted } = collectCounting();
    expect(counted.length).toBe(plain.length);
    counted.forEach((el, i) => expect(el).toBe(plain[i]));
  });

  test('两份相同的 DOM：一份不统计、一份统计，采到的单元与采完后的页面逐字节相同', () => {
    page(MIXED);
    const a = collect().map((el) => el.outerHTML);
    const pageA = document.body.innerHTML;

    page(MIXED);
    const b = collectCounting().units.map((el) => el.outerHTML);
    const pageB = document.body.innerHTML;

    expect(b).toEqual(a);
    expect(pageB).toBe(pageA);
  });

  test('不额外序列化 DOM、不额外读布局：统计与不统计时的读取次数相同', () => {
    page(MIXED);
    collect(); // 让切块落定
    const plain = countReads(() => collect());
    const counted = countReads(() => collectCounting());
    expect(counted).toEqual(plain);
    expect(counted.serialize).toBe(0);
  });
});

/** fn 执行期间序列化子树与读布局的次数。只记读取，不拦截。 */
function countReads(fn: () => void): { serialize: number; layout: number } {
  const counts = { serialize: 0, layout: 0 };
  const restores: Array<() => void> = [];
  for (const name of ['outerHTML', 'innerHTML'] as const) {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, name)!;
    Object.defineProperty(Element.prototype, name, {
      ...desc,
      get(this: Element) {
        counts.serialize++;
        return desc.get!.call(this);
      },
    });
    restores.push(() => Object.defineProperty(Element.prototype, name, desc));
  }
  const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const rect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    counts.layout++;
    return rect.call(this);
  };
  restores.push(() => (proto.getBoundingClientRect = rect));
  const style = window.getComputedStyle;
  window.getComputedStyle = function (...args: Parameters<typeof getComputedStyle>) {
    counts.layout++;
    return style.apply(window, args);
  };
  restores.push(() => (window.getComputedStyle = style));
  try {
    fn();
  } finally {
    restores.reverse().forEach((r) => r());
  }
  return counts;
}
