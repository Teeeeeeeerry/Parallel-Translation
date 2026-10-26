/**
 * 整段一个单元的 br 段落：送翻时 br 作为换行带出去，渲染译文时换行还原成 br（#840）
 *
 * 短而按行排的段落（诗歌、歌词、地址、签名档）与 #768 之后不再按行切的
 * “文字不长、只是链接多”的 br 段落，都是整段一个翻译单元。以前 br 在送翻
 * 时变成空格，译文挤成一整块。
 *
 * 经采集入口 collect() 取单元，经 unitTextEx() 取送翻文字，经 render()
 * 渲染：断言单元个数、送翻文字在哪里换行、译文在哪里换行。
 */
import { describe, test, expect } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { unitTextEx } from '~/src/dom/text';
import { render, unrender } from '~/src/dom/renderer';
import { readRulesSnapshot } from '~/src/dom/rules-snapshot';

const POEM = ['Roses are red,', 'violets are blue,', 'sugar is sweet,', 'and so are you.'];

/** #768 那种段落：30 行，每行两个长链接，文字不长、HTML 超过旧的 4096 上限。 */
const threadLine = (i: number) =>
  `Thread ${i}: see <a href="/r/forum/comments/${String(i).padStart(4, '0')}/a-rather-long-thread-slug-used-for-testing-links">post ${i}</a> and <a href="/user/someone-with-a-long-name-${i}">user</a>`;
const threadText = (i: number) => `Thread ${i}: see post ${i} and user`;

function units(): Element[] {
  const restore = mockAllBoundingRects();
  try {
    return collect();
  } finally {
    restore();
  }
}

function textOf(el: Element): string {
  const restore = mockAllBoundingRects();
  try {
    return unitTextEx(el, readRulesSnapshot()).text;
  } finally {
    restore();
  }
}

/** 译文区里的各行文字（按 br 分开）与 br 个数。 */
function translatedLines(el: Element): { lines: string[]; brs: number } {
  const trans = el.querySelector(':scope > .pt-trans')!;
  const lines: string[] = [''];
  for (const node of trans.childNodes) {
    if (node.nodeName === 'BR') lines.push('');
    else lines[lines.length - 1] += node.textContent ?? '';
  }
  return { lines, brs: trans.querySelectorAll('br').length };
}

describe('4 行短诗：整段一个单元，送翻文字按 br 换行（#840）', () => {
  test('采集得到 1 个单元，送翻文字是 4 行', () => {
    document.body.innerHTML = `<p id="poem">${POEM.join('<br>\n')}</p>`;
    const found = units();

    expect(found).toHaveLength(1);
    expect(textOf(found[0]!)).toBe(POEM.join('\n'));
  });

  test('源码里的换行与缩进不算行：只有 br 换行', () => {
    document.body.innerHTML = `<p id="poem">
      ${POEM[0]}<br>
      ${POEM[1]}
      continues here<br>${POEM[2]}<br>

      ${POEM[3]}
    </p>`;

    expect(textOf(units()[0]!)).toBe(
      [POEM[0], `${POEM[1]} continues here`, POEM[2], POEM[3]].join('\n'),
    );
  });

  test('连着两个 br（段间空行）留一个空行；开头、结尾的 br 不留空行', () => {
    document.body.innerHTML = `<p><br>${POEM[0]}<br>${POEM[1]}<br><br><br>${POEM[2]}<br></p>`;

    expect(textOf(units()[0]!)).toBe(`${POEM[0]}\n${POEM[1]}\n\n${POEM[2]}`);
  });

  test('br 在行内元素里也算换行', () => {
    document.body.innerHTML = `<p><em>${POEM[0]}<br>${POEM[1]}</em><br>${POEM[2]}</p>`;

    expect(textOf(units()[0]!)).toBe(POEM.slice(0, 3).join('\n'));
  });

  test('译文按换行渲染成 br，每行在同样的位置；还原后逐字节回到原样', () => {
    document.body.innerHTML = `<p id="poem">${POEM.join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const unit = units()[0]!;
    const sent = textOf(unit);

    render(unit, sent.split('\n').map((l) => `【译】${l}`).join('\n'), 'page', sent);

    expect(translatedLines(unit)).toEqual({ lines: POEM.map((l) => `【译】${l}`), brs: 3 });
    // 原文原样留在 .pt-origin 里
    expect(unit.querySelector('.pt-origin')!.querySelectorAll('br')).toHaveLength(3);
    unrender(unit);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('#768 那种链接多的 30 行 br 段落：整段一个单元，译文逐行（#840）', () => {
  test('采集得到 1 个单元，送翻文字是 30 行，链接文字在各自那一行', () => {
    const html = Array.from({ length: 30 }, (_, i) => threadLine(i)).join('<br>\n');
    document.body.innerHTML = `<p id="threads">${html}</p>`;
    expect(document.getElementById('threads')!.outerHTML.length).toBeGreaterThan(4096);
    const found = units();

    expect(found).toHaveLength(1);
    expect(textOf(found[0]!).split('\n')).toEqual(Array.from({ length: 30 }, (_, i) => threadText(i)));
  });

  test('译文 30 行，29 个 br', () => {
    const html = Array.from({ length: 30 }, (_, i) => threadLine(i)).join('<br>\n');
    document.body.innerHTML = `<p id="threads">${html}</p>`;
    const unit = units()[0]!;
    const sent = textOf(unit);

    render(unit, sent.split('\n').map((l) => `【译】${l}`).join('\n'), 'page', sent);

    const { lines, brs } = translatedLines(unit);
    expect(brs).toBe(29);
    expect(lines).toEqual(Array.from({ length: 30 }, (_, i) => `【译】${threadText(i)}`));
  });
});

describe('没有 br 的段落与 pre 不受影响（#840）', () => {
  test('没有 br：源码换行照旧折叠成空格，送翻文字与改动前相同（缓存 key 不变）', () => {
    document.body.innerHTML = `<p>atomic
      replacement of the   whole file</p>`;

    expect(textOf(units()[0]!)).toBe('atomic replacement of the whole file');
  });

  test('译文里没有换行：照旧是一段文字，不插 br', () => {
    document.body.innerHTML = `<p>${POEM.join('<br>')}</p>`;
    const unit = units()[0]!;

    render(unit, '玫瑰是红的，紫罗兰是蓝的', 'page', textOf(unit));

    expect(translatedLines(unit)).toEqual({ lines: ['玫瑰是红的，紫罗兰是蓝的'], brs: 0 });
  });

  test('pre 里的单元照旧保留硬换行与缩进，译文不插 br（靠样式换行）', () => {
    document.body.innerHTML = `<pre>first line\n  indented   line\nlast</pre>`;
    const unit = units()[0]!;
    const sent = textOf(unit);

    expect(sent).toBe('first line\n  indented line\nlast');
    render(unit, '一\n二', 'page', sent);
    expect(unit.querySelector('.pt-trans')!.querySelectorAll('br')).toHaveLength(0);
    expect(unit.querySelector('.pt-trans')!.textContent).toBe('一\n二');
  });

  test('含块级子段落的单元走浅层提取，br 同样换行', () => {
    document.body.innerHTML = `<li>${POEM[0]}<br>${POEM[1]}<ul><li>child item text</li></ul></li>`;
    const unit = units().find((u) => u.tagName === 'LI' && u.querySelector('ul'))!;

    expect(textOf(unit)).toBe(`${POEM[0]}\n${POEM[1]}`);
  });
});
