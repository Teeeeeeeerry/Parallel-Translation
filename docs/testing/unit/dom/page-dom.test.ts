/**
 * 整页 DOM 原语（#1116，父 #1110）：还原整页与“页面是否已有译文”
 *
 * 内容脚本与两份测试装配用的是同一份实现。每种页面形状各做一遍
 * “采集 → 渲染 → 还原”，还原后 DOM 与翻译前逐字节相同：
 * - 普通段落；
 * - 以 br 分行的超长段落（采集时切成切块，还原要拆回切块包装）；
 * - 站点页面规则命中的保留原文元素（占位符换回原文后渲染）。
 * “是否已有译文”在渲染前后各看一次，shadow 里的译文也算。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { buildPageItem, hasTranslated, renderPageItem, restorePage } from '~/src/dom/page-dom';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';
import { brLines, isOverLimit } from './br-split-harness';

beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
});
afterEach(() => {
  document.body.innerHTML = '';
});

/** 采集并渲染整页（替身译文：原文前加前缀），返回渲染了几个单元。 */
function translateAll(): number {
  const restoreRects = mockAllBoundingRects();
  try {
    const items = collect(document.body).map(buildPageItem);
    for (const item of items) renderPageItem(item, `【译】${item.text}`);
    return items.length;
  } finally {
    restoreRects();
  }
}

/** 渲染 → 还原 → 与原 DOM 逐字节相同；渲染前后“是否已有译文”各看一次。 */
function expectRoundTrip(): void {
  const before = document.body.innerHTML;
  expect(hasTranslated()).toBe(false);
  expect(translateAll()).toBeGreaterThan(0);
  expect(document.body.innerHTML).not.toBe(before);
  expect(hasTranslated()).toBe(true);

  restorePage();
  expect(document.body.innerHTML).toBe(before);
  expect(hasTranslated()).toBe(false);
}

describe('还原整页：DOM 逐字节回原样（#1116）', () => {
  test('普通段落', () => {
    document.body.innerHTML =
      '<main><p>The quick brown fox jumps over the lazy dog.</p>\n<p>Another <b>bold</b> paragraph here.</p></main>';
    expectRoundTrip();
  });

  test('以 br 分行的超长段落：切块包装一并拆回', () => {
    document.body.innerHTML = `<p id="post">${brLines(60)}</p>`;
    expect(isOverLimit(document.getElementById('post')!)).toBe(true);
    const before = document.body.innerHTML;

    translateAll();
    expect(document.querySelectorAll('#post > .pt-chunk').length).toBeGreaterThan(1);
    expect(document.querySelector('#post')!.getAttribute('data-pt-split')).toBe('1');

    restorePage();
    expect(document.body.innerHTML).toBe(before);
    expect(hasTranslated()).toBe(false);
  });

  test('站点页面规则命中的保留原文元素：原文留在译文里，还原后回原样', async () => {
    await saveUserSiteRules(location.hostname, { preserve: ['.user'] });
    await siteRulesReady();
    document.body.innerHTML = '<p>Thanks <span class="user">@octocat</span> for the quick review.</p>';
    const before = document.body.innerHTML;

    translateAll();
    expect(document.querySelector('.pt-trans')!.textContent).toContain('@octocat');

    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('页面是否已有译文（#1116）', () => {
  test('shadow 里的译文也算', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Inside the shadow root there is a sentence.</p>';
    expect(hasTranslated()).toBe(false);

    const p = shadow.querySelector('p')!;
    renderPageItem(buildPageItem(p), '影子里的译文');
    expect(hasTranslated()).toBe(true);

    restorePage();
    expect(hasTranslated()).toBe(false);
    // 渲染器往 shadow 里注入的样式表留着，段落本身回原样
    expect(p.outerHTML).toBe('<p>Inside the shadow root there is a sentence.</p>');
  });
});
