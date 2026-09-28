/**
 * storage/domains.ts — 读取失败时写入不落盘 单元测试（#484）
 *
 * 只断言外部可观察的行为：存储读取失败时各写操作抛错、存储里原有的
 * 自建领域、叠加层与顺序保持原样，恢复读取后生效领域列表与之前一致；
 * 存储里本来没有数据时照常写入。读取路径退回只有内置领域、不抛错的
 * 用例见 domains.test.ts。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveDomains,
  createDomain,
  deleteDomain,
  moveDomain,
  setDomainSites,
  setDomainTerms,
  resetBuiltinDomain,
  DomainNotFoundError,
} from '~/src/storage/domains';
import { resetStorage, localStoreSnapshot } from '~/docs/testing/setup';

const BUILTIN = 'builtin:software-zh-CN';

let userId: string;

beforeEach(async () => {
  resetStorage();
  // 自建领域、内置领域的叠加层与调整过的顺序都有
  const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
  userId = law.id;
  await setDomainSites(law.id, ['example.com']);
  await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
  await setDomainSites(BUILTIN, ['github.com', 'example.org']);
  await moveDomain(law.id, 'up');
  vi.mocked(chrome.storage.local.set).mockClear();
});

describe('读取存储失败时写操作不落盘（#484）', () => {
  const writes: [string, () => Promise<unknown>][] = [
    ['新建领域', () => createDomain({ name: '医学', targetLang: 'zh-CN' })],
    ['删除自建领域', () => deleteDomain(userId)],
    ['调整顺序', () => moveDomain(userId, 'down')],
    ['保存自建领域的适用网址', () => setDomainSites(userId, ['example.net'])],
    ['保存自建领域的术语', () => setDomainTerms(userId, [{ source: 'plaintiff', target: '原告' }])],
    ['保存内置领域的适用网址', () => setDomainSites(BUILTIN, ['gitlab.com'])],
    ['保存内置领域的术语', () => setDomainTerms(BUILTIN, [{ source: 'monorepo', target: '单仓库' }])],
    ['恢复默认', () => resetBuiltinDomain(BUILTIN)],
  ];

  test.each(writes)('%s：抛错，存储原样，恢复读取后列表与之前一致', async (_, write) => {
    const before = await getEffectiveDomains();
    const snapshot = structuredClone(localStoreSnapshot());

    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    const err = await write().then(() => null, (e: unknown) => e);

    // 不能误报成“领域不存在”：设置页会据此提示已被删除并刷新列表
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DomainNotFoundError);
    expect((err as Error).message).toBe('[PT] 读取领域数据失败，未作改动');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(localStoreSnapshot()).toEqual(snapshot);
    expect(await getEffectiveDomains()).toEqual(before);
  });

  test('失败的写入不影响之后的写入', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    await expect(createDomain({ name: '医学', targetLang: 'zh-CN' })).rejects.toThrow();

    const med = await createDomain({ name: '医学', targetLang: 'zh-CN' });
    const names = (await getEffectiveDomains()).map((d) => d.name);
    expect(names).toContain('法律');
    expect(names).toContain(med.name);
  });

  test('存储里本来没有数据（首次使用）不算失败，照常写入', async () => {
    resetStorage();
    const med = await createDomain({ name: '医学', targetLang: 'zh-CN' });
    expect((await getEffectiveDomains()).map((d) => d.id)).toContain(med.id);
  });
});
