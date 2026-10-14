/**
 * 以 br 分行的超长段落：空行原样保留、不单独送翻（#709，规格 #694）
 *
 * 作者用连续的 br 隔开段落时，中间的空行不是一行文字：送去翻只会换回一个
 * 空字符串或一个空格，还白占一次请求的位置。空行要原样留在页面上（行间距
 * 不变），不成为切块、不送翻；还原之后空行的数量与位置逐字节回到原样。
 *
 * “空行”指两个 br 之间看不见任何文字：只有空白（含 &nbsp;）、零宽字符，或
 * 只有不带文字的行内元素。
 *
 * 经采集入口 collect、整页翻译的编排入口与还原断言（br-split-harness）。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { brLines, collectUnits, isOverLimit, line, restorePage, translatePage } from './br-split-harness';

afterEach(() => {
  document.body.innerHTML = '';
});

const N = 60;
const LINES = Array.from({ length: N }, (_, i) => line(i));

/** 空行的几种写法：两个 br 之间放这些。 */
const BLANKS: Record<string, string> = {
  '紧挨着的两个 br': '',
  '只有换行与缩进': '\n  ',
  '&nbsp;': '&nbsp;',
  '零宽空格': '​',
  '零宽连接符与 BOM': '‍﻿',
  '空的行内元素': '<span></span>',
  '只含空白的行内元素': '<b> </b>',
};

/** 每两行文字之间夹一个空行。 */
const withBlanks = (blank: string) => `<p id="post">${brLines(N, `<br>${blank}<br>\n`)}</p>`;

describe('空行不成切块、不送翻（#709）', () => {
  test('纯符号分隔行复用 pre 的装饰行判定：不包切块，采集结果不变', () => {
    const separators = Array.from({ length: N - 1 }, (_, i) => (i % 2 ? '---' : '***'));
    document.body.innerHTML = `<p id="post">${LINES.flatMap((text, i) => [text, i < N - 1 ? `<br>${separators[i]}<br>` : '']).join('')}</p>`;
    const post = document.getElementById('post')!;
    const before = document.body.innerHTML;

    const { texts } = collectUnits();
    expect(texts.map((text) => text.trim())).toEqual(LINES);
    expect(post.querySelectorAll(':scope > .pt-chunk')).toHaveLength(N);
    expect(post.querySelectorAll(':scope > br')).toHaveLength(2 * (N - 1));

    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });

  test.each(Object.entries(BLANKS))('%s：只有带文字的行成为切块，空行留作裸内容', (_name, blank) => {
    document.body.innerHTML = withBlanks(blank);
    const post = document.getElementById('post')!;
    expect(isOverLimit(post)).toBe(true);

    const { texts } = collectUnits();
    expect(texts.map((t) => t.trim())).toEqual(LINES);
    // 切块数就是文字行数：空行没有被包成切块
    expect(post.querySelectorAll(':scope > .pt-chunk')).toHaveLength(N);
    // 空行两侧的 br 一个不少，都留在切块之外
    expect(post.querySelectorAll(':scope > br')).toHaveLength(2 * (N - 1));
    expect(post.querySelector('.pt-chunk br')).toBeNull();
  });

  test('段首段尾的连续 br 同样原样留下，还原之后一个不少', async () => {
    document.body.innerHTML = `<p id="post"><br><br>\n${brLines(N, '<br>')}<br><br></p>`;
    const before = document.body.innerHTML;
    const post = document.getElementById('post')!;
    const { texts } = collectUnits();
    expect(texts.map((t) => t.trim())).toEqual(LINES);
    expect(post.querySelectorAll(':scope > .pt-chunk')).toHaveLength(N);
    expect(post.querySelectorAll(':scope > br')).toHaveLength(N - 1 + 4);

    await translatePage();
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });

  test('送翻的条目里没有空行：条目数等于文字行数，没有一条是空白', async () => {
    document.body.innerHTML = withBlanks('​');
    const { requests } = await translatePage();
    const sent = requests.flat();
    expect(sent).toHaveLength(N);
    expect(sent.filter((t) => t.replace(/[\s​-‍﻿]/g, '') === '')).toEqual([]);
  });

  test('翻译之后空行仍在原位：每两行译文之间仍隔着同样的空行', async () => {
    document.body.innerHTML = withBlanks('\n  ');
    await translatePage();
    const post = document.getElementById('post')!;
    // 段落的直接子节点里，切块与 br、空白文本按原顺序排列：切块、br、空行、br、切块……
    const shape = [...post.childNodes]
      .map((n) =>
        n.nodeType === Node.TEXT_NODE
          ? (n.textContent!.trim() ? 'text' : '_')
          : (n as Element).tagName === 'BR'
            ? 'br'
            : (n as Element).getAttribute('data-pt') === 'done'
              ? 'chunk'
              : '?',
      )
      .filter((k) => k !== '_')
      .join(' ');
    expect(shape).toBe(Array.from({ length: N }, () => 'chunk').join(' br br '));
  });
});

describe('还原之后逐字节回到原样（#709）', () => {
  test.each(Object.entries(BLANKS))('%s：翻译加还原，段落的 HTML 与翻译前一字不差', async (_name, blank) => {
    document.body.innerHTML = withBlanks(blank);
    const before = document.body.innerHTML;
    await translatePage();
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(N);

    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });

  test('还原之后再翻一次：切法与送翻条目与第一次相同，再还原仍一字不差', async () => {
    document.body.innerHTML = withBlanks('​');
    const before = document.body.innerHTML;
    const first = (await translatePage()).requests.flat();
    restorePage();
    const second = (await translatePage()).requests.flat();
    expect(second).toEqual(first);
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
