/**
 * dom/walker.ts — 以 br 分行的超长段落按行切块（#706，规格 #694）
 *
 * 作者用换行而不是空行分段的长帖（论坛、邮件存档、歌词与诗歌页、聊天
 * 记录导出页，#694 的 Reddit 长帖）：整篇正文是一个段落，行与行之间只隔
 * 一个 br，总长超过长度上限，采集时被整段静默丢掉。超长的这类段落在采集
 * 遍历里按 br 切成逐行的切块，每行一个翻译单元；长度没超上限的段落行为
 * 不变。
 *
 * 只经采集入口 collect() 断言：收到了哪些单元、DOM 有没有被动过。
 */
import { describe, test, expect } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';

/** 对话体的一行，约 70 字符。 */
const line = (i: number) => `Line ${i}: "I never thought we would meet again," she said quietly.`;

/** 以 br 分行的段落内容：n 行，行与行之间一个 br（与源码里常见的换行一起）。 */
function brLines(n: number, render: (i: number) => string = line): string {
  return Array.from({ length: n }, (_, i) => render(i)).join('<br>\n');
}

/** 采集一次：单元文本与单元标签。 */
function collectUnits(): { texts: string[]; tags: string[] } {
  const restore = mockAllBoundingRects();
  try {
    const units = collect();
    return {
      texts: units.map((u) => (u.textContent ?? '').trim()),
      tags: units.map((u) => u.tagName.toLowerCase() + (u.classList.contains('pt-chunk') ? '.pt-chunk' : '')),
    };
  } finally {
    restore();
  }
}

describe('超长段落按 br 切成逐行切块（#706）', () => {
  test('以 br 分行、文本超过上限的段落 → 每行一个切块单元，按原顺序', () => {
    document.body.innerHTML = `<p id="post">${brLines(60)}</p>`;
    expect(document.getElementById('post')!.textContent!.length).toBeGreaterThan(3072);

    const { texts, tags } = collectUnits();
    expect(texts).toEqual(Array.from({ length: 60 }, (_, i) => line(i)));
    expect(tags.every((t) => t === 'span.pt-chunk')).toBe(true);
    // 切块是段落的直接子元素，br 留在切块之外
    const p = document.getElementById('post')!;
    expect(p.querySelectorAll(':scope > span.pt-chunk').length).toBe(60);
    expect(p.querySelectorAll(':scope > br').length).toBe(59);
    expect(p.querySelector('.pt-chunk br')).toBeNull();
  });

  test('同样以 br 分行但总长没超上限 → 整段一个单元，DOM 不动（行为不变）', () => {
    document.body.innerHTML = `<p id="post">${brLines(10)}</p>`;
    const before = document.body.innerHTML;

    const { texts, tags } = collectUnits();
    expect(tags).toEqual(['p']);
    expect(texts).toHaveLength(1);
    expect(document.body.innerHTML).toBe(before);
  });

  test('文本不长、但 HTML 超过上限（满是行内链接）→ 同样按行切', () => {
    const linked = (i: number) =>
      `Thread ${i}: see <a href="https://forum.example.com/thread/${i}?ref=archive&amp;page=1">post ${i}</a> and <a href="https://forum.example.com/u/${i}">user</a>`;
    document.body.innerHTML = `<div id="archive">${brLines(30, linked)}</div>`;
    const el = document.getElementById('archive')!;
    expect(el.textContent!.trim().length).toBeLessThanOrEqual(3072);
    expect(el.outerHTML.length).toBeGreaterThan(4096);

    const { texts, tags } = collectUnits();
    expect(texts).toHaveLength(30);
    expect(texts[0]).toBe('Thread 0: see post 0 and user');
    expect(tags.every((t) => t === 'span.pt-chunk')).toBe(true);
  });

  test('div、li、blockquote、td 这些段落型元素同样按行切', () => {
    document.body.innerHTML =
      `<div id="d">${brLines(60)}</div>` +
      `<ul><li id="li">${brLines(60)}</li></ul>` +
      `<blockquote id="bq">${brLines(60)}</blockquote>` +
      `<table><tbody><tr><td id="td">${brLines(60)}</td></tr></tbody></table>`;

    const { texts } = collectUnits();
    expect(texts).toHaveLength(240);
    for (const id of ['d', 'li', 'bq', 'td']) {
      expect(document.getElementById(id)!.querySelectorAll(':scope > .pt-chunk')).toHaveLength(60);
    }
  });

  test('幂等：连续两次采集结果一致，不重复切分', () => {
    document.body.innerHTML = `<p id="post">${brLines(60)}</p>`;
    const first = collectUnits();
    const html = document.body.innerHTML;
    const second = collectUnits();
    expect(second).toEqual(first);
    expect(document.body.innerHTML).toBe(html);
    expect(document.querySelectorAll('.pt-chunk .pt-chunk')).toHaveLength(0);
  });
});

