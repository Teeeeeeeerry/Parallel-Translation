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

  test('存储里限定范围的无效选择器只跳过它自己', async () => {
    // 设置页保存时会拒绝无效选择器（#372）；存储里仍可能有（例如导入的规则）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chrome.storage.local.set({
      'pt-site-rules': { user: [{ site: 'localhost', scope: ['.content,', '#tail'] }] },
    });
    // 新打开的页面载入存储里的规则
    vi.resetModules();
    const page = await import('~/src/dom/walker');
    await (await import('~/src/storage/specialization')).siteRulesReady();
    expect(ids(page.collect())).toEqual(['tail']);
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

/** 在 host 下挂一个 open shadowRoot，内容为 html */
function shadow(host: Element, html: string): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

describe('限定范围越过 Shadow DOM 边界（#442）', () => {
  /** 在 parent 下挂一个 Web Component 宿主，shadow 里是 id 为 id 的段落 */
  function component(parent: Element, id: string): ShadowRoot {
    const host = document.createElement('x-card');
    parent.append(host);
    return shadow(host, `<p id="${id}">Rendered by a <b id="${id}-b">web</b> component.</p>`);
  }

  test('宿主在范围内：shadow 里的段落照常采集，逐段翻译照常找到', async () => {
    const root = component(document.querySelector('.content')!, 'sp');
    await rules({ scope: ['.content'] });
    expect(ids(collect())).toContain('sp');
    expect(closestUnit(root.getElementById('sp-b')!)?.id).toBe('sp');
  });

  test('嵌套两层 shadowRoot 时同样在范围内', async () => {
    const outer = document.createElement('x-shell');
    document.querySelector('.content')!.append(outer);
    const root = component(shadow(outer, '<div id="inner"></div>').getElementById('inner')!, 'deep');
    await rules({ scope: ['.content'] });
    expect(ids(collect())).toContain('deep');
    expect(closestUnit(root.getElementById('deep-b')!)?.id).toBe('deep');
  });

  test('宿主在范围外：shadow 里的段落不采集，逐段翻译找不到', async () => {
    const root = component(document.querySelector('.head')!, 'out');
    await rules({ scope: ['.content'] });
    expect(ids(collect())).not.toContain('out');
    expect(closestUnit(root.getElementById('out-b')!)).toBeNull();
  });
});
