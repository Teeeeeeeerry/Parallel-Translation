/**
 * storage/domains.ts — 领域排序单元测试（#394）
 *
 * 只断言外部可观察的行为：上移、下移后生效领域列表的顺序，多个领域
 * 同时命中一个网址时哪个成为当前领域，顺序存放的位置。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  getEffectiveDomains,
  currentDomain,
  createDomain,
  deleteDomain,
  moveDomain,
  setDomainSites,
  DomainNotFoundError,
} from '~/src/storage/domains';
import { resetStorage } from '~/docs/testing/setup';

const ids = async () => (await getEffectiveDomains()).map((d) => d.id);

beforeEach(() => {
  resetStorage();
});

describe('领域排序（#394）', () => {
  test('两个领域同时命中时，排在前面的成为当前领域；上移后换成它', async () => {
    const [dev] = await getEffectiveDomains();
    const mine = await createDomain({ name: '我的开发', targetLang: 'zh-CN' });
    await setDomainSites(mine.id, ['github.com']);
    expect(currentDomain(await getEffectiveDomains(), 'github.com', 'zh-CN')?.id).toBe(dev!.id);

    await moveDomain(mine.id, 'up');
    expect(await ids()).toEqual([mine.id, dev!.id]);
    expect(currentDomain(await getEffectiveDomains(), 'github.com', 'zh-CN')?.id).toBe(mine.id);
  });

  test('下移与上移互逆；已在两端时再移动不变', async () => {
    const [dev] = await getEffectiveDomains();
    const a = await createDomain({ name: 'A', targetLang: 'zh-CN' });
    const b = await createDomain({ name: 'B', targetLang: 'zh-CN' });

    await moveDomain(dev!.id, 'down');
    expect(await ids()).toEqual([a.id, dev!.id, b.id]);
    await moveDomain(dev!.id, 'up');
    expect(await ids()).toEqual([dev!.id, a.id, b.id]);

    await moveDomain(dev!.id, 'up');
    await moveDomain(b.id, 'down');
    expect(await ids()).toEqual([dev!.id, a.id, b.id]);
  });

  test('返回移动后的生效领域列表', async () => {
    const [dev] = await getEffectiveDomains();
    const a = await createDomain({ name: 'A', targetLang: 'zh-CN' });
    const list = await moveDomain(a.id, 'up');
    expect(list.map((d) => d.id)).toEqual([a.id, dev!.id]);
  });

  test('调整顺序后新建的领域排在最后，删除的领域不留痕迹', async () => {
    const [dev] = await getEffectiveDomains();
    const a = await createDomain({ name: 'A', targetLang: 'zh-CN' });
    await moveDomain(a.id, 'up');
    const b = await createDomain({ name: 'B', targetLang: 'zh-CN' });
    expect(await ids()).toEqual([a.id, dev!.id, b.id]);

    await deleteDomain(a.id);
    expect(await ids()).toEqual([dev!.id, b.id]);
    await moveDomain(b.id, 'up');
    expect(await ids()).toEqual([b.id, dev!.id]);
  });

  test('顺序存放在 storage.local，不占 storage.sync', async () => {
    const a = await createDomain({ name: 'A', targetLang: 'zh-CN' });
    await moveDomain(a.id, 'up');
    const local = await chrome.storage.local.get('pt-domains');
    expect(JSON.stringify(local)).toContain(a.id);
    const sync = await chrome.storage.sync.get(null);
    expect(JSON.stringify(sync)).not.toContain(a.id);
  });

  test('存储里的顺序含已不存在的 ID 或脏数据时忽略，其余照常排序', async () => {
    const a = await createDomain({ name: 'A', targetLang: 'zh-CN' });
    const [dev] = await getEffectiveDomains();
    const stored = (await chrome.storage.local.get('pt-domains'))['pt-domains'] as object;
    await chrome.storage.local.set({
      'pt-domains': { ...stored, order: ['user:gone', 42, a.id] },
    });
    expect(await ids()).toEqual([a.id, dev!.id]);

    await chrome.storage.local.set({ 'pt-domains': { ...stored, order: 'broken' } });
    expect(await ids()).toEqual([dev!.id, a.id]);
  });

  test('领域不存在 → 抛 DomainNotFoundError，顺序不变', async () => {
    const before = await ids();
    await expect(moveDomain('user:missing', 'up')).rejects.toBeInstanceOf(DomainNotFoundError);
    expect(await ids()).toEqual(before);
  });
});
