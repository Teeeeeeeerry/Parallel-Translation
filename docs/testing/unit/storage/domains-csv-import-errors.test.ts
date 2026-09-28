/**
 * storage/domains.ts — 术语 CSV 导入的容错与规模（#404）
 *
 * 只断言外部可观察的行为：导入结果里跳过的行（行号与原因）、导入的
 * 条数、导入后生效领域列表里的术语；几千条术语导入后照常保存与读取，
 * 通用设置也照常保存。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveDomains,
  createDomain,
  setDomainTerms,
  importDomainTermsCsv,
} from '~/src/storage/domains';
import { settingsReady, getSettings, patchSettings } from '~/src/storage/settings';
import { resetStorage } from '~/docs/testing/setup';
import type { Term } from '~/src/storage/domains';

const HEADER = 'source,target,noTranslate\r\n';

let lawId: string;

async function terms(): Promise<Term[]> {
  return (await getEffectiveDomains()).find((d) => d.id === lawId)!.terms;
}

beforeEach(async () => {
  resetStorage();
  lawId = (await createDomain({ name: '法律', targetLang: 'zh-CN' })).id;
  await setDomainTerms(lawId, [{ source: 'tort', target: '侵权' }]);
});

describe('术语 CSV 导入的容错（#404）', () => {
  test('错误行跳过并列出行号与原因，其他行照常导入', async () => {
    const csv =
      HEADER + // 第 1 行
      'plaintiff,原告,false\r\n' + // 第 2 行
      'only-two,列\r\n' + // 第 3 行：列数不对
      ',被告,false\r\n' + // 第 4 行：原词为空
      'defendant,,false\r\n' + // 第 5 行：未勾不翻译且译法为空
      'a,b,c,d\r\n' + // 第 6 行：列数不对
      'Esq.,,true\r\n'; // 第 7 行

    const { imported, skipped } = await importDomainTermsCsv(lawId, csv);

    expect(imported).toBe(2);
    expect(skipped).toEqual([
      { line: 3, reason: 'columns' },
      { line: 4, reason: 'missingSource' },
      { line: 5, reason: 'missingTarget' },
      { line: 6, reason: 'columns' },
    ]);
    expect(await terms()).toEqual([
      { source: 'tort', target: '侵权' },
      { source: 'plaintiff', target: '原告' },
      { source: 'Esq.', noTranslate: true },
    ]);
  });

  test('不翻译列不是 true / false / 1 / 0 / 空时跳过', async () => {
    const { imported, skipped } = await importDomainTermsCsv(
      lawId,
      `${HEADER}plaintiff,原告,maybe\r\ndefendant,被告,0\r\nsuit,诉讼,\r\n`,
    );
    expect(imported).toBe(2);
    expect(skipped).toEqual([{ line: 2, reason: 'noTranslate' }]);
  });

  test('行号按文件里的物理行计：引号内换行占行，没有表头时从第 1 行数起', async () => {
    const { skipped } = await importDomainTermsCsv(
      lawId,
      'line,"第一行\n第二行",false\n,缺原词,false\n',
    );
    expect(skipped).toEqual([{ line: 3, reason: 'missingSource' }]);
  });

  test('行号在单独的 CR、引号内的 CRLF、带 BOM 时都按物理行计', async () => {
    const { skipped } = await importDomainTermsCsv(
      lawId,
      '\uFEFFsource,target,noTranslate\ra,"x\r\ny",false\r\n,缺原词,false\n',
    );
    expect(skipped).toEqual([{ line: 4, reason: 'missingSource' }]);
  });

  test('字段中间的双引号按普通字符：不吞掉后面的行', async () => {
    const { imported, skipped } = await importDomainTermsCsv(
      lawId,
      `${HEADER}5" screen,五英寸屏,false\r\nquote "x",引号,false\r\n`,
    );
    expect(imported).toBe(2);
    expect(skipped).toEqual([]);
    expect((await terms()).map((t) => t.source)).toEqual(['tort', '5" screen', 'quote "x"']);
  });

  test('引号没有闭合：从这一行起到文件结尾都跳过，前面的行照常导入', async () => {
    const { imported, skipped } = await importDomainTermsCsv(
      lawId,
      `${HEADER}plaintiff,原告,false\r\n"broken,坏,false\r\nlater,之后,false\r\n`,
    );
    expect(imported).toBe(1);
    expect(skipped).toEqual([{ line: 3, reason: 'quote' }]);
    expect((await terms()).map((t) => t.source)).toEqual(['tort', 'plaintiff']);
  });

  test('全部是错误行时不写入，原有术语不变', async () => {
    vi.mocked(chrome.storage.local.set).mockClear();
    const { imported, skipped } = await importDomainTermsCsv(lawId, `${HEADER},x,false\r\n`);
    expect(imported).toBe(0);
    expect(skipped).toEqual([{ line: 2, reason: 'missingSource' }]);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(await terms()).toEqual([{ source: 'tort', target: '侵权' }]);
  });
});

describe('术语 CSV 导入的规模（#404）', () => {
  const N = 5000;
  const big = () =>
    HEADER +
    Array.from({ length: N }, (_, i) =>
      i % 2 ? `term-${i},"译法 ${i}, 含逗号",false\r\n` : `"term, ${i}",,true\r\n`,
    ).join('');

  test('5000 条术语导入后可正常读取与保存', async () => {
    const { imported, skipped } = await importDomainTermsCsv(lawId, big());
    expect(imported).toBe(N);
    expect(skipped).toEqual([]);

    const list = await terms();
    expect(list).toHaveLength(N + 1);
    expect(list[1]).toEqual({ source: 'term, 0', noTranslate: true });
    expect(list[N]).toEqual({ source: `term-${N - 1}`, target: `译法 ${N - 1}, 含逗号` });

    // 在此基础上再保存一次整表
    await setDomainTerms(lawId, [...list, { source: 'extra', target: '额外' }]);
    expect(await terms()).toHaveLength(N + 2);
  });

  test('导入大量术语后，通用设置仍能正常保存', async () => {
    await importDomainTermsCsv(lawId, big());
    await settingsReady();
    await patchSettings({ to: 'ja' });
    expect(getSettings().to).toBe('ja');
    // 术语不占通用设置所在的同步存储
    const syncWrites = vi.mocked(chrome.storage.sync.set).mock.calls.map((c) => Object.keys(c[0]));
    expect(syncWrites.flat()).not.toContain('pt-domains');
  });
});
