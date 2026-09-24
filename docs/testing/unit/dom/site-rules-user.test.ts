/**
 * 站点页面规则 —— 用户排除规则（#370）
 *
 * 用户在设置页新增站点卡片、在“排除”里写选择器并保存；页面打开时
 * content script 先 await siteRulesReady() 载入用户规则，之后全页翻译
 * 与逐段翻译两个入口都按生效站点规则（内置 + 用户）排除。
 *
 * 全页翻译 —— walker 采集入口 collect()：用户排除命中的元素整块不采集。
 * 逐段翻译 —— closestUnit()（#409）：排除区内找不到段落，不出按钮。
 *
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

const PAGE =
  '<div class="panel"><p id="side">Contributors and maintainers of the project</p></div>' +
  '<p id="body">Claude Code is an agentic <b id="bold">coding</b> tool.</p>' +
  '<p id="more">It lives in your terminal and understands your codebase.</p>';

const ids = (units: Element[]) => units.map((u) => u.id);

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
async function exclude(...selectors: string[]) {
  await saveUserSiteRules('localhost', { exclude: selectors });
  await siteRulesReady();
}

describe('collect（用户排除规则）', () => {
  test('没有用户规则时照常采集', () => {
    expect(ids(collect())).toEqual(['side', 'body', 'more']);
  });

  test('命中用户排除的元素整块不采集，其余照常', async () => {
    await exclude('.panel');
    expect(ids(collect())).toEqual(['body', 'more']);
  });

  test('多条选择器都生效', async () => {
    await exclude('.panel', '#more');
    expect(ids(collect())).toEqual(['body']);
  });
});

describe('closestUnit（用户排除规则，逐段翻译入口）', () => {
  test('排除区内找不到段落', async () => {
    await exclude('#body');
    expect(closestUnit(document.getElementById('bold')!)).toBeNull();
  });

  test('排除区外照常找到段落', async () => {
    await exclude('.panel');
    expect(closestUnit(document.getElementById('bold')!)?.id).toBe('body');
  });
});
