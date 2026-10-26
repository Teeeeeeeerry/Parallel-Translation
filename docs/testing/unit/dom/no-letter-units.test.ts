/**
 * 一个字母都没有的元素不算翻译单元（#1002）
 *
 * 维基成绩表里三成格子是纯数字或符号（`1996–2009`、`—`、`+0.5`），送去引擎
 * 只会原样回来。判在采集层：它们本来就不是单元，逐段翻译按钮也不在上面浮出
 * （按钮找单元走的是同一个 closestUnit，这是接受的取舍）。
 *
 * 判据是 Unicode 字母类别（\p{L}），不是拉丁字母：中日韩、西里尔、阿拉伯文
 * 都算字母，Ret、DNF 这类短文本照常是单元。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { shouldSkipNonVisual } from '~/src/dom/classify';
import { closestUnit } from '~/src/dom/units';
import { collect } from '~/src/dom/walker';

/** 没有字母的格子：数字加各种连接号、纯符号、计时、带单位符号的数字 */
const NO_LETTERS = ['1996–2009', '2001—2004', '—', '† ‡ §', '1:23.456', '±0.5', '12 · 34', '100 %', '№ 12', '½ – ¾'];

/** 带字母的短文本：拉丁、中日韩、西里尔、阿拉伯、带变音的拉丁 */
const WITH_LETTERS = ['Ret', 'DNF', '第 3 位', '日本語', 'Мир', 'سلام', 'Été', '3rd', '한국어'];

const cell = (text: string) => {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
};

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  document.body.innerHTML = '';
});

describe('没有字母的元素不算翻译单元（#1002）', () => {
  test('数字加连接号、纯符号、计时这类格子被跳过', () => {
    for (const text of NO_LETTERS) expect(shouldSkipNonVisual(cell(text)), text).toBe(true);
  });

  test('带任意语言字母的短文本仍然是单元', () => {
    for (const text of WITH_LETTERS) expect(shouldSkipNonVisual(cell(text)), text).toBe(false);
  });

  test('整页采集：成绩表里只采带字母的格子', () => {
    document.body.innerHTML = `<table><tbody>${[...NO_LETTERS, ...WITH_LETTERS]
      .map((t, i) => `<tr><td id="c${i}">${t}</td></tr>`)
      .join('')}</tbody></table>`;
    restore = mockAllBoundingRects();
    const texts = collect(document.body, () => {}).map((u) => u.textContent);
    expect(texts).toEqual(WITH_LETTERS);
  });

  test('逐段翻译按钮：悬停在没有字母的格子上找不到单元，带字母的格子照常找到（接受的取舍）', () => {
    document.body.innerHTML = '<table><tbody><tr><td id="years">1996–2009</td><td id="dnf">DNF</td></tr></tbody></table>';
    restore = mockAllBoundingRects();
    expect(closestUnit(document.getElementById('years')!)).toBeNull();
    expect(closestUnit(document.getElementById('dnf')!)).toBe(document.getElementById('dnf'));
  });

  test('字母藏在行内元素里也算：只看整段文字有没有字母', () => {
    const td = document.createElement('td');
    td.innerHTML = '1996 <abbr>Ret</abbr>';
    expect(shouldSkipNonVisual(td)).toBe(false);
  });
});
