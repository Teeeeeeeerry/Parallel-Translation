/**
 * dom/classify.ts — 跳过判定不再序列化整棵子树（#737，规格 #724）
 *
 * #731 之前，跳过判定对每个候选元素取一次 outerHTML，等于把整棵子树序列化
 * 一遍；整页采集对每个段落与容器各做一次，逐段翻译的悬停精判每停一次做
 * 一次。#731 改为只看文字长度、#733 改为数元素个数之后，这两条路径上不应
 * 再有任何序列化。
 *
 * 断言量级而不是毫秒数：在一张段落多、标记重的页面上，整页采集一次、在每
 * 一段上做一次悬停精判，序列化子树的次数都是 0，与段落多少、标记多重无关。
 * 计时断言在这里分不出新旧：jsdom 与 Chromium 里序列化本身都很便宜（实测
 * 数据见 #737 的 PR），写死或相对的毫秒数只会变成偶发。
 *
 * 切入点是采集入口 collect() 与逐段翻译入口 closestUnit()（#724 定下的两条缝）。
 * 页面用 #735 的维基形态夹具，复制十份。
 */
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'fs';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';

/** 维基形态夹具的正文（#735），复制 copies 份放进 body。 */
function loadWikiArticle(copies: number): void {
  const html = fs.readFileSync('docs/testing/e2e/fixtures/wiki-article.html', 'utf-8');
  const start = html.indexOf('<div class="mw-content-ltr mw-parser-output"');
  const end = html.lastIndexOf('</body>');
  const article = html.slice(start, end);
  document.body.innerHTML = Array.from({ length: copies }, () => article).join('');
}

/**
 * 统计 fn 执行期间序列化子树的次数：outerHTML、innerHTML 的读取与
 * XMLSerializer。只记读取，不拦截，fn 的行为不变。
 */
function countSerializations(fn: () => void): number {
  let count = 0;
  const restores: Array<() => void> = [];
  for (const name of ['outerHTML', 'innerHTML'] as const) {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, name)!;
    Object.defineProperty(Element.prototype, name, {
      ...desc,
      get(this: Element) {
        count++;
        return desc.get!.call(this);
      },
    });
    restores.push(() => Object.defineProperty(Element.prototype, name, desc));
  }
  const serialize = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (this: XMLSerializer, node: Node) {
    count++;
    return serialize.call(this, node);
  };
  restores.push(() => {
    XMLSerializer.prototype.serializeToString = serialize;
  });
  try {
    fn();
  } finally {
    for (const restore of restores) restore();
  }
  return count;
}

describe('跳过判定不再序列化整棵子树（#737）', () => {
  let restoreRects: (() => void) | undefined;
  afterEach(() => restoreRects?.());

  test('段落多、标记重的页面：整页采集一次，序列化次数是 0', () => {
    loadWikiArticle(10);
    restoreRects = mockAllBoundingRects();
    const dense = document.querySelectorAll('p[id^="dense-"]');
    // 前提：标记密集的段落有三十段，每段序列化后都远超旧的 HTML 上限
    expect(dense.length).toBe(30);
    for (const p of dense) expect(p.outerHTML.length).toBeGreaterThan(4096);

    let units = 0;
    const serializations = countSerializations(() => {
      units = collect().length;
    });
    // 采集照常进行：标记密集的段落都在里面
    expect(units).toBeGreaterThanOrEqual(70);
    expect(serializations).toBe(0);
  });

  test('逐段翻译的悬停精判：在每一段的条目链接、引用角标、段落本身上各判一次，序列化次数是 0', () => {
    loadWikiArticle(10);
    restoreRects = mockAllBoundingRects();
    const paragraphs = [...document.querySelectorAll('.mw-parser-output p')];
    expect(paragraphs.length).toBe(70);
    const starts = paragraphs.flatMap((p) =>
      [p.querySelector('a[rel="mw:WikiLink"]'), p.querySelector('sup.reference .cite-bracket'), p].filter(
        (el): el is Element => el !== null,
      ),
    );

    const found: Array<Element | null> = [];
    const serializations = countSerializations(() => {
      for (const start of starts) found.push(closestUnit(start));
    });
    // 精判照常进行：标记密集的段落上找得到单元，文字真正超长的段落上找不到
    expect(found.filter((el) => el?.id.startsWith('dense-')).length).toBeGreaterThanOrEqual(30 * 3);
    expect(found.some((el) => el?.id === 'long')).toBe(false);
    expect(serializations).toBe(0);
  });
});
