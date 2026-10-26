/**
 * 内置领域叠加层（#1149）：纯函数，不碰存储
 *
 * 用两份内置数据模拟“升级前 / 升级后”：用户删掉的内置术语与适用网址升级后
 * 不复活，升级新增的照常生效，恢复默认清掉全部修改，叠加层全空时去掉这一条。
 * 领域存储层的同类用例（domains-*.test.ts）断言不改。
 */
import { describe, test, expect } from 'vitest';
import {
  applyOverlay,
  isBaseTerm,
  isOverlayModified,
  overlayWithSites,
  overlayWithTerms,
} from '~/src/storage/builtin-overlay';
import type { Domain } from '~/src/storage/domains';

const v1: Domain = {
  id: 'builtin:test',
  name: 'Test',
  targetLang: 'zh-CN',
  origin: 'builtin',
  sites: ['a.com', 'b.com'],
  terms: [
    { source: 'API', target: '接口' },
    { source: 'Kubernetes', noTranslate: true },
  ],
};

describe('术语', () => {
  test('删掉的内置术语升级后不复活，升级新增的照常生效', () => {
    const overlay = overlayWithTerms(v1, undefined, [{ source: 'API', target: '接口' }]);
    expect(overlay?.removedTerms).toEqual(['kubernetes']);
    // 新版先去掉了它，用户的删除记录要保留下来
    const v2: Domain = { ...v1, terms: [{ source: 'API', target: '接口' }, { source: 'Pod', target: '容器组' }] };
    const again = overlayWithTerms(v2, overlay, applyOverlay(v2, overlay).terms);
    expect(again?.removedTerms).toEqual(['kubernetes']);
    // 再下一版加回来：仍不复活
    const v3: Domain = { ...v2, terms: [...v2.terms, { source: 'Kubernetes', noTranslate: true }] };
    expect(applyOverlay(v3, again).terms.map((t) => t.source)).toEqual(['API', 'Pod']);
  });

  test('修改留在原位，新增排在后面，与内置相同的不记', () => {
    const overlay = overlayWithTerms(v1, undefined, [
      { source: 'API', target: '应用程序接口' },
      { source: 'Kubernetes', noTranslate: true },
      { source: 'Helm', target: '舵' },
    ]);
    expect(overlay?.terms).toEqual([
      { source: 'API', target: '应用程序接口' },
      { source: 'Helm', target: '舵' },
    ]);
    expect(applyOverlay(v1, overlay).terms).toEqual([
      { source: 'API', target: '应用程序接口' },
      { source: 'Kubernetes', noTranslate: true },
      { source: 'Helm', target: '舵' },
    ]);
  });

  test('isBaseTerm 不区分大小写、去首尾空格', () => {
    expect(isBaseTerm(v1, ' api ')).toBe(true);
    expect(isBaseTerm(v1, 'Helm')).toBe(false);
  });
});

describe('适用网址', () => {
  test('删掉的内置网址升级后不复活，新增的保留，升级新增的照常生效', () => {
    const overlay = overlayWithSites(v1, undefined, ['a.com', 'mine.org']);
    expect(overlay).toMatchObject({ addedSites: ['mine.org'], removedSites: ['b.com'] });
    const v2: Domain = { ...v1, sites: ['a.com', 'b.com', 'c.com'] };
    expect(applyOverlay(v2, overlay).sites).toEqual(['a.com', 'c.com', 'mine.org']);
  });

  test('以前删掉、这次加回来的不再算删除', () => {
    const removed = overlayWithSites(v1, undefined, ['a.com']);
    expect(overlayWithSites(v1, removed, ['a.com', 'b.com'])).toBeUndefined();
  });
});

describe('全空去掉、恢复默认、是否改过', () => {
  test('改回与内置一致：叠加层为 undefined', () => {
    expect(overlayWithTerms(v1, undefined, v1.terms)).toBeUndefined();
    expect(overlayWithSites(v1, undefined, v1.sites)).toBeUndefined();
  });

  test('只改网址时术语部分原样保留，反之亦然', () => {
    const terms = overlayWithTerms(v1, undefined, [{ source: 'API', target: '接口' }]);
    const both = overlayWithSites(v1, terms, ['a.com']);
    expect(both).toEqual({ terms: [], removedTerms: ['kubernetes'], addedSites: [], removedSites: ['b.com'] });
  });

  test('恢复默认就是去掉叠加层；isOverlayModified 只看生效内容', () => {
    const overlay = overlayWithSites(v1, undefined, ['a.com']);
    expect(isOverlayModified(v1, applyOverlay(v1, overlay))).toBe(true);
    expect(applyOverlay(v1, undefined)).toEqual(v1);
    expect(isOverlayModified(v1, applyOverlay(v1, undefined))).toBe(false);
    // 只剩对当前内置已没有的原词的删除记录：不算修改
    const stale = { terms: [], removedTerms: ['gone'], addedSites: [], removedSites: [] };
    expect(isOverlayModified(v1, applyOverlay(v1, stale))).toBe(false);
  });
});
