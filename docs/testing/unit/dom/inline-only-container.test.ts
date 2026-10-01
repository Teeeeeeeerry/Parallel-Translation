/**
 * 只含行内元素的正文容器（#589）
 *
 * div 等正文容器原先必须直接持有文字才算翻译单元（#33）。容器没有直接
 * 文字、里面只有行内元素时（例如只包着一个链接的 div），这段文字没有任何
 * 元素能成为翻译单元，全页翻译与逐段翻译都漏掉它。现在这样的容器同样算
 * 翻译单元，整段翻译。
 *
 * 全页翻译 —— walker 采集入口 collect()；逐段翻译 —— closestUnit()（#409），
 * 两个入口共用同一个判定，分别验证。
 *
 * 已有的跳过判定照常先于这条规则生效：非正文区域、太短、纯数字、站点页面
 * 规则的排除，以及去掉保留原文后没有可翻译文字（#454）、只有读屏隐藏文字（#595）。
 * 只包着代码的容器（<pre><code>、<div><code>）不算 —— 代码本来就不翻译。
 *
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const ids = (units: Element[]) => units.map((u) => u.id);

let restore: () => void;
beforeEach(() => {
  resetStorage();
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('只含行内元素的正文容器（#589）', () => {
  test('div 里只有一个带文字的链接：采集到这个 div，在链接上能找到它', () => {
    document.body.innerHTML =
      '<div id="learn"><a id="link" href="/docs">Learn how we count contributions</a></div>';
    expect(ids(collect())).toEqual(['learn']);
    expect(closestUnit(document.getElementById('link')!)?.id).toBe('learn');
  });

  test('div 里只有几个带文字的 span：同上', () => {
    document.body.innerHTML =
      '<div id="meta"><span id="who">Posted by the editors</span> <span>in the weekly digest</span></div>';
    expect(ids(collect())).toEqual(['meta']);
    expect(closestUnit(document.getElementById('who')!)?.id).toBe('meta');
  });

  test('嵌套的壳容器只采集最内层，祖先与后代不会同时成为单元', () => {
    document.body.innerHTML =
      '<div id="outer"><div id="inner"><a id="link" href="/more">Read more about the release</a></div></div>';
    expect(ids(collect())).toEqual(['inner']);
    expect(closestUnit(document.getElementById('link')!)?.id).toBe('inner');
  });

  test('div 里有行内元素，也有带文字的块级子元素：采集结果与原来一致', () => {
    document.body.innerHTML =
      '<div id="box"><a href="/a">Jump to the summary</a><p id="para">The full report follows below.</p></div>';
    expect(ids(collect())).toEqual(['para']);
  });

  test('只有空的行内元素（图标）的 div 不采集', () => {
    document.body.innerHTML = '<div id="icon"><span class="octicon"></span><br></div><p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('只包着代码的容器不采集：<pre><code> 代码块、<div><code>，代码本来就不翻译', () => {
    document.body.innerHTML =
      '<pre id="pre"><code id="c1">const answer = compute(value);</code></pre>' +
      '<div id="cmd"><code id="c2">npm install some-package</code></div>' +
      '<div id="link"><a href="/api"><code id="c3">parseArgs()</code></a></div>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('c1')!)).toBeNull();
    expect(closestUnit(document.getElementById('c2')!)).toBeNull();
    expect(closestUnit(document.getElementById('c3')!)).toBeNull();
  });

  test('行内元素里只有 style、script 的容器不采集（维基百科 navbox-styles 的结构）', () => {
    document.body.innerHTML =
      '<div id="styles"><span class="mw-empty-elt"><style>.navbox{box-sizing:border-box;border:1px solid #a2a9b1}</style></span></div>' +
      '<div id="script"><span><script>window.analyticsQueue = window.analyticsQueue || [];</script></span></div>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('代码以外还有文字的容器照常采集：<div><span>Press</span> <kbd>Ctrl</kbd></div>', () => {
    document.body.innerHTML = '<div id="hint"><span>Press the shortcut</span> <kbd>Ctrl</kbd></div>';
    expect(ids(collect())).toEqual(['hint']);
  });

  test('#595：只包着读屏隐藏文字（1×1）的 div 不采集，也找不到段落', () => {
    document.body.innerHTML =
      '<div id="sr-box"><span class="sr-only" id="sr">No contributions on this day</span></div>' +
      '<p id="body">Body text here.</p>';
    mockBoundingRect(document.getElementById('sr')!, { width: 1, height: 1 });
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('sr')!)).toBeNull();
  });

  test('nav、footer、aside 里同样结构的链接仍不采集', () => {
    document.body.innerHTML =
      '<nav><div><a href="/home">Home of the project</a></div></nav>' +
      '<footer><div><a href="/terms">Terms of service</a></div></footer>' +
      '<aside><div><a href="/related">Related articles</a></div></aside>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('只有一两个字符、或纯数字的链接仍不采集', () => {
    document.body.innerHTML =
      '<div id="short"><a href="/x">Go</a></div>' +
      '<div id="num"><a href="/stars">1,234</a></div>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.querySelector('#num a')!)).toBeNull();
  });

  test('站点页面规则排除区内的同样结构仍不采集，也找不到段落', async () => {
    await saveUserSiteRules('localhost', { exclude: ['.promo'] });
    await siteRulesReady();
    document.body.innerHTML =
      '<div class="promo"><div><a id="ad" href="/buy">Try the new editor today</a></div></div>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('ad')!)).toBeNull();
  });

  test('#454：只含 @mention（保留原文）的 div 不采集，也找不到段落', async () => {
    await saveUserSiteRules('localhost', { preserve: ['.user-mention'] });
    await siteRulesReady();
    document.body.innerHTML =
      '<div id="mention"><a class="user-mention" id="m">@octocat</a></div>' +
      '<p id="body">Body text here.</p>';
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('m')!)).toBeNull();
  });
});
