/**
 * storage/domains.ts — 内置领域叠加层：适用网址增删（#397）
 *
 * 内置数据换成可变的测试数据，改动它来模拟一次扩展升级。只断言外部
 * 可观察的行为：生效领域列表里内置领域的适用网址，以及当前领域。
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
  currentDomain,
  setDomainSites,
  setDomainTerms,
  InvalidSitesError,
} from '~/src/storage/domains';

const DEV = 'builtin:dev';

/** 当前版本的内置领域。 */
function release(sites: string[], terms: Term[] = [{ source: 'issue', noTranslate: true }]): void {
  builtin = [{ id: DEV, name: '软件开发', targetLang: 'zh-CN', sites, origin: 'builtin', terms }];
}

async function devSites(): Promise<string[]> {
  return (await getEffectiveDomains()).find((d) => d.id === DEV)!.sites;
}

beforeEach(() => {
  resetStorage();
  release(['github.com', 'gitlab.com']);
});

describe('内置领域的适用网址增删（#397）', () => {
  test('新增与删除后生效：新增的网址上成为当前领域，删掉的不再命中', async () => {
    const saved = await setDomainSites(DEV, ['github.com', 'gitee.com']);
    expect(saved.sites).toEqual(['github.com', 'gitee.com']);
    expect(await devSites()).toEqual(['github.com', 'gitee.com']);

    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'gitee.com', 'zh-CN')?.id).toBe(DEV);
    expect(currentDomain(domains, 'gitlab.com', 'zh-CN')).toBeNull();
  });

  test('升级后：删掉的内置网址不复活，新增的保留，新版新增的内置网址照常生效', async () => {
    await setDomainSites(DEV, ['github.com', 'gitee.com']);
    release(['github.com', 'gitlab.com', 'bitbucket.org']);
    expect(await devSites()).toEqual(['github.com', 'bitbucket.org', 'gitee.com']);
  });

  test('删掉的网址在某一版内置里暂时去掉、期间保存过其他改动，之后加回也不复活', async () => {
    await setDomainSites(DEV, ['github.com']);
    release(['github.com']);
    await setDomainSites(DEV, ['github.com', 'gitee.com']);
    release(['github.com', 'gitlab.com']);
    expect(await devSites()).toEqual(['github.com', 'gitee.com']);
  });

  test('新版内置加入了用户已新增的网址 → 不重复', async () => {
    await setDomainSites(DEV, ['github.com', 'gitlab.com', 'gitee.com']);
    release(['github.com', 'gitee.com', 'gitlab.com']);
    expect(await devSites()).toEqual(['github.com', 'gitee.com', 'gitlab.com']);
  });

  test('删掉后再加回内置网址 → 不再算删除，跟随内置', async () => {
    await setDomainSites(DEV, ['github.com']);
    await setDomainSites(DEV, ['github.com', 'gitlab.com']);
    expect(await devSites()).toEqual(['github.com', 'gitlab.com']);
  });

  test('校验与自建领域一致：不合法的条目拒绝保存，适用网址不变', async () => {
    await expect(setDomainSites(DEV, ['github.com', 'https://x.com'])).rejects.toBeInstanceOf(
      InvalidSitesError,
    );
    expect(await devSites()).toEqual(['github.com', 'gitlab.com']);
  });

  test('只改术语不影响适用网址的增删', async () => {
    await setDomainSites(DEV, ['gitee.com']);
    await setDomainTerms(DEV, [{ source: 'issue', target: '议题' }]);
    const dev = (await getEffectiveDomains()).find((d) => d.id === DEV)!;
    expect(dev.sites).toEqual(['gitee.com']);
    expect(dev.terms).toEqual([{ source: 'issue', target: '议题' }]);
  });

  test('只改适用网址不影响术语的修改与删除', async () => {
    release(['github.com', 'gitlab.com'], [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
    ]);
    await setDomainTerms(DEV, [{ source: 'branch', target: '支线' }]);
    await setDomainSites(DEV, ['gitee.com']);
    const dev = (await getEffectiveDomains()).find((d) => d.id === DEV)!;
    expect(dev.sites).toEqual(['gitee.com']);
    expect(dev.terms).toEqual([{ source: 'branch', target: '支线' }]);
  });

  test('增删记录存放在 storage.local；脏数据被忽略，内置网址照常生效', async () => {
    await setDomainSites(DEV, ['github.com', 'gitee.com']);
    expect(Object.keys(await chrome.storage.sync.get(null))).toEqual([]);
    expect(JSON.stringify(await chrome.storage.local.get(null))).toContain('gitee.com');

    await chrome.storage.local.set({
      'pt-domains': {
        user: [],
        builtin: {
          [DEV]: { addedSites: [42, 'https://x.com', ' GITEE.COM ', 'gitee.com'], removedSites: 'x' },
        },
      },
    });
    // 不是字符串、格式不合法的丢弃；去掉首尾空格、转小写后去重
    expect(await devSites()).toEqual(['github.com', 'gitlab.com', 'gitee.com']);
  });
});
