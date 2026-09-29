/**
 * storage/specialization.ts — 存储空间不足时的写入失败（#523）
 *
 * 模拟 storage.local 的写入抛出配额错误。只断言外部可观察的行为：
 * 保存、停用开关、删除、导入都抛 StorageQuotaError（原因提示可以清空
 * 翻译缓存），存储与生效站点页面规则原样不变；其他写入错误照旧抛出原错误。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';

type Spec = typeof import('~/src/storage/specialization');

let spec: Spec;
// 与 spec 同一次模块加载，instanceof 才成立
let StorageQuotaError: typeof import('~/src/storage/quota').StorageQuotaError;

beforeEach(async () => {
  resetStorage();
  vi.resetModules();
  spec = await import('~/src/storage/specialization');
  ({ StorageQuotaError } = await import('~/src/storage/quota'));
  await spec.saveUserSiteRules('example.com', { exclude: ['.ad'] });
  await spec.saveUserSiteRules('github.com', { scope: ['main'] });
});

const file = JSON.stringify({
  format: 'parallel-translation-site-rules',
  version: 1,
  sites: { 'example.org': { scope: [], exclude: ['.x'], preserve: [], disableBuiltin: false } },
});

const writes: [string, () => Promise<unknown>][] = [
  ['保存站点卡片', () => spec.saveUserSiteRules('example.com', { exclude: ['.b'] })],
  ['停用内置规则', () => spec.setBuiltinSiteRulesDisabled('github.com', true)],
  ['删除站点卡片', () => spec.deleteUserSiteRules('example.com')],
  ['导入 JSON', () => spec.importUserSiteRules(file)],
];

const quotaErrors: [string, unknown][] = [
  ['Chrome', new Error('QUOTA_BYTES quota exceeded')],
  ['Firefox', new DOMException('The current transaction exceeded its quota limitations.', 'QuotaExceededError')],
];

describe('存储空间不足（#523）', () => {
  describe.each(quotaErrors)('%s 的配额错误', (_, quota) => {
    test.each(writes)('%s：抛 StorageQuotaError，原因提示清空翻译缓存，存储不变', async (_, write) => {
      const cards = await spec.getUserSiteRules();
      const before = structuredClone(localStoreSnapshot());
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(quota);

      const err = (await write().catch((e: unknown) => e)) as Error;
      expect(err).toBeInstanceOf(StorageQuotaError);
      expect(err.message).toContain('清空翻译缓存');
      expect(err.cause).toBe(quota);
      expect(localStoreSnapshot()).toEqual(before);
      expect(await spec.getUserSiteRules()).toEqual(cards);
      await spec.siteRulesReady();
      expect(spec.getSiteRules('example.com').exclude).toEqual(['.ad']);
    });
  });

  test('不是配额错误的写入失败照旧抛出原错误', async () => {
    const other = new Error('[PT] 存储配额已满');
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(other);
    await expect(spec.saveUserSiteRules('example.com', {})).rejects.toBe(other);
  });

  test('失败的写入不影响之后的写入', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await expect(spec.saveUserSiteRules('example.net', {})).rejects.toBeInstanceOf(StorageQuotaError);
    await spec.saveUserSiteRules('example.net', { exclude: ['.n'] });
    expect((await spec.getUserSiteRules()).map((u) => u.site)).toEqual([
      'example.com',
      'github.com',
      'example.net',
    ]);
  });
});
