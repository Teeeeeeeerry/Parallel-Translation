/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/octo/repo/issues/1"}
 */
/**
 * 以 br 分行的超长段落：站点页面规则的排除与保留原文在每一行里照常生效
 * （#714，规格 #694）
 *
 * 切分不能成为规则的盲区。四种命中各覆盖一遍，内置与用户两个来源（#922 把
 * 它们分开了）各一遍：
 * - 命中某一行里的行内元素（排除或保留原文）：那一行照常翻译，该元素原文
 *   保留（#441、#58 的口径）；
 * - 命中某一整行（这一行只有一个被排除的元素）：这一行不送翻，其余行照常；
 * - 命中整块（段落本身或它的祖先被排除）：段落不切、不采集，DOM 一个字不动；
 *   逐段翻译的悬停也不切它；
 * - 限定范围之外的段落：不切、不采集，悬停也不切。
 * 每一种都翻译加还原，DOM 逐字节回原样。
 *
 * 内置规则用 github.com 的那几条（.text-mono 排除、a.user-mention 保留原文、
 * .BorderGrid 整块排除），所以本文件的页面 URL 是 github.com —— jsdom 的
 * URL 是文件级选项，单独成文件。
 *
 * 经采集入口 collect（含跳过回调）、整页翻译的编排入口（替身引擎、真实渲染器，
 * 占位符回填与 content script 同一口径）、逐段翻译入口 closestUnit 与还原断言。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { closestUnit } from '~/src/dom/classify';
import type { SkipCategory } from '~/src/dom/walker';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';
import { brLines, collectUnits, fakeTranslate, isOverLimit, line, restorePage, translatePage } from './br-split-harness';

const N = 60;

beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
});
afterEach(() => {
  document.body.innerHTML = '';
});

/** 用户规则写进 github.com 的站点卡片，等存储与缓存同步。 */
async function userRules(rules: { exclude?: string[]; preserve?: string[]; scope?: string[] }): Promise<void> {
  await saveUserSiteRules('github.com', rules);
  await siteRulesReady();
}

/** 第 k 行换成 render(k)，其余是普通对话。 */
const post = (special: Record<number, string>, attrs = 'id="post"') =>
  `<p ${attrs}>${brLines(N, '<br>\n', (i) => special[i] ?? line(i))}</p>`;

/** 每个已翻译切块的原文与译文。 */
const pairs = () =>
  [...document.querySelectorAll('#post > .pt-chunk[data-pt="done"]')].map((c) => ({
    origin: (c.querySelector(':scope > .pt-origin')!.textContent ?? '').trim(),
    trans: (c.querySelector(':scope > .pt-trans')!.textContent ?? '').trim(),
  }));

/** 采集一次，记下跳过回调报出的类别。 */
function skips(): SkipCategory[] {
  const seen: SkipCategory[] = [];
  collectUnits({ onSkip: (_el, c) => seen.push(c) });
  return seen;
}

/** 悬停在 el 上：返回逐段翻译找到的单元（读布局要的盒子替身照常装上）。 */
function hover(el: Element): Element | null {
  const restoreRects = mockAllBoundingRects();
  try {
    return closestUnit(el);
  } finally {
    restoreRects();
  }
}

/** 某一行里的行内元素被规则命中：那一行照常翻译，元素原文保留；还原逐字节回原样。 */
async function expectInlineKept(hitHtml: string, hitText: string): Promise<void> {
  const LINE = `Line 9: she pinged ${hitHtml} about the release and left.`;
  document.body.innerHTML = post({ 9: LINE });
  expect(isOverLimit(document.getElementById('post')!)).toBe(true);
  const before = document.body.innerHTML;

  const { requests } = await translatePage();
  const sent = requests.flat().map((t) => t.trim());
  // 60 行都送翻了，第 9 行里命中的元素换成了占位符，没有把它的文字送出去
  expect(sent).toHaveLength(N);
  expect(sent[9]).not.toContain(hitText);
  expect(sent[9]).toMatch(/^Line 9: she pinged \S+ about the release and left\.$/);
  // 第 9 行的译文里，命中的元素原文原样回来了
  const all = pairs();
  expect(all).toHaveLength(N);
  expect(all[9]!.trans).toBe(fakeTranslate(`Line 9: she pinged ${hitText} about the release and left.`));
  expect(all[3]!.trans).toBe(fakeTranslate(line(3)));

  restorePage();
  expect(document.body.innerHTML).toBe(before);
}

/** 某一整行只有一个被规则排除的元素：这一行不送翻，其余行照常；还原逐字节回原样。 */
async function expectLineExcluded(hitHtml: string): Promise<void> {
  document.body.innerHTML = post({ 20: hitHtml });
  const before = document.body.innerHTML;
  const { requests } = await translatePage();
  const sent = requests.flat().map((t) => t.trim());
  expect(sent).toEqual(Array.from({ length: N }, (_, i) => i).filter((i) => i !== 20).map(line));
  expect(pairs()).toHaveLength(N - 1);
  restorePage();
  expect(document.body.innerHTML).toBe(before);
}

