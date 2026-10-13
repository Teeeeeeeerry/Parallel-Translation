/**
 * hasTranslatableText 的开销不随段落里的后代元素增长（#821）
 *
 * #737 实测悬停精判七成多的时间花在 hasTranslatableText：它为了判断“去掉保留
 * 原文与看不见的文字之后还有没有可翻译的文字”，把整棵子树走一遍，每个后代
 * 元素读一次布局、匹配一遍保留原文与排除的选择器。维基这类标记密集的段落，
 * 一段就有几十上百个引用角标与条目链接。
 *
 * #821 起，段落自己的直接文字里有可翻译字符时直接得出“有”，不再走子树。
 * 量法照 #737、#924：数次数，不量毫秒 —— 给每段塞进几十个行内元素，整页采集
 * 与逐段悬停精判读布局、匹配选择器、读文本节点的次数一次都不多。毫秒数只
 * 写在 PR 里作参考（真实 Chromium：70 段悬停精判 4.4ms 降到 0.8ms）。
 *
 * 采集结果不变由 collect-result-stable.test.ts 的金标准钉住。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';

/**
 * 一段正文：两截直接文字之间夹着 refs 个连在一起的引用角标（行内元素，里面再
 * 套一层链接）。角标之间不留空白：变的只有后代元素的个数，段落的直接文本节点
 * 始终是两个 —— 单元判定本来就要逐个看直接文本节点（directTextLength），那部分
 * 随直接文本节点增长，与本票无关。
 */
function paragraph(i: number, refs: number): string {
  const words = `Paragraph ${i} describes the early career of the actress and her first roles`;
  const notes = Array.from({ length: refs }, (_, j) => `<sup class="reference"><a href="#n${i}-${j}">[${j}]</a></sup>`).join('');
  return `<p id="p${i}">${words} ${notes} and how critics received them at the time.</p>`;
}

function buildPage(refs: number): void {
  document.body.innerHTML = `<article>${Array.from({ length: 40 }, (_, i) => paragraph(i, refs)).join('')}</article>`;
}

interface Counts {
  /** 读布局：getBoundingClientRect */
  layout: number;
  /** 匹配选择器：Element.matches */
  matches: number;
  /** 读文本节点的文字 */
  textReads: number;
}

/** 统计 fn 执行期间的次数。只记次数，不拦截，行为不变。 */
function count(fn: () => void): Counts {
  const c: Counts = { layout: 0, matches: 0, textReads: 0 };
  const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const rect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    c.layout++;
    return rect.call(this);
  };
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (this: Element, sel: string) {
    c.matches++;
    return matches.call(this, sel);
  };
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
  Object.defineProperty(Node.prototype, 'textContent', {
    ...text,
    get(this: Node) {
      if (this.nodeType === Node.TEXT_NODE) c.textReads++;
      return text.get!.call(this);
    },
  });
  try {
    fn();
  } finally {
    proto.getBoundingClientRect = rect;
    Element.prototype.matches = matches;
    Object.defineProperty(Node.prototype, 'textContent', text);
  }
  return c;
}

/** 在每一段上从它的第一个链接起做一次悬停精判（没有链接就从段落起）。 */
function hoverEach(): Element[] {
  return [...document.querySelectorAll('article > p')].map((p) => closestUnit(p.querySelector('a') ?? p)!);
}

let restoreRects: (() => void) | undefined;
afterEach(() => {
  restoreRects?.();
  restoreRects = undefined;
  document.body.innerHTML = '';
});

describe('段落里的后代元素再多，判定的次数也不变（#821）', () => {
  test('整页采集：每段 1 个与 40 个引用角标，读布局、匹配选择器、读文本节点的次数一样', () => {
    restoreRects = mockAllBoundingRects();
    buildPage(1);
    let units = 0;
    const plain = count(() => {
      units = collect(document.body, undefined, { readOnly: true }).length;
    });
    expect(units).toBe(40);

    buildPage(40);
    const dense = count(() => {
      units = collect(document.body, undefined, { readOnly: true }).length;
    });
    expect(units).toBe(40);
    expect(dense).toEqual(plain);
  });

  test('悬停精判：每段 1 个与 40 个引用角标，在每一段上精判一次，读布局、匹配选择器、读文本节点的次数一样', () => {
    restoreRects = mockAllBoundingRects();
    buildPage(1);
    let found: Element[] = [];
    const plain = count(() => {
      found = hoverEach();
    });
    expect(found.map((el) => el.id)).toEqual(Array.from({ length: 40 }, (_, i) => `p${i}`));

    buildPage(40);
    const dense = count(() => {
      found = hoverEach();
    });
    expect(found.map((el) => el.id)).toEqual(Array.from({ length: 40 }, (_, i) => `p${i}`));
    // 起点是第一个链接：从角标里的链接往上多走两层（a、sup），多出的只有这两层
    // 各自的标签判定，不读布局、不匹配保留原文与排除的选择器
    expect(dense.layout).toBe(plain.layout);
    expect(dense.matches).toBe(plain.matches);
    expect(dense.textReads).toBe(plain.textReads);
  });
});
