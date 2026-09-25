/**
 * 站点页面规则 —— 一次采集只读取一次（#468）
 *
 * 采集入口 collect() 开头读取当前站点的生效站点规则，这次采集里的所有
 * 判定都用它，包括“去掉保留原文后是否还有可翻译文字”（#454）。长页面
 * 有几千个候选段落时，读取次数不随段落数增长。逐段翻译入口
 * closestUnit() 同样只读取一次。翻译结果不变。
 *
 * 对领域与规则存储模块的 getSiteRules 计数，其余导出保持真实实现。
 * jsdom 默认 location.hostname 为 localhost，站点卡片用 localhost。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { collect } from '~/src/dom/walker';
import { closestUnit } from '~/src/dom/classify';
import { getSiteRules, saveUserSiteRules, siteRulesReady } from '~/src/storage/specialization';

vi.mock('~/src/storage/specialization', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/src/storage/specialization')>();
  return { ...real, getSiteRules: vi.fn(real.getSiteRules) };
});

const reads = vi.mocked(getSiteRules);

/** n 个带保留原文的段落，外加一个只剩保留原文的段落（#454 不采集） */
function page(n: number): string {
  const paras = Array.from(
    { length: n },
    (_, i) => `<p id="p${i}">Run <code class="keep">pnpm test</code> before you commit.</p>`,
  );
  return paras.join('') + '<p id="only"><span class="keep">@octocat</span></p>';
}

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  restore = mockAllBoundingRects();
  await saveUserSiteRules('localhost', { preserve: ['.keep'] });
  await siteRulesReady();
  reads.mockClear();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

/** 一次 collect() 的采集结果与读取站点规则的次数 */
function collectOnce(n: number): { ids: string[]; reads: number } {
  document.body.innerHTML = page(n);
  reads.mockClear();
  const ids = collect().map((u) => u.id);
  return { ids, reads: reads.mock.calls.length };
}

describe('collect（一次采集只读取一次站点规则）', () => {
  test('读取次数不随候选段落数增长', () => {
    const one = collectOnce(1);
    const many = collectOnce(20);
    expect(many.reads).toBe(one.reads);
    expect(many.reads).toBe(1);
  });

  test('采集结果不变：带保留原文的段落照常采集，只剩保留原文的段落不采集', () => {
    expect(collectOnce(3).ids).toEqual(['p0', 'p1', 'p2']);
  });
});

describe('closestUnit（逐段翻译入口只读取一次站点规则）', () => {
  test('向上找段落时只读取一次', () => {
    document.body.innerHTML =
      '<div id="outer"><p id="only"><span class="keep" id="name">@octocat</span></p>' +
      '<p id="body">Hello <b id="bold">world</b>, <code class="keep">pnpm</code> works.</p></div>';
    reads.mockClear();
    expect(closestUnit(document.getElementById('bold')!)?.id).toBe('body');
    expect(reads.mock.calls.length).toBe(1);
  });

  test('只剩保留原文的段落照旧找不到，继续向上找', () => {
    document.body.innerHTML = page(1);
    reads.mockClear();
    expect(closestUnit(document.querySelector('#only .keep')!)).toBeNull();
    expect(reads.mock.calls.length).toBe(1);
  });
});
