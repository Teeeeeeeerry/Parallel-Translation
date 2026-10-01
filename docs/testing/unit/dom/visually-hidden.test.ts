/**
 * 读屏软件专用的隐藏文字不翻译（#595）
 *
 * sr-only、visually-hidden 这类样式把元素缩成 1×1 像素并裁掉：眼睛看不到，
 * 读屏软件照常朗读。翻译后插入的译文不继承隐藏样式，原本看不见的文字会
 * 以译文形式出现、挤坏布局（#580 的贡献图）。按渲染尺寸判定“视觉上隐藏”，
 * 不看 class 名。
 *
 * 全页翻译 —— walker 采集入口 collect()；逐段翻译 —— closestUnit()（#409）：
 * 段落去掉视觉上隐藏的后代之后没有可翻译的文字，不算翻译单元（判定位置
 * 与 #454 相同，两个入口共用）。
 * 文本提取（translatableTextEx / shallowTranslatableTextEx，全页与逐段翻译
 * 共用）：视觉上隐藏的元素不进入送翻文本。
 *
 * 宽高都为 0 的不可见元素仍按原来的不可见判定处理（#23），不在本文件范围。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { translatableTextEx, shallowTranslatableTextEx } from '~/src/dom/text';

const ids = (units: Element[]) => units.map((u) => u.id);

/** 把页面里的 .sr-only 元素设成 1×1 的渲染尺寸 —— 与浏览器里 sr-only 样式的结果一致 */
function hideSrOnly() {
  for (const el of document.querySelectorAll('.sr-only')) mockBoundingRect(el, { width: 1, height: 1 });
}

let restore: () => void;
beforeEach(() => {
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('采集：只有读屏隐藏文字的段落不算翻译单元（#595）', () => {
  test('段落里只有一段 1×1 的隐藏文字：不采集，也找不到段落', () => {
    document.body.innerHTML =
      '<p id="loading"><span class="sr-only" id="sr">Loading the latest activity</span></p>' +
      '<p id="body">Body text here.</p>';
    hideSrOnly();
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('sr')!)).toBeNull();
  });

  test('段落自身就是 1×1 的隐藏元素：不采集，也找不到段落', () => {
    document.body.innerHTML =
      '<h2 class="sr-only" id="sr">Navigation menu for the repository</h2><p id="body">Body text here.</p>';
    hideSrOnly();
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('sr')!)).toBeNull();
  });

  test('含块级子项的列表项：除隐藏文字外只有标点时父项不采集，子项照常采集', () => {
    document.body.innerHTML =
      '<ul><li id="parent">— <span class="sr-only">Expand the section</span>' +
      '<ul><li id="child">Follow-up item for the next release</li></ul></li></ul>';
    hideSrOnly();
    expect(ids(collect())).toEqual(['child']);
  });

  test('段落里有可见文字和一段隐藏文字：照常采集，在隐藏文字上也找到这个段落', () => {
    document.body.innerHTML =
      '<p id="p">Starred <span class="sr-only" id="sr">this repository</span> yesterday by the team.</p>';
    hideSrOnly();
    expect(ids(collect())).toEqual(['p']);
    expect(closestUnit(document.getElementById('sr')!)?.id).toBe('p');
  });
});

describe('文本提取：隐藏文字不进入送翻文本（#595）', () => {
  test('完整提取（逐段翻译与不含块级子元素的段落）', () => {
    document.body.innerHTML =
      '<p id="p">Starred <span class="sr-only">this repository</span> yesterday by the team.</p>';
    hideSrOnly();
    const { text } = translatableTextEx(document.getElementById('p')!);
    expect(text).toContain('Starred');
    expect(text).toContain('yesterday by the team.');
    expect(text).not.toContain('this repository');
  });

  test('浅层提取（全页翻译里含块级子元素的段落）', () => {
    document.body.innerHTML =
      '<li id="parent">Assigned items <span class="sr-only">hidden counter</span>' +
      '<ul><li>Follow-up item for the next release</li></ul></li>';
    hideSrOnly();
    const { text } = shallowTranslatableTextEx(document.getElementById('parent')!);
    expect(text).toContain('Assigned items');
    expect(text).not.toContain('hidden counter');
  });

  test('2×2 以上的小元素不算隐藏，照常送翻', () => {
    document.body.innerHTML = '<p id="p">Read the <span id="tiny">small print</span> carefully today.</p>';
    mockBoundingRect(document.getElementById('tiny')!, { width: 2, height: 2 });
    expect(translatableTextEx(document.getElementById('p')!).text).toContain('small print');
  });
});
