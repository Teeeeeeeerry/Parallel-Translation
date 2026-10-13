/**
 * 限定范围之外的内容不计入跳过（#757，规格 #727）
 *
 * 站点页面规则的限定范围是用户自己设的：范围之外不翻是预期，不是漏翻。
 * 同样，逐段翻译与增量补翻只在给定的根之下采集，根之外的元素从来就不在
 * 考虑之中。被排除规则命中的内容仍归“站点页面规则”一类计入（反向）。
 *
 * 切入点只有采集入口 collect。jsdom 默认 location.hostname 为 localhost，
 * 站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect, type SkipCategory } from '~/src/dom/walker';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const TOO_LONG = (id: string) => `<p id="${id}">${'This sentence keeps going on and on. '.repeat(100)}</p>`;

const PAGE =
  '<div class="head"><p id="head">Home, pricing, documentation and blog.</p>' + TOO_LONG('head-long') + '</div>' +
  '<div class="content">' +
  '<p id="intro">An agentic coding tool that lives in your terminal.</p>' +
  '<p class="ad" id="ad">Sponsored content from our partners.</p>' +
  TOO_LONG('body-long') +
  '</div>' +
  '<p id="tail">Copyright notice and license terms apply here.</p>';

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  // 规则快照留在内存里，存一张空卡片把上一条用例的规则清掉
  await saveUserSiteRules('localhost', {});
  await siteRulesReady();
  restore = mockAllBoundingRects();
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

function run(root: Node = document.body) {
  const skipped: [string, SkipCategory][] = [];
  const units = collect(root, undefined, { onSkip: (el, category) => skipped.push([el.id, category]) });
  return { units: units.map((u) => u.id), skipped };
}

describe('限定范围之外不计入跳过（#757）', () => {
  test('设了限定范围：范围外的段落（含超长的）都不算；范围内超长的仍算', async () => {
    await saveUserSiteRules('localhost', { scope: ['.content'] });
    await siteRulesReady();
    expect(run()).toEqual({ units: ['intro', 'ad'], skipped: [['body-long', 'too-long']] });
  });

  test('限定范围与排除同时设：范围外不算，范围内被排除的仍归站点页面规则一类（反向）', async () => {
    await saveUserSiteRules('localhost', { scope: ['.content'], exclude: ['.ad'] });
    await siteRulesReady();
    expect(run()).toEqual({
      units: ['intro'],
      skipped: [
        ['ad', 'site-rule'],
        ['body-long', 'too-long'],
      ],
    });
  });

  test('没设限定范围：同一页的超长段落都算（反向）', () => {
    expect(run().skipped).toEqual([
      ['head-long', 'too-long'],
      ['body-long', 'too-long'],
    ]);
  });

  test('只在给定的根之下采集：根之外的超长段落不在考虑之中', () => {
    const root = document.querySelector('.head')!;
    expect(run(root)).toEqual({ units: ['head'], skipped: [['head-long', 'too-long']] });
  });
});
