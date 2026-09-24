/**
 * 站点页面规则 —— 限定范围（#374）
 *
 * 设置了限定范围时，该站点只翻译命中这些选择器的元素及其后代，范围外
 * 一律不翻译；未设置时行为不变。判定顺序（ADR-0003）：站点黑名单 →
 * 限定范围 → 排除与保留原文 → compat 代码层 → walker 通用判定。
 *
 * 站点黑名单在编排模块的准入判定里拦下整页（orchestrator.test.ts 的
 * “黑名单命中：零请求”），根本不会走到这两个入口，本文件不重复。
 *
 * 全页翻译 —— walker 采集入口 collect()。
 * 逐段翻译 —— closestUnit()（#409）：与采集入口一致，范围外找不到段落。
 *
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { translatableTextEx } from '~/src/dom/text';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';
import type { SiteRules } from '~/src/storage/specialization';

const PAGE =
  '<div class="head"><p id="head">Home, pricing, documentation and blog.</p></div>' +
  '<div class="content">' +
  '<p id="intro">Claude Code is an agentic <b id="bold">coding</b> tool.</p>' +
  '<div class="ad"><p id="ad">Sponsored content from our partners.</p></div>' +
  '<p id="thanks">Thanks <a class="user-mention">@octocat</a> for the quick review.</p>' +
  '</div>' +
  '<p id="tail">Copyright notice and license terms apply here.</p>';

const ids = (units: Element[]) => units.map((u) => u.id);
const byId = (id: string) => document.getElementById(id)!;

let restore: () => void;
beforeEach(() => {
  resetStorage();
  restore = mockAllBoundingRects();
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 设置页保存一张 localhost 的站点卡片，页面载入用户规则 */
async function rules(r: Partial<SiteRules>) {
  await saveUserSiteRules('localhost', r);
  await siteRulesReady();
}

describe('collect（限定范围）', () => {
  test('未设置限定范围时行为不变', async () => {
    await rules({ exclude: [] });
    expect(ids(collect())).toEqual(['head', 'intro', 'ad', 'thanks', 'tail']);
  });

  test('只采集命中限定范围的元素及其后代，范围外不采集', async () => {
    await rules({ scope: ['.content'] });
    expect(ids(collect())).toEqual(['intro', 'ad', 'thanks']);
  });

  test('多条选择器取并集，命中的元素自身也可以是段落', async () => {
    await rules({ scope: ['#intro', '#tail'] });
    expect(ids(collect())).toEqual(['intro', 'tail']);
  });

  test('范围内的元素仍受排除约束', async () => {
    await rules({ scope: ['.content'], exclude: ['.ad'] });
    expect(ids(collect())).toEqual(['intro', 'thanks']);
  });

  test('排除命中限定范围的祖先时，范围内的元素也不采集', async () => {
    await rules({ scope: ['#intro'], exclude: ['.content'] });
    expect(ids(collect())).toEqual([]);
  });

  test('范围内的元素仍受保留原文约束', async () => {
    await rules({ scope: ['.content'], preserve: ['a.user-mention'] });
    const thanks = collect().find((u) => u.id === 'thanks')!;
    expect([...translatableTextEx(thanks).preserves.values()]).toEqual(['@octocat']);
  });

  test('采集根为元素（observer 增量补翻）时同样只采集范围内', async () => {
    await rules({ scope: ['#intro'] });
    expect(ids(collect(document.querySelector('.content')!))).toEqual(['intro']);
    expect(ids(collect(document.querySelector('.head')!))).toEqual([]);
  });

  test('限定范围里的无效选择器只跳过它自己', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rules({ scope: ['.content,', '#tail'] });
    expect(ids(collect())).toEqual(['tail']);
    warn.mockRestore();
  });
});

describe('closestUnit（限定范围，逐段翻译入口）', () => {
  test('范围外找不到段落，范围内照常找到', async () => {
    await rules({ scope: ['.content'] });
    expect(closestUnit(byId('head'))).toBeNull();
    expect(closestUnit(byId('tail'))).toBeNull();
    expect(closestUnit(byId('bold'))?.id).toBe('intro');
  });

  test('范围内的排除区仍找不到段落', async () => {
    await rules({ scope: ['.content'], exclude: ['.ad'] });
    expect(closestUnit(byId('ad'))).toBeNull();
  });

  test('限定范围只命中段落里的行内元素时，与采集入口一致：找不到段落', async () => {
    await rules({ scope: ['#bold'] });
    expect(ids(collect())).toEqual([]);
    expect(closestUnit(byId('bold'))).toBeNull();
  });
});
