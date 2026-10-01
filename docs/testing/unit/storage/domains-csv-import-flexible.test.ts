/**
 * storage/domains.ts — 导入用户自己整理的术语 CSV（#590）
 *
 * 只断言外部可观察的行为：导入后生效领域列表里的术语、导入的条数、跳过
 * 的行与表头的列数。覆盖第三列省略、中英文表头（列顺序可不同）、GBK
 * 编码、分号与制表符分隔；本扩展导出的文件照常导入见 #403、#404 的用例。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  getEffectiveDomains,
  createDomain,
  setDomainTerms,
  importDomainTermsCsv,
} from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';
import type { Term } from '~/src/storage/domains';

let devId: string;

async function terms(): Promise<Term[]> {
  return (await getEffectiveDomains()).find((d) => d.id === devId)!.terms;
}

/** 十六进制写出的文件字节（GBK 等非 UTF-8 编码用）。 */
function bytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

beforeEach(async () => {
  resetStorage();
  devId = (await createDomain({ name: '软件开发', targetLang: 'zh-CN' })).id;
  await setDomainTerms(devId, [{ source: 'bug', target: '缺陷' }]);
});

describe('第三列可省（#590）', () => {
  test('两列、没有表头：全部按原词、译法导入，第一行照常当术语', async () => {
    const { imported, skipped } = await importDomainTermsCsv(devId, 'API,接口\r\ntimeout,超时\r\n');

    expect(imported).toBe(2);
    expect(skipped).toEqual([]);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
      { source: 'timeout', target: '超时' },
    ]);
  });

  test('两列与三列混排：第三列为 true 的行按“不翻译”导入', async () => {
    const { imported } = await importDomainTermsCsv(devId, 'API,接口\nGitHub,,true\n');

    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
      { source: 'GitHub', noTranslate: true },
    ]);
  });

  test('没有表头时 1 列或 4 列的行按列数不对跳过，不带表头列数', async () => {
    const result = await importDomainTermsCsv(devId, 'API,接口\nonly\na,b,false,d\n');

    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([
      { line: 2, reason: 'columns' },
      { line: 3, reason: 'columns' },
    ]);
    expect(result.headerColumns).toBeUndefined();
  });
});

describe('识别常见表头（#590）', () => {
  test('中文表头“原词,译法”：表头不导入，其余行导入', async () => {
    const result = await importDomainTermsCsv(devId, '原词,译法\nAPI,接口\n');

    expect(result.imported).toBe(1);
    expect(result.headerColumns).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
    ]);
  });

  test('英文表头“English,Chinese”不区分大小写、忽略首尾空白', async () => {
    const { imported } = await importDomainTermsCsv(devId, ' english , CHINESE \nAPI,接口\n');

    expect(imported).toBe(1);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
    ]);
  });

  test('表头列顺序为“译法,原词,不翻译”：按列名对应列', async () => {
    const { imported } = await importDomainTermsCsv(devId, '译法,原词,不翻译\n接口,API,false\n,GitHub,true\n');

    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
      { source: 'GitHub', noTranslate: true },
    ]);
  });

  test('有表头时按表头的列数：列数不同的行跳过，并给出表头列数', async () => {
    const result = await importDomainTermsCsv(devId, '原词,译法\nAPI,接口\nGitHub,,true\n');

    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([{ line: 3, reason: 'columns' }]);
    expect(result.headerColumns).toBe(2);
  });

  test('首行只有原词列、没有译法列：不算表头，按术语导入', async () => {
    const { imported } = await importDomainTermsCsv(devId, 'source,API\ntimeout,超时\n');

    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'source', target: 'API' },
      { source: 'timeout', target: '超时' },
    ]);
  });

  test('本扩展导出的表头照常识别，表头列数为 3', async () => {
    const result = await importDomainTermsCsv(devId, '﻿source,target,noTranslate\r\nAPI,接口,false\r\n');

    expect(result.imported).toBe(1);
    expect(result.headerColumns).toBe(3);
  });
});

describe('编码（#590）', () => {
  test('GBK 编码、不带 BOM 的字节：中文正确', async () => {
    // “原词,译法\r\nAPI,接口\r\ntimeout,超时\r\n” 的 GBK 编码
    const gbk = bytes('d4adb4ca2cd2ebb7a80d0a4150492cbdd3bfda0d0a74696d656f75742cb3accab10d0a');

    const { imported } = await importDomainTermsCsv(devId, gbk);

    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
      { source: 'timeout', target: '超时' },
    ]);
  });

  test('UTF-8 字节不带 BOM、带 BOM：中文正确', async () => {
    const plain = new TextEncoder().encode('API,接口\n');
    const withBom = new TextEncoder().encode('﻿原词,译法\ntimeout,超时\n');

    await importDomainTermsCsv(devId, plain);
    const { imported } = await importDomainTermsCsv(devId, withBom);

    expect(imported).toBe(1);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口' },
      { source: 'timeout', target: '超时' },
    ]);
  });

  test('带 UTF-8 BOM、个别字节无效时仍按 UTF-8 读，不改按 GBK', async () => {
    const body = new TextEncoder().encode('\uFEFF原词,译法\nAPI,接口\nbad,\u0000\n');
    // 最后一行的译法换成一个无效的 UTF-8 字节
    const broken = body.map((b) => (b === 0 ? 0xff : b));

    const { imported } = await importDomainTermsCsv(devId, broken);

    expect(imported).toBe(2);
    expect(await terms()).toContainEqual({ source: 'API', target: '接口' });
  });

  test('ArrayBuffer 与字节数组同样导入', async () => {
    const { imported } = await importDomainTermsCsv(devId, new TextEncoder().encode('API,接口\n').buffer);

    expect(imported).toBe(1);
  });
});

describe('分隔符（#590）', () => {
  test('分号分隔：字段里的逗号不再被拆开', async () => {
    const { imported, skipped } = await importDomainTermsCsv(devId, 'source;target\nAPI;接口, 界面\n"a;b";c\n');

    expect(skipped).toEqual([]);
    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口, 界面' },
      { source: 'a;b', target: 'c' },
    ]);
  });

  test('制表符分隔：字段里的逗号与分号不再被拆开', async () => {
    const { imported } = await importDomainTermsCsv(devId, 'API\t接口, 界面\ntimeout\t超时; 逾时\n');

    expect(imported).toBe(2);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口, 界面' },
      { source: 'timeout', target: '超时; 逾时' },
    ]);
  });

  test('开头有空行：分隔符与表头都按第一条非空记录识别', async () => {
    const { imported } = await importDomainTermsCsv(devId, '\n \n原词;译法\nAPI;接口, 界面\n');

    expect(imported).toBe(1);
    expect(await terms()).toEqual([
      { source: 'bug', target: '缺陷' },
      { source: 'API', target: '接口, 界面' },
    ]);
  });

  test('逗号与分号次数相同时按逗号：术语里的分号不改变分隔符', async () => {
    const { imported, skipped } = await importDomainTermsCsv(devId, 'R&D; QA,研发\nAPI,接口\n');

    expect(skipped).toEqual([]);
    expect(imported).toBe(2);
    expect(await terms()).toContainEqual({ source: 'R&D; QA', target: '研发' });
  });

  test('首条记录引号里的分号不影响识别：仍按逗号分隔', async () => {
    const { imported } = await importDomainTermsCsv(devId, '"a;b",c\nAPI,接口\n');

    expect(imported).toBe(2);
    expect(await terms()).toContainEqual({ source: 'a;b', target: 'c' });
  });
});
