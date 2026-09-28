/**
 * storage/domains.ts — “以后在此站点都使用”（#401）
 *
 * 内置数据换成可变的测试数据，改动它来模拟一次扩展升级。只断言外部
 * 可观察的行为：领域的适用网址、生效领域列表里其他领域的内容、加入后
 * 按列表顺序判定的当前领域。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { Domain } from '~/src/storage/domains';
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
  setDomainSites,
  moveDomain,
  rememberDomainForSite,
  InvalidSitesError,
  DomainNotFoundError,
} from '~/src/storage/domains';

const DEV = 'builtin:dev';

/** 当前版本的内置领域。 */
function release(sites: string[]): void {
  builtin = [
    { id: DEV, name: '软件开发', targetLang: 'zh-CN', sites, origin: 'builtin', terms: [] },
  ];
}

async function sitesOf(id: string): Promise<string[]> {
  return (await getEffectiveDomains()).find((d) => d.id === id)!.sites;
}

beforeEach(() => {
  resetStorage();
  release(['github.com']);
});

describe('以后在此站点都使用（#401）', () => {
  test('自建领域：站点的裸域名追加到适用网址，www. 前缀去掉', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainSites(law.id, ['example.com']);

    const { current } = await rememberDomainForSite(law.id, 'www.Law.Example.org');
    expect(await sitesOf(law.id)).toEqual(['example.com', 'law.example.org']);
    expect(current?.id).toBe(law.id);
  });

  test('内置领域：写入叠加层，升级后保留，新版的内置网址照常生效', async () => {
    await rememberDomainForSite(DEV, 'gitee.com');
    expect(await sitesOf(DEV)).toEqual(['github.com', 'gitee.com']);

    release(['github.com', 'gitlab.com']);
    expect(await sitesOf(DEV)).toEqual(['github.com', 'gitlab.com', 'gitee.com']);
  });

  test('内置领域：用户删掉过的内置网址重新加回', async () => {
    await setDomainSites(DEV, []);
    await rememberDomainForSite(DEV, 'github.com');
    expect(await sitesOf(DEV)).toEqual(['github.com']);
  });

  test('原先命中这个站点的其他领域不被修改', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const before = (await getEffectiveDomains()).find((d) => d.id === DEV);

    await rememberDomainForSite(law.id, 'github.com');
    expect((await getEffectiveDomains()).find((d) => d.id === DEV)).toEqual(before);
  });

  test('排在前面的领域也命中时，返回的当前领域是它；调整顺序后才是目标领域', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });

    const first = await rememberDomainForSite(law.id, 'github.com');
    expect(first.current?.id).toBe(DEV);

    await moveDomain(law.id, 'up');
    const again = await rememberDomainForSite(law.id, 'github.com');
    expect(again.current?.id).toBe(law.id);
  });

  test('适用网址已命中这个站点时不写入', async () => {
    vi.mocked(chrome.storage.local.set).mockClear();
    const { current } = await rememberDomainForSite(DEV, 'docs.github.com');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(await sitesOf(DEV)).toEqual(['github.com']);
    expect(current?.id).toBe(DEV);
  });

  test('站点不是合法的网址条目时抛 InvalidSitesError，不写入', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    for (const host of ['', 'bad_host', '[::1]']) {
      await expect(rememberDomainForSite(law.id, host)).rejects.toBeInstanceOf(InvalidSitesError);
    }
    expect(await sitesOf(law.id)).toEqual([]);
  });

  test('领域不存在时抛 DomainNotFoundError', async () => {
    await expect(rememberDomainForSite('user:missing', 'example.com')).rejects.toBeInstanceOf(
      DomainNotFoundError,
    );
  });
});
