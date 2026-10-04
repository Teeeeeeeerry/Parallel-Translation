/**
 * SVG 里嵌的 HTML（foreignObject 内）不作为翻译单元（#630）
 *
 * draw.io 图形面板的缩略图标签、画布上的 HTML 标签，以及 mermaid、
 * graphviz、ECharts 画出的图，都把文字放在 foreignObject 里。这些标签由
 * 绘图库按模型重绘，译文留不住。判定按文档结构做：元素自身或祖先链上
 * 有 foreignObject 就跳过，不认任何站点的 class 名。
 *
 * 全页翻译 —— collect()；逐段翻译 —— closestUnit()，分别验证。
 * svg 仍是行内元素：段落里的行内图标不阻断段落判定（#55、#589）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';

const ids = (units: Element[]) => units.map((u) => u.id);
const $ = (id: string) => document.getElementById(id)!;

/** draw.io 图形面板的结构：a.geItem > svg > g > foreignObject > div > div */
const IN_SVG =
  '<div class="geSidebar"><a class="geItem" href="#">' +
  '<svg width="40" height="40"><g><foreignObject width="40" height="20">' +
  '<div xmlns="http://www.w3.org/1999/xhtml"><div id="label" class="shape-label">Vertical Container</div>' +
  '<p id="blk">Another label inside the chart</p></div>' +
  '</foreignObject></g></svg></a></div>';

let restore: () => void;
beforeEach(() => {
  resetStorage();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('foreignObject 内的文字（#630）', () => {
  test('带文字的 div 在 foreignObject 里：采集不收，逐段翻译找不到单元', () => {
    document.body.innerHTML = IN_SVG;
    expect(ids(collect())).toEqual([]);
    expect(closestUnit($('label'))).toBeNull();
  });

  test('foreignObject 内的块级后代同样不收（整块语义）', () => {
    document.body.innerHTML = IN_SVG;
    expect(collect()).not.toContain($('blk'));
    expect(closestUnit($('blk'))).toBeNull();
  });

  test('同一个 div 搬到 foreignObject 外就照常是翻译单元 —— 判的是位置不是 class', () => {
    document.body.innerHTML =
      '<div class="geSidebar"><div id="label" class="shape-label">Vertical Container</div></div>';
    expect(ids(collect())).toEqual(['label']);
    expect(closestUnit($('label'))?.id).toBe('label');
  });

  test('图表旁的普通段落照常采集', () => {
    document.body.innerHTML = IN_SVG + '<p id="body">The chart above shows quarterly revenue.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit($('body'))?.id).toBe('body');
  });
});

describe('行内 svg 图标不阻断段落判定（#55、#589 回归）', () => {
  test('段落里夹着行内 svg 图标：段落照常是翻译单元', () => {
    document.body.innerHTML =
      '<p id="para"><svg width="12" height="12"><path d="M0 0h12v12H0z"/></svg> Read the release notes for details.</p>';
    expect(ids(collect())).toEqual(['para']);
    expect(closestUnit($('para'))?.id).toBe('para');
  });

  test('只包着链接与 svg 图标的 div：照常是翻译单元', () => {
    document.body.innerHTML =
      '<div id="learn"><a id="link" href="/docs"><svg width="12" height="12"><path d="M0 0h1v1z"/></svg>Learn how we count contributions</a></div>';
    expect(ids(collect())).toEqual(['learn']);
    expect(closestUnit($('link'))?.id).toBe('learn');
  });
});
