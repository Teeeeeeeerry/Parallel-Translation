/**
 * storage/domains.ts — 术语 CSV 导入（#403）
 *
 * 内置数据换成可变的测试数据，改动它来模拟一次扩展升级。只断言外部
 * 可观察的行为：导入后生效领域列表里的术语、导入的条数；导出再导入后
 * 术语不变；导入到内置领域时写入叠加层，升级后保留。本张只处理格式
 * 正确的文件，格式错误的行见 #404。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { Domain, Term } from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

let builtin: Domain[] = [];
vi.mock('~/src/storage/builtin-domains', () => ({
  get BUILTIN_DOMAINS() {
    return builtin;
  },
}));

import {
  getEffectiveDomains,
  createDomain,
  setDomainTerms,
  exportDomainTermsCsv,
  importDomainTermsCsv,
  DomainNotFoundError,
} from '~/src/storage/domains';

const DEV = 'builtin:dev';
const HEADER = 'source,target,noTranslate\r\n';

/** 当前版本的内置领域。 */
function release(terms: Term[]): void {
  builtin = [{ id: DEV, name: '软件开发', targetLang: 'zh-CN', sites: [], origin: 'builtin', terms }];
}

async function termsOf(id: string): Promise<Term[]> {
  return (await getEffectiveDomains()).find((d) => d.id === id)!.terms;
}

beforeEach(() => {
  resetStorage();
  release([
    { source: 'issue', target: '议题' },
    { source: 'fork', noTranslate: true },
  ]);
});

describe('术语 CSV 导入（#403）', () => {
  test('与现有术语合并：同一原词（不区分大小写）以导入为准、留在原位，新原词追加在后', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [
      { source: 'tort', target: '侵权' },
      { source: 'Esq.', noTranslate: true },
    ]);

    const { imported } = await importDomainTermsCsv(
      law.id,
      `${HEADER}TORT,侵权行为,false\r\nplaintiff,原告,false\r\n`,
    );

    expect(imported).toBe(2);
    expect(await termsOf(law.id)).toEqual([
      { source: 'TORT', target: '侵权行为' },
      { source: 'Esq.', noTranslate: true },
      { source: 'plaintiff', target: '原告' },
    ]);
  });

  test('导出再导入后术语与导出前一致（含 BOM、转义字段与“不翻译”）', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const terms: Term[] = [
      { source: 'terms, conditions', target: '条款，条件' },
      { source: 'the "Act"', target: '“该法”' },
      { source: 'line', target: '第一行\n第二行' },
      { source: 'Esq.', noTranslate: true },
    ];
    await setDomainTerms(law.id, terms);
    const csv = await exportDomainTermsCsv(law.id);

    await setDomainTerms(law.id, []);
    await importDomainTermsCsv(law.id, csv);
    expect(await termsOf(law.id)).toEqual(terms);

    // 在原有术语上再导入一次：不变
    await importDomainTermsCsv(law.id, csv);
    expect(await termsOf(law.id)).toEqual(terms);
  });

  test('只有换行（LF）、没有 BOM 的文件照样导入', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await importDomainTermsCsv(law.id, 'source,target,noTranslate\ntort,侵权,false\nEsq.,,TRUE');
    expect(await termsOf(law.id)).toEqual([
      { source: 'tort', target: '侵权' },
      { source: 'Esq.', noTranslate: true },
    ]);
  });

  test('文件里同一原词出现多次时，后出现的为准', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const { imported } = await importDomainTermsCsv(
      law.id,
      `${HEADER}tort,侵权,false\r\nTort,侵权行为,false\r\n`,
    );
    expect(imported).toBe(2);
    expect(await termsOf(law.id)).toEqual([{ source: 'Tort', target: '侵权行为' }]);
  });

  test('导入到内置领域：写入叠加层，升级后保留，新版新增的内置术语照常生效', async () => {
    await importDomainTermsCsv(DEV, `${HEADER}issue,问题,false\r\nmonorepo,单仓库,false\r\n`);
    expect(await termsOf(DEV)).toEqual([
      { source: 'issue', target: '问题' },
      { source: 'fork', noTranslate: true },
      { source: 'monorepo', target: '单仓库' },
    ]);

    release([
      { source: 'issue', target: '议题' },
      { source: 'fork', noTranslate: true },
      { source: 'PR', noTranslate: true },
    ]);
    expect(await termsOf(DEV)).toEqual([
      { source: 'issue', target: '问题' },
      { source: 'fork', noTranslate: true },
      { source: 'PR', noTranslate: true },
      { source: 'monorepo', target: '单仓库' },
    ]);
  });

  test('导入不删除文件里没有的术语：内置术语照旧', async () => {
    await importDomainTermsCsv(DEV, `${HEADER}monorepo,单仓库,false\r\n`);
    expect((await termsOf(DEV)).map((t) => t.source)).toEqual(['issue', 'fork', 'monorepo']);
  });

  test('领域不存在时抛 DomainNotFoundError', async () => {
    await expect(importDomainTermsCsv('user:missing', HEADER)).rejects.toBeInstanceOf(
      DomainNotFoundError,
    );
  });
});
