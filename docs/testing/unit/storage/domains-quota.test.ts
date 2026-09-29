/**
 * storage/domains.ts — 存储空间不足时的保存失败（#510）
 *
 * 模拟 storage.local 的写入抛出配额错误。只断言外部可观察的行为：
 * 保存失败的错误类型与可读原因（提示可以清空翻译缓存），存储原样不变；
 * 其他写入错误照旧抛出原错误。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveDomains,
  createDomain,
  setDomainTerms,
  importDomainTermsCsv,
} from '~/src/storage/domains';
import { StorageQuotaError } from '~/src/storage/quota';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';

let lawId: string;

beforeEach(async () => {
  resetStorage();
  lawId = (await createDomain({ name: '法律', targetLang: 'zh-CN' })).id;
  await setDomainTerms(lawId, [{ source: 'tort', target: '侵权' }]);
});

describe('存储空间不足（#510）', () => {
  test.each([
    ['Chrome', new Error('QUOTA_BYTES quota exceeded')],
    ['Firefox', new DOMException('The current transaction exceeded its quota limitations.', 'QuotaExceededError')],
  ])('保存术语遇到配额错误（%s）：抛 StorageQuotaError，原因提示清空翻译缓存，存储不变', async (_, quota) => {
    const before = structuredClone(localStoreSnapshot()['pt-domains']);
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(quota);

    const err = await setDomainTerms(lawId, [{ source: 'tort', target: '侵权行为' }]).catch((e) => e);
    expect(err).toBeInstanceOf(StorageQuotaError);
    expect(err.message).toContain('清空翻译缓存');
    expect(err.cause).toBe(quota);
    expect(localStoreSnapshot()['pt-domains']).toEqual(before);
    expect((await getEffectiveDomains()).find((d) => d.id === lawId)!.terms).toEqual([
      { source: 'tort', target: '侵权' },
    ]);
  });

  test('导入术语 CSV 遇到配额错误：同样抛 StorageQuotaError', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await expect(importDomainTermsCsv(lawId, 'plaintiff,原告,false\r\n')).rejects.toBeInstanceOf(
      StorageQuotaError,
    );
  });

  test('新建领域遇到配额错误：同样抛 StorageQuotaError', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await expect(createDomain({ name: '医学', targetLang: 'zh-CN' })).rejects.toBeInstanceOf(
      StorageQuotaError,
    );
  });

  test('不是配额错误的写入失败照旧抛出原错误', async () => {
    const other = new Error('[PT] 存储配额已满');
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(other);
    await expect(setDomainTerms(lawId, [])).rejects.toBe(other);
  });
});
