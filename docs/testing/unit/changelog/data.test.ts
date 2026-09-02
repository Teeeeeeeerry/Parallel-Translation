/**
 * changelog/data.ts — 上架版本查询 单元测试
 *
 * ADR-0002：changelog 数据即上架版本的唯一真相 —— 数据里写了条目的
 * 版本就是上架版本，会弹更新提示；没写就不弹。查询必须字面相等，
 * 不做 semver 范围匹配，否则「2.1」会意外命中「2.1.0」的条目。
 */
import { describe, test, expect } from 'vitest';
import { findEntry, type ChangelogEntry } from '~/src/changelog/data';

/** 测试用数据 —— 不依赖真实 CHANGELOG，避免每次上架都要改测试 */
const ENTRIES: ChangelogEntry[] = [
  {
    version: '2.1.0',
    groups: [
      {
        type: 'fix',
        items: [
          {
            title: { zh_CN: '长对话导出', zh_TW: '長對話匯出', en: 'Long chat export' },
            desc: { zh_CN: '不再遗漏', zh_TW: '不再遺漏', en: 'No longer drops messages' },
          },
        ],
      },
    ],
  },
  { version: '2.0.65', groups: [] },
];

describe('findEntry', () => {
  test('版本有条目 → 返回该条目', () => {
    expect(findEntry('2.1.0', ENTRIES)?.version).toBe('2.1.0');
  });

  test('版本无条目 → undefined（内部版本不弹）', () => {
    expect(findEntry('2.0.66', ENTRIES)).toBeUndefined();
  });

  test('字面相等 —— 「2.1」不命中「2.1.0」', () => {
    expect(findEntry('2.1', ENTRIES)).toBeUndefined();
  });

  test('空数据 → undefined', () => {
    expect(findEntry('2.1.0', [])).toBeUndefined();
  });
});
