/**
 * 术语 CSV 模块（#1148）：纯函数，不碰存储
 *
 * 编解码从领域存储里拆出来之后直接测：引号与换行、列缺失、重复术语、跳过的
 * 行带物理行号与原因，导出再导入内容不变。领域存储层的导入导出用例仍在
 * domains-csv-*.test.ts，断言不改。
 */
import { describe, test, expect } from 'vitest';
import { decodeTermsCsv, encodeTermsCsv } from '~/src/storage/terms-csv';
import type { Term } from '~/src/storage/domains';

describe('encodeTermsCsv', () => {
  test('BOM、表头、CRLF；含逗号、引号、换行的字段加引号，公式开头加单引号前缀', () => {
    const csv = encodeTermsCsv([
      { source: 'a, b', target: '甲"乙' },
      { source: 'line\nbreak', target: 'x' },
      { source: '=SUM(1)', noTranslate: true },
    ]);
    expect(csv).toBe(
      '﻿source,target,noTranslate\r\n' +
        '"a, b","甲""乙",false\r\n' +
        '"line\nbreak",x,false\r\n' +
        `"'=SUM(1)",,true\r\n`,
    );
  });
});

describe('decodeTermsCsv', () => {
  test('导出再导入内容不变', () => {
    const terms: Term[] = [
      { source: 'a, b', target: '甲"乙' },
      { source: 'multi\nline', target: '多\r\n行' },
      { source: '@user', noTranslate: true },
      { source: "'til", target: '直到' },
      { source: '-1', target: '负一' },
    ];
    const decoded = decodeTermsCsv(encodeTermsCsv(terms));
    expect(decoded.terms).toEqual(terms);
    expect(decoded.skipped).toEqual([]);
    expect(decoded.headerColumns).toBe(3);
  });

  test('跳过的行带物理行号与原因：列缺失、原词为空、缺译法、不翻译列非法、引号未闭合', () => {
    const csv = [
      'source,target,noTranslate',
      'ok,好,false',
      'only-one-column',
      ',无原词,false',
      'no-target,,false',
      'bad-flag,x,maybe',
      '"multi',
      'line",跨行,false',
      'after,之后,false',
      '"unclosed,never',
    ].join('\n');
    const { terms, skipped } = decodeTermsCsv(csv);
    expect(terms).toEqual([
      { source: 'ok', target: '好' },
      { source: 'multi\nline', target: '跨行' },
      { source: 'after', target: '之后' },
    ]);
    expect(skipped).toEqual([
      { line: 3, reason: 'columns' },
      { line: 4, reason: 'missingSource' },
      { line: 5, reason: 'missingTarget' },
      { line: 6, reason: 'noTranslate' },
      { line: 10, reason: 'quote' },
    ]);
  });

  test('重复术语原样保留（合并时后出现的为准由领域存储负责）', () => {
    const { terms } = decodeTermsCsv('API,接口\napi,应用程序接口\n');
    expect(terms).toEqual([
      { source: 'API', target: '接口' },
      { source: 'api', target: '应用程序接口' },
    ]);
  });

  test('没有表头时按位置对应，第三列可省；分号分隔、GB18030 字节都能识别', () => {
    expect(decodeTermsCsv('cat;猫\ndog;狗;true\n')).toEqual({
      terms: [
        { source: 'cat', target: '猫' },
        { source: 'dog', noTranslate: true },
      ],
      skipped: [],
    });
    // “中文”的 GB18030 编码是 D6 D0 CE C4，不是有效的 UTF-8
    const bytes = new Uint8Array([0x7a, 0x68, 0x2c, 0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeTermsCsv(bytes).terms).toEqual([{ source: 'zh', target: '中文' }]);
  });
});