/** 整块命中：段落不切、不采集，DOM 一个字不动；悬停也不切。 */
function expectBlockUntouched(): void {
  const before = document.body.innerHTML;
  const { units } = collectUnits();
  expect(units.filter((u) => u.closest('#post'))).toEqual([]);
  expect(document.body.innerHTML).toBe(before);
  expect(hover(document.getElementById('hover')!)).toBeNull();
  expect(document.body.innerHTML).toBe(before);
}

describe('内置规则在每一行里照常生效（#714）', () => {
  test('某一行里的行内元素命中内置排除（.text-mono）：那一行照常翻译，元素原文保留', async () => {
    await expectInlineKept('<span class="text-mono">a1b2c3d</span>', 'a1b2c3d');
  });

  test('某一行里的行内元素命中内置保留原文（a.user-mention）：那一行照常翻译，元素原文保留', async () => {
    await expectInlineKept('<a class="user-mention" href="/octocat">@octocat</a>', '@octocat');
  });

  test('某一整行命中内置排除：这一行不送翻，其余行照常', async () => {
    await expectLineExcluded('<span class="text-mono">0123456789abcdef0123456789abcdef deadbeef</span>');
  });

  test('整块命中内置排除（段落在 .BorderGrid 里）：不切、不采集、悬停也不切；内置排除不计入跳过（#922）', () => {
    document.body.innerHTML = `<div class="BorderGrid">${post({ 7: 'Line 7: see <a id="hover" href="#">this</a> now.' })}</div>`;
    expect(isOverLimit(document.getElementById('post')!)).toBe(true);
    expectBlockUntouched();
    expect(skips()).toEqual([]);
  });
});

describe('用户规则在每一行里照常生效（#714）', () => {
  test('某一行里的行内元素命中用户排除：那一行照常翻译，元素原文保留', async () => {
    await userRules({ exclude: ['.ticket'] });
    await expectInlineKept('<span class="ticket">JIRA-4242</span>', 'JIRA-4242');
  });

  test('某一行里的行内元素命中用户保留原文：那一行照常翻译，元素原文保留', async () => {
    await userRules({ preserve: ['.handle'] });
    await expectInlineKept('<b class="handle">MaraTheo</b>', 'MaraTheo');
  });

  test('某一整行命中用户排除：这一行不送翻，其余行照常', async () => {
    await userRules({ exclude: ['.ticket'] });
    await expectLineExcluded('<span class="ticket">Ticket JIRA-4242 was closed by the release bot</span>');
  });

  test('整块命中用户排除（段落本身）：不切、不采集、悬停也不切；计入跳过，类别是站点规则（#922）', async () => {
    await userRules({ exclude: ['#post'] });
    document.body.innerHTML = post({ 7: 'Line 7: see <a id="hover" href="#">this</a> now.' });
    expectBlockUntouched();
    expect(skips()).toEqual(['site-rule']);
  });

  test('用户限定范围：范围之外的超长段落不切、不采集、悬停也不切；范围之内的照常按行切', async () => {
    await userRules({ scope: ['.main'] });
    document.body.innerHTML =
      `<div class="side">${post({ 7: 'Line 7: see <a id="hover" href="#">this</a> now.' })}</div>` +
      `<div class="main">${post({}, 'id="inside"')}</div>`;
    const before = document.getElementById('post')!.outerHTML;
    const { units } = collectUnits();
    expect(units).toHaveLength(N);
    expect(units.every((u) => u.parentElement!.id === 'inside')).toBe(true);
    expect(document.getElementById('post')!.outerHTML).toBe(before);
    expect(hover(document.getElementById('hover')!)).toBeNull();
    expect(document.getElementById('post')!.outerHTML).toBe(before);
  });
});

describe('内置与用户规则同时在多行里命中，翻译加还原逐字节回原样（#714）', () => {
  test('一段里有内置排除、内置保留、用户排除、用户保留各一行，外加一整行被排除：翻译之后各自原文保留，还原一字不差', async () => {
    await userRules({ exclude: ['.ticket'], preserve: ['.handle'] });
    document.body.innerHTML = post({
      2: 'Line 2: commit <span class="text-mono">a1b2c3d</span> fixed it.',
      4: 'Line 4: thanks <a class="user-mention" href="/octocat">@octocat</a> for that.',
      6: 'Line 6: see <span class="ticket">JIRA-4242</span> for details.',
      8: 'Line 8: <b class="handle">MaraTheo</b> wrote back at once.',
      10: '<span class="ticket">Ticket JIRA-9999 was closed by the release bot</span>',
    });
    const before = document.body.innerHTML;
    await translatePage();
    const all = pairs();
    expect(all).toHaveLength(N - 1);
    expect(all.find((p) => p.origin.startsWith('Line 2'))!.trans).toContain('a1b2c3d');
    expect(all.find((p) => p.origin.startsWith('Line 4'))!.trans).toContain('@octocat');
    expect(all.find((p) => p.origin.startsWith('Line 6'))!.trans).toContain('JIRA-4242');
    expect(all.find((p) => p.origin.startsWith('Line 8'))!.trans).toContain('MaraTheo');
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
