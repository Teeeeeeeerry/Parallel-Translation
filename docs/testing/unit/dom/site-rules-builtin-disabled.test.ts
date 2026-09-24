/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * 站点页面规则 —— 停用某个站点的内置规则（#375）
 *
 * github.com 的站点卡片打开“停用这个站点的内置规则”后，该站点只剩用户
 * 规则生效。全页翻译（collect）与逐段翻译（closestUnit，#409）两个入口
 * 一致：内置排除命中的元素重新可以翻译，用户规则照常生效。
 *
 * 独立成文件：用例会保存 github.com 的站点卡片，不影响
 * site-rules-github.test.ts 里的内置规则用例；jsdom 的 location.hostname
 * 也是文件级选项。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import {
  saveUserSiteRules,
  setBuiltinSiteRulesDisabled,
  siteRulesReady,
} from '~/src/storage/specialization';

const PAGE =
  '<div class="BorderGrid"><p id="grid">Contributors and maintainers of this project</p></div>' +
  '<div class="ad"><p id="ad">Sponsored: try the new editor today</p></div>' +
  '<p id="body">Claude Code is an agentic coding tool.</p>';

const ids = (units: Element[]) => units.map((u) => u.id);

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  restore = mockAllBoundingRects();
  document.body.innerHTML = PAGE;
  await saveUserSiteRules('github.com', { exclude: ['.ad'] });
  await siteRulesReady();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

describe('停用 github.com 的内置规则（#375）', () => {
  test('开关关闭时内置排除与用户排除都生效', () => {
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('grid')!)).toBeNull();
  });

  test('开关打开后：内置排除命中的元素重新可以全页翻译与逐段翻译，用户排除照常生效', async () => {
    await setBuiltinSiteRulesDisabled('github.com', true);
    expect(ids(collect())).toEqual(['grid', 'body']);
    expect(closestUnit(document.getElementById('grid')!)?.id).toBe('grid');
    expect(closestUnit(document.getElementById('ad')!)).toBeNull();
  });

  test('再关闭开关：恢复追加合并', async () => {
    await setBuiltinSiteRulesDisabled('github.com', true);
    await setBuiltinSiteRulesDisabled('github.com', false);
    expect(ids(collect())).toEqual(['body']);
    expect(closestUnit(document.getElementById('grid')!)).toBeNull();
  });
});
