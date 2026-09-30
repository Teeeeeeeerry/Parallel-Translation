/**
 * storage/specialization.ts — 读取失败时写入不落盘 单元测试（#508）
 *
 * 只断言外部可观察的行为：存储读取失败时保存、停用开关、删除、导入都
 * 抛错，存储里原有的站点卡片保持原样，恢复读取后站点卡片与生效站点
 * 页面规则与之前一致；存储里本来没有数据时照常写入；读取路径退回只有
 * 内置规则、不抛错。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';

type Spec = typeof import('~/src/storage/specialization');

let spec: Spec;
let StorageReadError: typeof import('~/src/storage/read-error').StorageReadError;

beforeEach(async () => {
  resetStorage();
  vi.resetModules();
  spec = await import('~/src/storage/specialization');
  ({ StorageReadError } = await import('~/src/storage/read-error'));
  await spec.saveUserSiteRules('example.com', { exclude: ['.ad'], preserve: ['code'] });
  await spec.saveUserSiteRules('github.com', { scope: ['main'] });
  await spec.setBuiltinSiteRulesDisabled('github.com', true);
  vi.mocked(chrome.storage.local.set).mockClear();
});

const file = JSON.stringify({
  format: 'parallel-translation-site-rules',
  version: 1,
  sites: { 'example.org': { scope: [], exclude: ['.x'], preserve: [], disableBuiltin: false } },
});

describe('读取存储失败时写操作不落盘（#508）', () => {
  const writes: [string, () => Promise<unknown>][] = [
    ['保存已有的站点卡片', () => spec.saveUserSiteRules('example.com', { exclude: ['.b'] })],
    ['新增站点卡片', () => spec.saveUserSiteRules('example.net', {})],
    ['打开停用内置规则', () => spec.setBuiltinSiteRulesDisabled('youtube.com', true)],
    ['关闭停用内置规则', () => spec.setBuiltinSiteRulesDisabled('github.com', false)],
    ['删除站点卡片', () => spec.deleteUserSiteRules('example.com')],
    ['导入 JSON', () => spec.importUserSiteRules(file)],
  ];

  test.each(writes)('%s：抛错，存储原样，恢复读取后规则与之前一致', async (_, write) => {
    const cards = await spec.getUserSiteRules();
    const snapshot = structuredClone(localStoreSnapshot());

    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    const err = await write().then(() => null, (e: unknown) => e);
    expect((err as Error).message).toBe('[PT] 读取站点规则失败，未作改动');

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(localStoreSnapshot()).toEqual(snapshot);
    expect(await spec.getUserSiteRules()).toEqual(cards);
    await spec.siteRulesReady();
    expect(spec.getSiteRules('example.com').exclude).toEqual(['.ad']);
    expect(spec.getSiteRules('github.com')).toEqual({ scope: ['main'], exclude: [], preserve: [] });
  });

  test('失败的写入不影响之后的写入', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    await expect(spec.saveUserSiteRules('example.net', {})).rejects.toThrow();

    await spec.saveUserSiteRules('example.net', { exclude: ['.n'] });
    expect((await spec.getUserSiteRules()).map((u) => u.site)).toEqual([
      'example.com',
      'github.com',
      'example.net',
    ]);
  });

  test('存储里本来没有数据（首次使用）不算失败，照常写入', async () => {
    resetStorage();
    await spec.saveUserSiteRules('example.net', { exclude: ['.n'] });
    expect(await spec.getUserSiteRules()).toEqual([{ site: 'example.net', exclude: ['.n'] }]);
  });
});

describe('读取存储失败时翻译路径照常（#508）', () => {
  test('载入快照时读取失败 → 不抛错，只剩内置规则', async () => {
    vi.resetModules();
    const page = await import('~/src/storage/specialization');
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    await expect(page.siteRulesReady()).resolves.toBeUndefined();
    expect(page.getSiteRules('example.com').exclude).toEqual([]);
    expect(page.getSiteRules('github.com').exclude).toContain('.blob-code');
  });
});

describe('读取存储失败时设置页的读取报错（#526）', () => {
  const reads: [string, () => Promise<unknown>][] = [
    ['站点卡片列表', () => spec.getUserSiteRules()],
    ['导出 JSON', () => spec.exportUserSiteRules()],
  ];

  test.each(reads)('%s：抛出读取失败的原因，恢复读取后结果与之前一致', async (_, read) => {
    const before = await read();

    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    // 只读不改动数据：原因只说读不到，不说“未作改动”（#537）
    const err = await read().then(() => null, (e: unknown) => e);
    expect((err as Error).message).toBe('[PT] 暂时读不到存储里的数据，请稍后重试');
    // 两个存储模块共用同一个读取失败错误（#549）
    expect(err).toBeInstanceOf(StorageReadError);

    expect(await read()).toEqual(before);
  });

  test('导出成功时文件里是全部站点卡片', async () => {
    expect(JSON.parse(await spec.exportUserSiteRules()).sites).toEqual({
      'example.com': { scope: [], exclude: ['.ad'], preserve: ['code'], disableBuiltin: false },
      'github.com': { scope: ['main'], exclude: [], preserve: [], disableBuiltin: true },
    });
  });

  test('存储里本来没有数据不算失败：列表为空，导出的 sites 为空', async () => {
    resetStorage();
    expect(await spec.getUserSiteRules()).toEqual([]);
    expect(JSON.parse(await spec.exportUserSiteRules()).sites).toEqual({});
  });
});
