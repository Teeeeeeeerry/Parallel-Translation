/**
 * storage/domains.ts — 术语 CSV 导出 单元测试（#402）
 *
 * 只断言外部可观察的行为：导出的 CSV 文本。带 UTF-8 BOM 与表头，列为
 * 原词、译法、不翻译，按 RFC 4180 转义含逗号、引号、换行的字段，行尾
 * CRLF；内置领域导出生效内容（含用户叠加）；领域不存在或读取失败时抛错。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  createDomain,
  setDomainTerms,
  getEffectiveDomains,
  exportDomainTermsCsv,
  DomainNotFoundError,
} from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

const BUILTIN = 'builtin:software-zh-CN';
const HEADER = '﻿source,target,noTranslate\r\n';

beforeEach(() => {
  resetStorage();
});

describe('术语 CSV 导出（#402）', () => {
  test('带 BOM 与表头，每条术语一行，不翻译列为 true / false', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [
      { source: 'tort', target: '侵权' },
      { source: 'Esq.', noTranslate: true },
    ]);

    expect(await exportDomainTermsCsv(law.id)).toBe(
      `${HEADER}tort,侵权,false\r\nEsq.,,true\r\n`,
    );
  });

  test('没有术语时只有表头', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    expect(await exportDomainTermsCsv(law.id)).toBe(HEADER);
  });

  test('含逗号、双引号、换行的字段加引号，双引号写两遍', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [
      { source: 'terms, conditions', target: '条款，条件' },
      { source: 'the "Act"', target: '“该法”' },
      { source: 'line', target: '第一行\n第二行' },
    ]);

    expect(await exportDomainTermsCsv(law.id)).toBe(
      HEADER +
        '"terms, conditions",条款，条件,false\r\n' +
        '"the ""Act""",“该法”,false\r\n' +
        'line,"第一行\n第二行",false\r\n',
    );
  });

  test('内置领域导出生效内容：用户的修改、新增、删除都体现', async () => {
    const [dev] = await getEffectiveDomains();
    const [first, second, ...rest] = dev!.terms;
    // 改第一条、删第二条、新增一条
    await setDomainTerms(BUILTIN, [
      { source: first!.source, target: '我的译法' },
      ...rest,
      { source: 'monorepo', target: '单仓库' },
    ]);

    const csv = await exportDomainTermsCsv(BUILTIN);
    const lines = csv.slice(HEADER.length).split('\r\n');
    expect(lines[0]).toBe(`${first!.source},我的译法,false`);
    expect(lines.some((l) => l.startsWith(`${second!.source},`))).toBe(false);
    expect(lines.at(-2)).toBe('monorepo,单仓库,false');
    expect(lines).toHaveLength(dev!.terms.length + 1);
  });

  test('读取存储失败时抛错，不把内置原样内容当成导出结果', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    await expect(exportDomainTermsCsv(BUILTIN)).rejects.toThrow('[PT] 读取领域数据失败');
  });

  test('领域不存在时抛 DomainNotFoundError', async () => {
    await expect(exportDomainTermsCsv('user:missing')).rejects.toBeInstanceOf(DomainNotFoundError);
  });
});
