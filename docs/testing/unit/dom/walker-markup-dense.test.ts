/**
 * dom/walker.ts — 标记密集的段落不再按序列化 HTML 长度被拒（#731，规格 #724）
 *
 * 维基百科长条目（Parsoid 输出）里，单个引用角标序列化后就有四百多字符，
 * 单个条目链接一百多字符：几百个字的正常段落，outerHTML 轻易超过旧的
 * HTML 上限，被采集整段静默丢掉。送给引擎的是提取出来的文字，文字那一侧
 * 由文字长度上限把着；HTML 长度量的是属性负载，与送翻量、渲染代价无关。
 * 文档站、法规库、学术期刊页是同一类形状，按文档结构判定，不认站点。
 *
 * 只经采集入口 collect() 断言：收到了哪些单元；逐段翻译入口 closestUnit()
 * 与采集共用同一层判定，在某个起点上找到哪个单元（#732）。
 */
import { describe, test, expect } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';

/** 仿 Parsoid 的条目链接：绝对 href、title、id，约 120 字符。 */
const link = (i: number, text: string) =>
  `<a rel="mw:WikiLink" href="https://en.wikipedia.org/wiki/${text.replace(/ /g, '_')}" title="${text}" id="mwAQ${i}">${text}</a>`;

/** 仿 Parsoid 的引用角标：about、typeof、转义过的 data-mw，内部 span 各带 id，四百多字符。 */
const cite = (n: number) =>
  `<sup about="#mwt${n}" class="mw-ref reference" id="cite_ref-Variety_2013_${n}-0" rel="dc:references" typeof="mw:Extension/ref" data-mw="{&quot;name&quot;:&quot;ref&quot;,&quot;attrs&quot;:{&quot;name&quot;:&quot;Variety_2013_${n}&quot;},&quot;body&quot;:{&quot;id&quot;:&quot;mw-reference-text-cite_note-Variety_2013_${n}-${n}&quot;}}"><a href="./L%C3%A9a_Seydoux#cite_note-Variety_2013_${n}-${n}" id="mwBg${n}" style="counter-reset: mw-Ref ${n};"><span class="mw-reflink-text" id="mwBw${n}"><span class="cite-bracket" id="mwCA${n}">[</span>${n}<span class="cite-bracket" id="mwCQ${n}">]</span></span></a></sup>`;

const TOPICS = [
  'Cannes Film Festival', 'Palme d\'Or', 'Abdellatif Kechiche', 'Blue Is the Warmest Colour',
  'Adèle Exarchopoulos', 'Julie Maroh', 'Steven Spielberg', 'French cinema',
  'Christophe Honoré', 'Mission: Impossible', 'Wes Anderson', 'Quentin Tarantino',
  'James Bond', 'Daniel Craig', 'Spectre', 'No Time to Die',
  'David Cronenberg', 'Crimes of the Future', 'Bruno Dumont', 'France',
  'Denis Villeneuve', 'Dune: Part Two', 'Mia Hansen-Løve', 'One Fine Morning',
  'César Award', 'Lumière Award',
];

/** 一段正常的维基正文：26 个条目链接、8 个引用角标，文字九百来字。 */
function wikiParagraph(id: string): string {
  const parts: string[] = [];
  TOPICS.forEach((t, i) => {
    parts.push(`In this period she worked with ${link(i, t)} on several projects`);
    if (i % 3 === 2) parts.push(cite(i));
    parts.push(i === TOPICS.length - 1 ? '.' : ', ');
  });
  return `<p id="${id}">${parts.join('')}</p>`;
}

/** 采集一次：单元的 id（没有 id 的写标签名）与文本。 */
function collectUnits(): { ids: string[]; texts: string[] } {
  const restore = mockAllBoundingRects();
  try {
    const units = collect();
    return {
      ids: units.map((u) => u.id || u.tagName.toLowerCase()),
      texts: units.map((u) => (u.textContent ?? '').trim()),
    };
  } finally {
    restore();
  }
}

describe('标记密集的段落不再按序列化 HTML 长度被拒（#731）', () => {
  test('仿维基的正文段落：文字几百字、序列化后数千字符 → 整段作为一个单元被采集', () => {
    document.body.innerHTML = wikiParagraph('dense');
    const p = document.getElementById('dense')!;
    expect(p.textContent!.trim().length).toBeLessThan(3072);
    expect(p.outerHTML.length).toBeGreaterThan(4096);

    const { ids, texts } = collectUnits();
    expect(ids).toEqual(['dense']);
    expect(texts[0]).toBe(p.textContent!.trim());
  });

  test('文字真正超过长度上限的段落仍然被跳过', () => {
    const sentence = 'She later starred in a string of critically acclaimed films. ';
    document.body.innerHTML =
      `<p id="long">${sentence.repeat(60)}</p>` + `<p id="short">${sentence}</p>`;
    expect(document.getElementById('long')!.textContent!.trim().length).toBeGreaterThan(3072);

    expect(collectUnits().ids).toEqual(['short']);
  });

  test('正常长度、正常标记的页面：采集到的单元与原来一样', () => {
    document.body.innerHTML = `
      <h1 id="h1">Léa Seydoux</h1>
      <p id="p1">Léa Hélène Seydoux-Fornier de Clausonne is a French actress.</p>
      <p id="p2">She is the recipient of <a href="/wiki/Award">several accolades</a>, including a <a href="/wiki/Palme">Palme d'Or</a>.</p>
      <ul><li id="li1">Blue Is the Warmest Colour (2013)</li><li id="li2">The French Dispatch (2021)</li></ul>
      <blockquote id="q">Acting is a way of living out one's insanity.</blockquote>
      <p id="num">2013</p>`;

    expect(collectUnits().ids).toEqual(['h1', 'p1', 'p2', 'li1', 'li2', 'q']);
  });
});

describe('逐段翻译入口在标记密集的段落上找得到单元（#732）', () => {
  /** 从某个起点找翻译单元，返回单元的 id（找不到为 null）。 */
  function unitFrom(start: Element): string | null {
    const restore = mockAllBoundingRects();
    try {
      return closestUnit(start)?.id ?? null;
    } finally {
      restore();
    }
  }

  test('起点落在条目链接、引用角标、段落文字上 → 都找到这个段落', () => {
    document.body.innerHTML = wikiParagraph('dense');
    const p = document.getElementById('dense')!;
    expect(p.outerHTML.length).toBeGreaterThan(4096);

    expect(unitFrom(p.querySelector('a[rel="mw:WikiLink"]')!)).toBe('dense');
    expect(unitFrom(p.querySelector('sup.reference .cite-bracket')!)).toBe('dense');
    expect(unitFrom(p)).toBe('dense');
  });

  test('文字真正超长的段落上找不到单元', () => {
    const sentence = 'She later starred in a string of critically acclaimed films. ';
    document.body.innerHTML = `<div id="wrap"><p id="long">${sentence.repeat(60)}<b id="b">bold</b></p></div>`;

    expect(unitFrom(document.getElementById('b')!)).toBeNull();
    expect(unitFrom(document.getElementById('long')!)).toBeNull();
  });
});