describe('拒切：与切分同时生效（#706）', () => {
  /** 断言 DOM 一个字节都没动、也没有切块单元。 */
  function expectUntouched(): void {
    const before = document.body.innerHTML;
    const { tags } = collectUnits();
    expect(tags.filter((t) => t.endsWith('.pt-chunk'))).toEqual([]);
    expect(document.body.innerHTML).toBe(before);
  }

  test('含块级子元素的超长段落不切', () => {
    document.body.innerHTML = `<div id="post">${brLines(60)}<blockquote>quoted reply text</blockquote></div>`;
    expectUntouched();
  });

  test('代码块上下文不切：高亮容器、notranslate 祖先、notranslate 自身', () => {
    document.body.innerHTML =
      `<div class="highlight"><div>${brLines(60)}</div></div>` +
      `<div class="notranslate"><p>${brLines(60)}</p></div>` +
      `<p class="notranslate">${brLines(60)}</p>`;
    expectUntouched();
  });

  test('含代码语义子元素的超长段落不切', () => {
    document.body.innerHTML =
      `<p>${brLines(60)}<br><code>const x = 1;</code></p>` +
      `<div>${brLines(60)}<br><kbd>Ctrl</kbd></div>`;
    expectUntouched();
  });

  test('已翻译的段落与原文容器内的段落不切', () => {
    document.body.innerHTML =
      `<p data-pt="done">${brLines(60)}</p>` +
      `<div data-pt="done"><div class="pt-origin"><p>${brLines(60)}</p></div></div>`;
    expectUntouched();
  });

  test('编辑区里的超长段落不切 —— 不动编辑器的 DOM', () => {
    document.body.innerHTML = `<div contenteditable="true"><p>${brLines(60)}</p></div>`;
    expectUntouched();
  });

  test('只切段落型元素：其他标签（address、span）不碰', () => {
    document.body.innerHTML =
      `<address>${brLines(60)}</address>` + `<div><span>${brLines(60)}</span><b>x</b></div>`;
    expectUntouched();
  });

  test('没有 br 的超长段落不切（行为与现在一致：不翻）', () => {
    document.body.innerHTML = `<p>${Array.from({ length: 60 }, (_, i) => line(i)).join(' ')}</p>`;
    expectUntouched();
  });

  test('pre 仍走原有的 pre 切块（按空行成块），不被按行切接管', () => {
    const para = (i: number) =>
      `Paragraph ${i} first line of the block<br>second line of the same block, long enough to matter.`;
    const blocks = Array.from({ length: 40 }, (_, i) => para(i)).join('\n\n');
    document.body.innerHTML = `<div class="plain"><pre id="doc">${blocks}</pre></div>`;
    expect(document.getElementById('doc')!.textContent!.length).toBeGreaterThan(3072);

    const { texts } = collectUnits();
    // 按空行成 40 块，每块里两行（br 在块内），而不是 80 行
    expect(texts).toHaveLength(40);
    expect(document.querySelectorAll('#doc > .pt-chunk br')).toHaveLength(40);
  });
});
