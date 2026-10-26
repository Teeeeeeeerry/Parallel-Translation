/**
 * 以 br 分行的超长段落：仅译文模式下逐行只显示译文（#713，规格 #694）
 *
 * 三种显示模式共用同一套 DOM 结构，模式差异全部由 html 上的类名加 CSS 表达，
 * 切换时零 DOM 操作（renderer.ts 的 applyMode）。行切块（#707）沿用这套结构：
 * 仅译文模式下每行的原文隐藏、只留译文；切回对照模式恢复逐行对照；两种模式
 * 之间来回切，段落里一个节点、一个属性都不变；还原后原文完整回来。
 *
 * 本票钉住现状（行切块的模式行为实现于 #707），变异检查见 PR。
 *
 * 经渲染器与 applyMode 断言：页面里装上扩展真实的 presets.css，看每行原文与
 * 译文的计算样式 display；排版（每行译文各占一行、不多空行）由端到端
 * TC-E2E-189 在真实浏览器里量。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMode, render } from '~/src/dom/renderer';
import { closestUnit } from '~/src/dom/units';
import { unitTextEx } from '~/src/dom/text';
import { mockAllBoundingRects } from '../../setup';
import { brLines, collectUnits, fakeTranslate, isOverLimit, line, restorePage, translatePage } from './br-split-harness';
import { readRulesSnapshot } from '~/src/dom/rules-snapshot';

const N = 60;

/** 扩展真实的模式与样式表（vitest 不处理 CSS 导入，直接读文件）。 */
const presetsCss = readFileSync(resolve('src/styles/presets.css'), 'utf-8');

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = presetsCss;
  document.head.appendChild(style);
});
afterEach(() => {
  style.remove();
  applyMode('bilingual', 'follow');
  document.body.innerHTML = '';
});

/**
 * 每个切块的原文与译文此刻显示成什么：none 是隐藏；其余照计算样式的 display
 * （jsdom 不给 span 报默认的 inline，没有样式表规则命中时是空串，记作 inline）。
 */
function displays(): { origin: string; trans: string }[] {
  const shown = (el: Element) => getComputedStyle(el).display || 'inline';
  return [...document.querySelectorAll('#post > .pt-chunk[data-pt="done"]')].map((c) => ({
    origin: shown(c.querySelector(':scope > .pt-origin')!),
    trans: shown(c.querySelector(':scope > .pt-trans')!),
  }));
}

/** 整页翻译好的超长段落。 */
async function translated(): Promise<string> {
  document.body.innerHTML = `<p id="post">${brLines(N)}</p>`;
  expect(isOverLimit(document.getElementById('post')!)).toBe(true);
  const before = document.body.innerHTML;
  await translatePage();
  expect(document.querySelectorAll('#post > .pt-chunk[data-pt="done"]')).toHaveLength(N);
  return before;
}

describe('仅译文模式下逐行只显示译文（#713）', () => {
  test('夹具自检：样式表真的装上了', () => {
    expect(presetsCss).toContain('.pt-only-trans-page');
  });

  test('对照模式：每行原文与译文都显示，译文是行内的（行级对照，#707）', async () => {
    await translated();
    applyMode('bilingual', 'follow');
    expect(displays()).toEqual(Array.from({ length: N }, () => ({ origin: 'inline', trans: 'inline' })));
  });

  test('仅译文模式：每行原文隐藏，译文照常显示', async () => {
    await translated();
    applyMode('translation-only', 'follow');
    expect(displays()).toEqual(Array.from({ length: N }, () => ({ origin: 'none', trans: 'inline' })));
  });

  test('切回对照模式：每行原文回来，恢复逐行对照', async () => {
    await translated();
    applyMode('translation-only', 'follow');
    applyMode('bilingual', 'follow');
    expect(displays().every((d) => d.origin === 'inline' && d.trans === 'inline')).toBe(true);
  });

  test('两种模式来回切：段落里一个节点、属性、文字都不变（零 DOM 操作）', async () => {
    await translated();
    const post = document.getElementById('post')!;
    const html = post.outerHTML;
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const mode of ['translation-only', 'bilingual', 'translation-only', 'bilingual'] as const) {
      applyMode(mode, 'follow');
    }
    expect(mo.takeRecords()).toEqual([]);
    mo.disconnect();
    expect(post.outerHTML).toBe(html);
  });

  test('逐段翻译翻出的那一行跟随逐段翻译的模式：页面对照、逐段仅译文时只隐藏这一行的原文', () => {
    const withLink = (i: number) => (i === 5 ? 'Line 5: she read <a id="x" href="#">the letter</a> twice.' : line(i));
    document.body.innerHTML = `<p id="post">${brLines(N, '<br>\n', withLink)}</p>`;
    const restoreRects = mockAllBoundingRects();
    const hovered = closestUnit(document.getElementById('x')!)!;
    restoreRects();
    render(hovered, fakeTranslate(unitTextEx(hovered, readRulesSnapshot()).text), 'para');
    // 其余行由整页翻译翻出
    for (const c of document.querySelectorAll('#post > .pt-chunk:not([data-pt])')) {
      render(c, fakeTranslate(unitTextEx(c, readRulesSnapshot()).text), 'page');
    }
    applyMode('bilingual', 'translation-only');
    const hidden = [...document.querySelectorAll('#post > .pt-chunk')].filter(
      (c) => getComputedStyle(c.querySelector(':scope > .pt-origin')!).display === 'none',
    );
    expect(hidden).toEqual([hovered]);
  });
});

describe('还原之后逐字节回到原样（#713）', () => {
  test('仅译文模式下还原：原文完整回来，段落 HTML 与翻译前一字不差', async () => {
    const before = await translated();
    applyMode('translation-only', 'follow');
    restorePage();
    expect(document.body.innerHTML).toBe(before);
    // 原文没有一处被隐藏：段落里不再有译文包装
    expect(document.querySelectorAll('.pt-origin, .pt-trans, .pt-chunk')).toHaveLength(0);
  });

  test('采集结果在模式切换前后相同：切换不影响下一次翻译', async () => {
    const before = await translated();
    restorePage();
    applyMode('translation-only', 'follow');
    const { texts } = collectUnits();
    expect(texts).toHaveLength(N);
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
