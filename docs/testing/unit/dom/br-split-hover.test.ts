/**
 * 逐段翻译在以 br 分行的超长段落里只翻悬停的那一行（#712，规格 #694）
 *
 * 悬停路径与采集共用同一层跳过判定（#732）：超长段落整段当不了单元。逐段
 * 翻译入口 closestUnit 向上找单元时，遇到可以按行切的超长段落，先按行切开，
 * 再返回包含起点的那一行的切块 —— 按钮点下去只翻这一行，不是整段几千字。
 * 起点落在段落自身（行间空白、段落的直接文字在切开之前）时找不到单元。
 *
 * 切分只发生在 closestUnit 里：它只在悬停意图计时器、按钮点击、快捷键这些
 * 低频路径上调用，mouseover 处理只做 closest() 初筛（paragraph-btn.ts）。
 *
 * 经逐段翻译入口 closestUnit 与送翻文本的提取断言；按钮浮出、点击、请求内容
 * 由端到端覆盖（TC-E2E-188）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { closestUnit } from '~/src/dom/classify';
import { render } from '~/src/dom/renderer';
import { unitTextEx } from '~/src/dom/text';
import { brLines, collectUnits, fakeTranslate, isOverLimit, line, restorePage } from './br-split-harness';

const N = 60;

/** 第 7 行带一个链接（悬停起点）；段落外面包着一个自己也有文字的容器。 */
const withLink = (i: number) =>
  i === 7 ? `Line 7: she pointed at <a id="hover" href="#x">the old letter</a> and said nothing.` : line(i);

function setup(): HTMLElement {
  document.body.innerHTML =
    `<div id="wrap">Posted by a reader, read slowly.<p id="post">${brLines(N, '<br>\n', withLink)}</p></div>`;
  const post = document.getElementById('post')!;
  expect(isOverLimit(post)).toBe(true);
  return post;
}

let restoreRects: () => void;
beforeEach(() => {
  restoreRects = mockAllBoundingRects();
});
afterEach(() => {
  restoreRects();
  document.body.innerHTML = '';
});

describe('悬停在超长段落的某一行：返回那一行的切块（#712）', () => {
  test('起点是那一行里的链接：段落按行切开，返回第 7 行的切块，送翻文本就是这一行', () => {
    const post = setup();
    const unit = closestUnit(document.getElementById('hover')!)!;
    expect(unit).not.toBeNull();
    expect(unit.classList.contains('pt-chunk')).toBe(true);
    expect(unit.parentElement).toBe(post);
    expect(unitTextEx(unit).text.trim()).toBe(withLink(7).replace(/<[^>]+>/g, ''));
    // 整段按行切开了，不是只切出这一行
    expect(post.querySelectorAll(':scope > .pt-chunk')).toHaveLength(N);
  });

  test('起点是段落自身：切开但不返回任何单元', () => {
    const post = setup();
    expect(closestUnit(post)).toBeNull();
    expect(post.getAttribute('data-pt-split')).toBe('1');
    // 已经切开之后再从段落自身起找，仍然没有
    expect(closestUnit(post)).toBeNull();
  });

  test('切开之后，指针落到某一行的切块上：返回这个切块', () => {
    const post = setup();
    closestUnit(post);
    const chunks = [...post.querySelectorAll(':scope > .pt-chunk')];
    expect(closestUnit(chunks[12]!)).toBe(chunks[12]);
    expect(unitTextEx(chunks[12]!).text.trim()).toBe(line(12));
  });

  test('整页翻译已经切过的段落：悬停照样返回那一行，不重复切分', () => {
    const post = setup();
    collectUnits();
    const before = post.innerHTML;
    const unit = closestUnit(document.getElementById('hover')!)!;
    expect(unit.classList.contains('pt-chunk')).toBe(true);
    expect(post.innerHTML).toBe(before);
  });

  test('那一行已经翻译过：返回 null（与普通段落一致，已翻译的不再当单元）', () => {
    setup();
    const unit = closestUnit(document.getElementById('hover')!)!;
    render(unit, fakeTranslate(unitTextEx(unit).text), 'para');
    expect(closestUnit(document.getElementById('hover')!)).toBeNull();
  });
});

describe('不切的段落行为不变（#712）', () => {
  test('带 br 但没超上限：整段一个单元，DOM 不动', () => {
    document.body.innerHTML = `<p id="post">${brLines(10, '<br>\n', withLink)}</p>`;
    const before = document.body.innerHTML;
    expect(closestUnit(document.getElementById('hover')!)).toBe(document.getElementById('post'));
    expect(document.body.innerHTML).toBe(before);
  });

  test('超长但拒切（含代码语义元素）：不切，DOM 不动，找不到单元', () => {
    document.body.innerHTML = `<p id="post">${brLines(N, '<br>\n', withLink)} <code>x</code></p>`;
    const before = document.body.innerHTML;
    expect(closestUnit(document.getElementById('hover')!)).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  test('超长又没有 br：不切，找不到单元', () => {
    document.body.innerHTML = `<p id="post">${Array.from({ length: N }, (_, i) => withLink(i)).join(' ')}</p>`;
    const before = document.body.innerHTML;
    expect(closestUnit(document.getElementById('hover')!)).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('还原之后逐字节回到原样（#712）', () => {
  test('悬停切开、只翻那一行、再还原：段落 HTML 与悬停之前一字不差', () => {
    setup();
    const before = document.body.innerHTML;
    const unit = closestUnit(document.getElementById('hover')!)!;
    render(unit, fakeTranslate(unitTextEx(unit).text), 'para');
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(1);

    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
