/**
 * 以 br 分行的超长段落：行内的链接与强调随所在行移入切块，节点原样保留
 * （#711，规格 #694）
 *
 * 切块是搬移节点而不是重建 HTML（#705、#708）：链接、加粗、斜体跟着它所在的
 * 那一行进切块，移动的是原节点 —— 属性、事件监听都还在，用户点链接、复制
 * 文字和切分前一样。只按段落直接子节点里的 br 切：嵌在行内元素里的 br 不拆，
 * 那一行包含整个行内元素。还原之后逐字节回原样，节点仍是原来那几个。
 *
 * 本票钉住现状（实现于 #706），变异检查见 PR。经采集入口、整页翻译的编排
 * 入口（真实渲染器）与还原断言（br-split-harness）。
 */
import { describe, test, expect, afterEach } from 'vitest';
import { brLines, collectUnits, isOverLimit, line, restorePage, translatePage } from './br-split-harness';

afterEach(() => {
  document.body.innerHTML = '';
});

const N = 60;

/** 每三行有一行带链接（链接里套着斜体）与加粗，其余是普通对话。 */
const rich = (i: number) =>
  i % 3 === 0
    ? `Line ${i}: she said <a href="/u/${i}" class="user-link" data-id="${i}" title="profile ${i}">the <em>other</em> name</a> and <strong>left</strong> quietly, <b>very</b> <i>quietly</i>.`
    : line(i);

/** 最后一行里有一个内部带 br 的链接：嵌在行内元素里的 br。 */
const TAIL = 'Finally she wrote <a id="multi" href="/m">a link that<br>spans two visual lines</a> before leaving.';

function setup(): { post: HTMLElement; links: HTMLAnchorElement[]; clicks: Map<HTMLAnchorElement, number> } {
  document.body.innerHTML = `<p id="post">${brLines(N, '<br>\n', rich)}<br>\n${TAIL}</p>`;
  const post = document.getElementById('post')!;
  expect(isOverLimit(post)).toBe(true);
  const links = [...post.querySelectorAll('a')];
  const clicks = new Map<HTMLAnchorElement, number>();
  for (const a of links) {
    clicks.set(a, 0);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      clicks.set(a, clicks.get(a)! + 1);
    });
  }
  return { post, links, clicks };
}

/** 页面上现在的所有链接（按文档顺序）。 */
const currentLinks = () => [...document.querySelectorAll('#post a')];

describe('行内元素随所在行移入切块（#711）', () => {
  test('每个链接、加粗、斜体都在它那一行的切块里，切块数等于行数', () => {
    const { post, links } = setup();
    collectUnits();
    const chunks = [...post.querySelectorAll(':scope > .pt-chunk')];
    expect(chunks).toHaveLength(N + 1);
    // 第 i 行（i 是 3 的倍数）的切块里正好有它的链接、加粗与斜体
    for (let i = 0; i < N; i += 3) {
      const chunk = chunks[i]!;
      expect(chunk.textContent!.trim()).toBe(rich(i).replace(/<[^>]+>/g, ''));
      expect(chunk.querySelector(':scope > a.user-link')!.getAttribute('data-id')).toBe(String(i));
      expect(chunk.querySelector(':scope > a > em')!.textContent).toBe('other');
      expect(chunk.querySelector(':scope > strong')!.textContent).toBe('left');
      expect(chunk.querySelectorAll(':scope > b, :scope > i')).toHaveLength(2);
    }
    // 行内元素不跨切块，也没有一个落在切块之外
    expect(post.querySelectorAll(':scope > a, :scope > em, :scope > strong, :scope > b, :scope > i')).toHaveLength(0);
    expect(currentLinks()).toHaveLength(links.length);
  });

  test('移动的是原节点：切分前后是同一批链接对象，属性一个不少', () => {
    const { links } = setup();
    const attrs = links.map((a) => [...a.attributes].map((x) => `${x.name}=${x.value}`).join(' '));
    collectUnits();
    const after = currentLinks();
    expect(after).toHaveLength(links.length);
    after.forEach((a, i) => expect(a).toBe(links[i]));
    expect(after.map((a) => [...a.attributes].map((x) => `${x.name}=${x.value}`).join(' '))).toEqual(attrs);
  });

  test('嵌在链接里的 br 不拆：那一行是一个切块，包含整个链接，链接里的 br 仍在链接里', () => {
    const { post } = setup();
    collectUnits();
    const multi = document.getElementById('multi')!;
    const chunk = multi.parentElement!;
    expect(chunk.classList.contains('pt-chunk')).toBe(true);
    expect(chunk.parentElement).toBe(post);
    expect(chunk.textContent!.trim()).toBe('Finally she wrote a link thatspans two visual lines before leaving.');
    expect(multi.querySelectorAll('br')).toHaveLength(1);
    expect(multi.innerHTML).toBe('a link that<br>spans two visual lines');
  });

  test('翻译之后：链接仍是原来那个节点，在原文那一层里，点下去仍触发原来的监听', async () => {
    const { links, clicks } = setup();
    await translatePage();
    expect(document.querySelectorAll('#post .pt-chunk[data-pt="done"]')).toHaveLength(N + 1);
    const after = currentLinks().filter((a) => a.closest('.pt-origin'));
    expect(after).toHaveLength(links.length);
    after.forEach((a, i) => expect(a).toBe(links[i]));
    for (const a of after) (a as HTMLAnchorElement).click();
    expect([...clicks.values()].every((n) => n === 1)).toBe(true);
  });
});

describe('还原之后逐字节回到原样（#711）', () => {
  test('翻译加还原：段落 HTML 与翻译前一字不差，链接仍是原节点、监听仍在', async () => {
    const { links, clicks } = setup();
    const before = document.body.innerHTML;
    await translatePage();
    restorePage();
    expect(document.body.innerHTML).toBe(before);
    const after = currentLinks();
    after.forEach((a, i) => expect(a).toBe(links[i]));
    for (const a of after) (a as HTMLAnchorElement).click();
    expect([...clicks.values()].every((n) => n === 1)).toBe(true);
  });

  test('还原之后再翻再还原：仍一字不差，仍是同一批节点', async () => {
    const { links } = setup();
    const before = document.body.innerHTML;
    await translatePage();
    restorePage();
    await translatePage();
    restorePage();
    expect(document.body.innerHTML).toBe(before);
    currentLinks().forEach((a, i) => expect(a).toBe(links[i]));
  });
});
