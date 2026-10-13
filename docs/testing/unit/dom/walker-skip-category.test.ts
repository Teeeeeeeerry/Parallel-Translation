/**
 * 被跳过的单元按原因分组（#754，规格 #727）
 *
 * 分类沿用既有跳过判定本来就有的分支，不发明新说法、不新增判定：
 * - 文字超过长度上限（MAX_TEXT）
 * - 标记复杂度超限（子树元素个数兜底，MAX_ELEMENTS）
 * - 被判为非正文区域（NON_CONTENT）—— #756 起不计入跳过，用例改为钉住这一点
 * - 被站点页面规则排除（排除选择器）
 * - 其他（采集时属性访问抛异常，#54）
 *
 * 切入点只有采集入口 collect：onSkip 的第二个参数给出原因。只看外部可观察的
 * 行为：采到了哪些单元、每一类报了几个。
 *
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect, type SkipCategory } from '~/src/dom/walker';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const NORMAL = '<p id="a">A normal paragraph with some words.</p><p id="b">Another normal paragraph here.</p>';
const TOO_LONG = `<p id="long">${'This sentence keeps going on and on. '.repeat(100)}</p>`;
const TOO_COMPLEX = `<p id="dense">${'<b>w</b> '.repeat(400)}</p>`;
const NON_CONTENT = '<footer><p id="foot">Copyright notice and license terms.</p></footer>';
const EXCLUDED = '<p class="ad" id="ad">Sponsored content from our partners.</p>';

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 采一遍，返回采到的单元 id 与按原因分组的计数。 */
function tally(): { units: string[]; by: Partial<Record<SkipCategory, string[]>> } {
  const by: Partial<Record<SkipCategory, string[]>> = {};
  const units = collect(document.body, undefined, {
    onSkip: (el, category) => (by[category] ??= []).push(el.id),
  });
  return { units: units.map((u) => u.id), by };
}

describe('按原因分组（#754）', () => {
  test('文字超过长度上限', () => {
    document.body.innerHTML = NORMAL + TOO_LONG;
    expect(tally()).toEqual({ units: ['a', 'b'], by: { 'too-long': ['long'] } });
  });

  test('标记复杂度超限', () => {
    document.body.innerHTML = NORMAL + TOO_COMPLEX;
    expect(tally()).toEqual({ units: ['a', 'b'], by: { 'too-complex': ['dense'] } });
  });

  test('被判为非正文区域：#756 起不计入跳过', () => {
    document.body.innerHTML = NORMAL + NON_CONTENT;
    expect(tally()).toEqual({ units: ['a', 'b'], by: {} });
  });

  test('被站点页面规则排除', async () => {
    await saveUserSiteRules('localhost', { exclude: ['.ad'] });
    await siteRulesReady();
    document.body.innerHTML = NORMAL + EXCLUDED;
    expect(tally()).toEqual({ units: ['a', 'b'], by: { 'site-rule': ['ad'] } });
  });

  test('其他：采集时属性访问抛异常（#54）', () => {
    document.body.innerHTML = NORMAL + '<p id="wc">A web component paragraph.</p>';
    Object.defineProperty(document.getElementById('wc')!, 'classList', {
      get() {
        throw new DOMException('blocked', 'InvalidStateError');
      },
    });
    expect(tally()).toEqual({ units: ['a', 'b'], by: { other: ['wc'] } });
  });

  test('几类同时出现：各归各的，总数等于各类之和', () => {
    document.body.innerHTML = NORMAL + TOO_LONG + TOO_COMPLEX + TOO_LONG.replace('id="long"', 'id="long2"');
    const { units, by } = tally();
    expect(units).toEqual(['a', 'b']);
    expect(by).toEqual({ 'too-long': ['long', 'long2'], 'too-complex': ['dense'] });
  });

  test('先命中的分支说了算：既在非正文区又超长的，按非正文区处理，不算超长（#756 起不计入）', () => {
    document.body.innerHTML = NORMAL + `<nav>${TOO_LONG}</nav>`;
    expect(tally().by).toEqual({});
  });

  test('没有任何跳过时一类都没有', () => {
    document.body.innerHTML = NORMAL + '<p id="num">2026-10-13</p><p id="short">ab</p>';
    expect(tally()).toEqual({ units: ['a', 'b'], by: {} });
  });
});
