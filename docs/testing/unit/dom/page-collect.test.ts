/**
 * 一次整页翻译里首轮采集与补采集共用的采集器（#1011）
 *
 * 真实的 collect 与真实的 render：首轮采到的单元有的翻好（落完成标记）、有的
 * 翻失败、有的译文与原文相同被兜底拦下（不落标记）；翻译期间又冒出来几段，其中
 * 一段在补采集之前已经被逐段翻译翻好。补采集只该交出真正新的、没翻过的那几段。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';
import { render } from '~/src/dom/renderer';
import { createPageCollector } from '~/src/dom/page-collect';
import type { SkipCategory } from '~/src/dom/walker';

let restoreRects: () => void;
beforeEach(() => {
  restoreRects = mockAllBoundingRects();
});
afterEach(() => {
  restoreRects();
  document.body.innerHTML = '';
});

const para = (id: string, text: string) => {
  const p = document.createElement('p');
  p.id = id;
  p.textContent = text;
  document.body.appendChild(p);
  return p;
};

describe('补采集只交出新出现、没翻过的单元（#1011）', () => {
  test('首轮翻好的、翻失败的、被兜底拦下的都不再交出；带完成标记的新段落不重翻', () => {
    para('ok', 'This paragraph was translated in the first pass.');
    para('failed', 'This paragraph failed in the first pass and stays original.');
    para('same', 'This paragraph came back identical and was not inserted.');
    const page = createPageCollector((onSkip) => collect(document.body, undefined, { onSkip }));

    const first = page().map((el) => el.id);
    expect(first).toEqual(['ok', 'failed', 'same']);
    render(document.getElementById('ok')!, 'Translated text for the first paragraph.');
    // failed：引擎失败，不渲染；same：译文与原文相同，渲染层不插入、不落标记（#783）
    const same = document.getElementById('same')!;
    expect(render(same, same.textContent!).rendered).toBe(false);
    expect(same.getAttribute('data-pt')).toBeNull();

    // 翻译期间懒加载出来两段；其中一段在补采集之前已经被逐段翻译翻好
    para('lazy', 'This paragraph appeared while the page was being translated.');
    const manual = para('manual', 'This paragraph was translated by hovering over it.');
    render(manual, 'Hover translation of the manual paragraph.', 'para');

    expect(page().map((el) => el.id)).toEqual(['lazy']);
    // 再补一次：没有新的了
    expect(page()).toEqual([]);
  });

  test('跳过的单元只报一次，补采集不让“另有 N 段”翻倍', () => {
    para('long', 'x'.repeat(4000) + ' long words');
    para('ok', 'A normal paragraph.');
    const skips: SkipCategory[] = [];
    const page = createPageCollector(
      (onSkip) => collect(document.body, undefined, { onSkip }),
      (_el, c) => skips.push(c),
    );
    page();
    page();
    expect(skips).toEqual(['too-long']);
  });

  test('每次整页翻译新建一个：还原之后再点，所有单元重新交出', () => {
    para('a', 'First paragraph of the page.');
    const collectOnce = (onSkip: (el: Element, c: SkipCategory) => void) =>
      collect(document.body, undefined, { onSkip });
    expect(createPageCollector(collectOnce)().map((el) => el.id)).toEqual(['a']);
    expect(createPageCollector(collectOnce)().map((el) => el.id)).toEqual(['a']);
  });
});
