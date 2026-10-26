/**
 * 翻译单元模块（#1145）：compat 代码层对整页采集与找最近单元同时生效
 *
 * 原先逐段翻译找最近单元时不调 compat 代码层，处理表是空的所以暂时一致；
 * 一旦按 ADR-0003 加一条补丁，整页与逐段就会判得不一样。这里在处理表里临时
 * 注册一个测试补丁（mock applyCompat，其余导出保持真实实现），两条路径同时
 * 受影响。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockAllBoundingRects, resetStorage } from '../../setup';
import { closestUnit, collect } from '~/src/dom/units';
import { applyCompat } from '~/src/dom/compat';
import { siteRulesReady } from '~/src/storage/specialization';

vi.mock('~/src/dom/compat', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/src/dom/compat')>();
  return { ...real, applyCompat: vi.fn(real.applyCompat) };
});

const patch = vi.mocked(applyCompat);

let restore: () => void;
beforeEach(async () => {
  resetStorage();
  await siteRulesReady();
  restore = mockAllBoundingRects();
  document.body.innerHTML =
    '<p id="skipped">This paragraph is skipped by the test patch.</p>' +
    '<div id="card"><p id="inner">Inner paragraph text <b id="bold">bold</b> here.</p></div>' +
    '<p id="plain">A plain paragraph nobody patches.</p>';
});
afterEach(() => {
  restore();
  patch.mockReset();
  document.body.innerHTML = '';
});

const ids = (els: Element[]) => els.map((e) => e.id);
const byId = (id: string) => document.getElementById(id)!;

describe('compat 补丁同时作用于整页采集与找最近单元（#1145）', () => {
  test('没有补丁：两条路径都找到三个段落', () => {
    patch.mockReturnValue(null);
    expect(ids(collect())).toEqual(['skipped', 'inner', 'plain']);
    expect(closestUnit(byId('skipped'))?.id).toBe('skipped');
    expect(closestUnit(byId('bold'))?.id).toBe('inner');
  });

  test('skip 补丁：整页不采集，逐段也找不到', () => {
    patch.mockImplementation((el) => (el.id === 'skipped' ? { skip: true } : null));
    expect(ids(collect())).toEqual(['inner', 'plain']);
    expect(closestUnit(byId('skipped'))).toBeNull();
    expect(closestUnit(byId('plain'))?.id).toBe('plain');
  });

  test('take 补丁：整页采集改指的元素，逐段从里面找也落到它', () => {
    patch.mockImplementation((el) => (el.id === 'card' ? { take: el } : null));
    expect(ids(collect())).toContain('card');
    expect(closestUnit(byId('bold'))?.id).toBe('inner');
    patch.mockImplementation((el) =>
      el.id === 'card' ? { take: el } : el.id === 'inner' ? { skip: true } : null,
    );
    expect(ids(collect())).toEqual(['skipped', 'card', 'plain']);
    expect(closestUnit(byId('bold'))?.id).toBe('card');
  });
});
