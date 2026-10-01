/**
 * storage/domains.ts — 从术语 CSV 新建领域（#603）
 *
 * 只断言外部可观察的行为：生效领域列表里多出的领域（名称、目标语言、
 * 来源、适用网址、术语）、返回的导入条数与跳过的行；没有可导入的行或
 * 写入失败时领域列表不变。解析规则与往已有领域导入相同（#590）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveDomains,
  createDomain,
  importDomainTermsCsv,
  createDomainFromTermsCsv,
} from '~/src/storage/domains';
import { StorageQuotaError } from '~/src/storage/quota';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';

/** 十六进制写出的文件字节（GBK 用）。 */
function bytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

async function ids(): Promise<string[]> {
  return (await getEffectiveDomains()).map((d) => d.id);
}

beforeEach(() => {
  resetStorage();
});

describe('从术语 CSV 新建领域（#603）', () => {
  test('两列带表头：新建自建领域，名称、目标语言正确，适用网址为空，术语按文件顺序', async () => {
    const before = await ids();

    const result = await createDomainFromTermsCsv(
      { name: '  法律术语 ', targetLang: 'zh-CN' },
      '原词,译法\nplaintiff,原告\ntort,侵权\n',
    );

    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.headerColumns).toBe(2);
    const created = (await getEffectiveDomains()).find((d) => d.id === result.domain!.id)!;
    expect(created).toEqual({
      id: result.domain!.id,
      name: '法律术语',
      targetLang: 'zh-CN',
      sites: [],
      origin: 'user',
      terms: [
        { source: 'plaintiff', target: '原告' },
        { source: 'tort', target: '侵权' },
      ],
    });
    expect(result.domain).toEqual(created);
    // 新领域在列表末尾
    expect(await ids()).toEqual([...before, created.id]);
  });

  test('GBK 字节：中文正确', async () => {
    // “原词,译法\r\nAPI,接口\r\ntimeout,超时\r\n” 的 GBK 编码
    const gbk = bytes('d4adb4ca2cd2ebb7a80d0a4150492cbdd3bfda0d0a74696d656f75742cb3accab10d0a');

    const { domain } = await createDomainFromTermsCsv({ name: '软件', targetLang: 'zh-CN' }, gbk);

    expect(domain!.terms).toEqual([
      { source: 'API', target: '接口' },
      { source: 'timeout', target: '超时' },
    ]);
  });

  test('有错误行：其余行导入，跳过的行与往已有领域导入同一份文件时相同', async () => {
    const csv = 'source,target,noTranslate\nplaintiff,原告,false\nonly,two\n,被告,false\nEsq.,,true\n';
    const existing = await createDomain({ name: '对照', targetLang: 'zh-CN' });
    const expected = await importDomainTermsCsv(existing.id, csv);

    const result = await createDomainFromTermsCsv({ name: '法律', targetLang: 'zh-CN' }, csv);

    expect(result.imported).toBe(expected.imported);
    expect(result.skipped).toEqual(expected.skipped);
    expect(result.headerColumns).toBe(expected.headerColumns);
    expect(result.domain!.terms).toEqual([
      { source: 'plaintiff', target: '原告' },
      { source: 'Esq.', noTranslate: true },
    ]);
  });

  test('文件里同一原词出现多次：后出现的为准，留在第一次出现的位置', async () => {
    const { domain, imported } = await createDomainFromTermsCsv(
      { name: '法律', targetLang: 'zh-CN' },
      'tort,侵权\nplaintiff,原告\nTORT,侵权行为\n',
    );

    expect(imported).toBe(3);
    expect(domain!.terms).toEqual([
      { source: 'TORT', target: '侵权行为' },
      { source: 'plaintiff', target: '原告' },
    ]);
  });

  test.each([
    ['全部是错误行', 'a,b,c,d\n,缺原词\n'],
    ['空文件', ''],
    ['只有表头', 'source,target,noTranslate\r\n'],
  ])('%s：不新建领域，领域列表不变', async (_, csv) => {
    const before = await ids();

    const result = await createDomainFromTermsCsv({ name: '法律', targetLang: 'zh-CN' }, csv);

    expect(result.domain).toBeNull();
    expect(result.imported).toBe(0);
    expect(await ids()).toEqual(before);
  });

  test('全部是错误行时返回跳过的行', async () => {
    const { skipped } = await createDomainFromTermsCsv(
      { name: '法律', targetLang: 'zh-CN' },
      'a,b,c,d\n,缺原词\n',
    );

    expect(skipped).toEqual([
      { line: 1, reason: 'columns' },
      { line: 2, reason: 'missingSource' },
    ]);
  });

  test.each([
    ['名称', { name: '  ', targetLang: 'zh-CN' }],
    ['目标语言', { name: '法律', targetLang: '' }],
  ])('%s为空：抛错，不写入', async (_, input) => {
    const before = structuredClone(localStoreSnapshot()['pt-domains']);

    await expect(createDomainFromTermsCsv(input, 'tort,侵权\n')).rejects.toThrow();
    expect(localStoreSnapshot()['pt-domains']).toEqual(before);
  });

  test('写入失败（存储空间不足）：抛 StorageQuotaError，领域列表不变', async () => {
    const before = await ids();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));

    await expect(
      createDomainFromTermsCsv({ name: '法律', targetLang: 'zh-CN' }, 'tort,侵权\n'),
    ).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await ids()).toEqual(before);
  });
});
