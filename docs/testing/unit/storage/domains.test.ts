/**
 * storage/domains.ts — 领域存储与当前领域解析 单元测试（#379）
 *
 * 只断言外部可观察的行为：生效领域列表的内容、给定网址与目标语言时
 * 解析出的当前领域；自建领域的新建、删除与存放位置（#391）；自建领域
 * 适用网址的编辑（#392）；自建领域术语的编辑（#393）；生效领域列表的
 * 变更订阅（#417）。内置领域叠加层见
 * domains-builtin-overlay.test.ts（#395）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveDomains,
  currentDomain,
  createDomain,
  deleteDomain,
  onDomainsChanged,
  watchEffectiveDomains,
  setDomainSites,
  setDomainTerms,
  DomainNotFoundError,
} from '~/src/storage/domains';
import { resetStorage, fireStorageChange } from '~/docs/testing/setup';
import type { Domain } from '~/src/storage/domains';

function domain(id: string, sites: string[], targetLang = 'zh-CN'): Domain {
  return { id, name: id, targetLang, sites, terms: [], origin: 'user' };
}

beforeEach(() => {
  resetStorage();
});

describe('getEffectiveDomains — 生效领域列表', () => {
  test('只含内置领域「软件开发(简体中文)」', async () => {
    const domains = await getEffectiveDomains();
    expect(domains).toHaveLength(1);
    const [dev] = domains;
    expect(dev!.origin).toBe('builtin');
    expect(dev!.name).toBe('软件开发(简体中文)');
    expect(dev!.targetLang).toBe('zh-CN');
    expect(dev!.sites).toEqual(expect.arrayContaining(['github.com', 'gitlab.com']));
    expect(dev!.terms.length).toBeGreaterThan(0);
  });

  test('内置术语：「不翻译」无需译法，其余都给出译法', async () => {
    const [dev] = await getEffectiveDomains();
    for (const t of dev!.terms) {
      expect(t.source.trim()).not.toBe('');
      if (!t.noTranslate) expect(t.target?.trim()).toBeTruthy();
    }
    expect(dev!.terms.find((t) => t.source === 'issue')?.noTranslate).toBe(true);
  });

  test('调用方改动返回值不影响下一次读取', async () => {
    const first = await getEffectiveDomains();
    first[0]!.sites.push('example.com');
    first[0]!.terms.length = 0;
    const second = await getEffectiveDomains();
    expect(second[0]!.sites).not.toContain('example.com');
    expect(second[0]!.terms.length).toBeGreaterThan(0);
  });
});

describe('currentDomain — 当前领域解析', () => {
  test('内置领域在 github.com 与其子域上命中', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'github.com', 'zh-CN')?.id).toBe(domains[0]!.id);
    expect(currentDomain(domains, 'gist.github.com', 'zh-CN')?.id).toBe(domains[0]!.id);
    expect(currentDomain(domains, 'www.gitlab.com', 'zh-CN')?.id).toBe(domains[0]!.id);
  });

  test('网址未命中任何领域 → null', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'example.com', 'zh-CN')).toBeNull();
  });

  test('沿用站点名单的裸域名语义：IP 只做精确匹配', () => {
    const domains = [domain('lan', ['192.168.1.1'])];
    expect(currentDomain(domains, '192.168.1.1', 'zh-CN')?.id).toBe('lan');
    expect(currentDomain(domains, '10.192.168.1.1', 'zh-CN')).toBeNull();
  });

  test('多个领域同时命中 → 取列表中第一个', () => {
    const domains = [
      domain('a', ['example.com']),
      domain('b', ['docs.example.com']),
    ];
    expect(currentDomain(domains, 'docs.example.com', 'zh-CN')?.id).toBe('a');
    expect(currentDomain([...domains].reverse(), 'docs.example.com', 'zh-CN')?.id).toBe('b');
  });

  test('目标语言与领域不一致 → 不启用该领域', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'github.com', 'ja')).toBeNull();
    expect(currentDomain(domains, 'github.com', 'zh-TW')).toBeNull();
  });

  test('语言不一致的领域被跳过，继续取后面命中且语言一致的领域', () => {
    const domains = [
      domain('zh', ['github.com'], 'zh-CN'),
      domain('ja', ['github.com'], 'ja'),
    ];
    expect(currentDomain(domains, 'github.com', 'ja')?.id).toBe('ja');
  });

  test('语言码比对不区分大小写', () => {
    const domains = [domain('zh', ['github.com'], 'zh-CN')];
    expect(currentDomain(domains, 'github.com', 'zh-cn')?.id).toBe('zh');
  });
});

describe('新建与删除自建领域（#391）', () => {
  test('新建的领域出现在生效领域列表里，排在内置领域之后', async () => {
    const created = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    expect(created).toMatchObject({
      name: '法律',
      targetLang: 'zh-CN',
      sites: [],
      terms: [],
      origin: 'user',
    });
    const domains = await getEffectiveDomains();
    expect(domains.map((d) => d.origin)).toEqual(['builtin', 'user']);
    expect(domains[1]).toEqual(created);
  });

  test('名称去掉首尾空格；多个自建领域按新建顺序排列、ID 互不相同', async () => {
    const a = await createDomain({ name: '  法律  ', targetLang: 'zh-CN' });
    const b = await createDomain({ name: '医学', targetLang: 'ja' });
    expect(a.name).toBe('法律');
    expect(a.id).not.toBe(b.id);
    const domains = await getEffectiveDomains();
    expect(domains.slice(1).map((d) => d.name)).toEqual(['法律', '医学']);
    expect(domains.every((d, i) => domains.findIndex((x) => x.id === d.id) === i)).toBe(true);
  });

  test('名称或目标语言为空 → 拒绝新建，列表不变', async () => {
    await expect(createDomain({ name: '   ', targetLang: 'zh-CN' })).rejects.toThrow();
    await expect(createDomain({ name: '法律', targetLang: '' })).rejects.toThrow();
    expect(await getEffectiveDomains()).toHaveLength(1);
  });

  test('自建领域存放在 storage.local，不占 storage.sync', async () => {
    await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const local = await chrome.storage.local.get(null);
    const sync = await chrome.storage.sync.get(null);
    expect(JSON.stringify(local)).toContain('法律');
    expect(JSON.stringify(sync)).not.toContain('法律');
  });

  test('删除自建领域后不再出现在生效领域列表里', async () => {
    const a = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const b = await createDomain({ name: '医学', targetLang: 'zh-CN' });
    await deleteDomain(a.id);
    const domains = await getEffectiveDomains();
    expect(domains.map((d) => d.id)).not.toContain(a.id);
    expect(domains.map((d) => d.id)).toContain(b.id);
  });

  test('内置领域不能删除', async () => {
    const [dev] = await getEffectiveDomains();
    await expect(deleteDomain(dev!.id)).rejects.toThrow();
    expect((await getEffectiveDomains())[0]!.id).toBe(dev!.id);
  });

  test('删除不存在的领域不报错，列表不变', async () => {
    await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await deleteDomain('user:missing');
    expect(await getEffectiveDomains()).toHaveLength(2);
  });

  test('存储里的脏数据被忽略，不影响内置领域', async () => {
    await chrome.storage.local.set({ 'pt-domains': { user: [{ id: 1 }, null, 'x'] } });
    const domains = await getEffectiveDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0]!.origin).toBe('builtin');
  });

  test('连续新建不会互相覆盖', async () => {
    await Promise.all([
      createDomain({ name: '甲', targetLang: 'zh-CN' }),
      createDomain({ name: '乙', targetLang: 'zh-CN' }),
      createDomain({ name: '丙', targetLang: 'zh-CN' }),
    ]);
    const names = (await getEffectiveDomains()).slice(1).map((d) => d.name);
    expect(names).toEqual(['甲', '乙', '丙']);
  });

  test('存储里与内置领域同 ID 的条目被忽略', async () => {
    const [dev] = await getEffectiveDomains();
    await chrome.storage.local.set({
      'pt-domains': { user: [{ ...dev!, name: '冒名', origin: 'user' }] },
    });
    const domains = await getEffectiveDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0]!.name).toBe(dev!.name);
  });

  test('读取存储失败时只剩内置领域，不抛错', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('boom'));
    const domains = await getEffectiveDomains();
    expect(domains.map((d) => d.origin)).toEqual(['builtin']);
  });

  test('领域数据变更时通知订阅者，其他键的变更不通知', () => {
    const fn = vi.fn();
    const off = onDomainsChanged(fn);
    fireStorageChange({ 'pt-cache-index': { newValue: [] } }, 'local');
    fireStorageChange({ 'pt-domains': { newValue: { user: [] } } }, 'sync');
    expect(fn).not.toHaveBeenCalled();
    fireStorageChange({ 'pt-domains': { newValue: { user: [] } } }, 'local');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    fireStorageChange({ 'pt-domains': { newValue: { user: [] } } }, 'local');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('编辑自建领域的适用网址（#392）', () => {
  test('保存后该领域在匹配站点上成为当前领域', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    expect(currentDomain(await getEffectiveDomains(), 'law.example.com', 'zh-CN')).toBeNull();

    await setDomainSites(law.id, ['example.com']);
    const domains = await getEffectiveDomains();
    expect(domains.find((d) => d.id === law.id)!.sites).toEqual(['example.com']);
    expect(currentDomain(domains, 'law.example.com', 'zh-CN')?.id).toBe(law.id);
    expect(currentDomain(domains, 'other.org', 'zh-CN')).toBeNull();
  });

  test('多个领域都命中时，列表顺序靠前的优先', async () => {
    const a = await createDomain({ name: '甲', targetLang: 'zh-CN' });
    const b = await createDomain({ name: '乙', targetLang: 'zh-CN' });
    await setDomainSites(b.id, ['example.com']);
    await setDomainSites(a.id, ['example.com']);
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'example.com', 'zh-CN')?.id).toBe(a.id);
  });

  test('去掉首尾空格与空行、转小写、去重', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const saved = await setDomainSites(law.id, ['  Example.COM ', '', 'example.com', 'law.gov.cn']);
    expect(saved.sites).toEqual(['example.com', 'law.gov.cn']);
    expect((await getEffectiveDomains()).find((d) => d.id === law.id)!.sites).toEqual(saved.sites);
  });

  test('可以清空适用网址', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainSites(law.id, ['example.com']);
    await setDomainSites(law.id, ['', '  ']);
    expect((await getEffectiveDomains()).find((d) => d.id === law.id)!.sites).toEqual([]);
  });

  test('非法域名格式 → 拒绝保存，报出不合法的条目，原网址不变', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainSites(law.id, ['example.com']);
    await expect(
      setDomainSites(law.id, ['ok.com', 'https://github.com/foo', 'not a domain', 'not a domain']),
    ).rejects.toMatchObject({ invalid: ['https://github.com/foo', 'not a domain'] });
    expect((await getEffectiveDomains()).find((d) => d.id === law.id)!.sites).toEqual(['example.com']);
  });


  test('领域不存在 → 抛 DomainNotFoundError，不新建领域', async () => {
    await expect(setDomainSites('user:missing', ['example.com'])).rejects.toBeInstanceOf(
      DomainNotFoundError,
    );
    expect(await getEffectiveDomains()).toHaveLength(1);
  });

  test('领域已在别处被删除 → 保存适用网址抛 DomainNotFoundError（#430）', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await deleteDomain(law.id);
    await expect(setDomainSites(law.id, ['example.com'])).rejects.toBeInstanceOf(
      DomainNotFoundError,
    );
    expect((await getEffectiveDomains()).some((d) => d.id === law.id)).toBe(false);
  });
});

describe('适用网址支持 localhost 与 IPv4（#431）', () => {
  test('保存 localhost 与 IPv4 后，在这些主机上该领域成为当前领域', async () => {
    const dev = await createDomain({ name: '本地', targetLang: 'zh-CN' });
    const saved = await setDomainSites(dev.id, ['localhost', ' 192.168.1.10 ', '127.0.0.1']);
    expect(saved.sites).toEqual(['localhost', '192.168.1.10', '127.0.0.1']);

    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'localhost', 'zh-CN')?.id).toBe(dev.id);
    expect(currentDomain(domains, '192.168.1.10', 'zh-CN')?.id).toBe(dev.id);
    expect(currentDomain(domains, '127.0.0.1', 'zh-CN')?.id).toBe(dev.id);
  });

  test('IP 只做精确匹配', async () => {
    const lan = await createDomain({ name: '内网', targetLang: 'zh-CN' });
    await setDomainSites(lan.id, ['192.168.1.10']);
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, '192.168.1.11', 'zh-CN')).toBeNull();
    expect(currentDomain(domains, '10.192.168.1.10', 'zh-CN')).toBeNull();
  });

  test('非法 IP、带端口、协议或路径的输入 → 拒绝保存并报出这些条目', async () => {
    const dev = await createDomain({ name: '本地', targetLang: 'zh-CN' });
    const bad = [
      '999.1.1.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      'localhost:3000',
      '192.168.1.10:8080',
      'http://localhost',
      'https://192.168.1.10',
      'localhost/admin',
      '192.168.1.10/app',
    ];
    await expect(setDomainSites(dev.id, ['localhost', ...bad])).rejects.toMatchObject({
      invalid: bad,
    });
    expect((await getEffectiveDomains()).find((d) => d.id === dev.id)!.sites).toEqual([]);
  });
});

describe('编辑自建领域的术语（#393）', () => {
  async function termsOf(id: string) {
    return (await getEffectiveDomains()).find((d) => d.id === id)!.terms;
  }

  test('保存后术语出现在生效领域列表里：新增、修改、删除都是整体替换', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [
      { source: 'plaintiff', target: '原告' },
      { source: 'defendant', target: '被告' },
    ]);
    expect(await termsOf(law.id)).toEqual([
      { source: 'plaintiff', target: '原告' },
      { source: 'defendant', target: '被告' },
    ]);

    // 改一行、删一行、加一行
    await setDomainTerms(law.id, [
      { source: 'plaintiff', target: '起诉方' },
      { source: 'tort', target: '侵权' },
    ]);
    expect(await termsOf(law.id)).toEqual([
      { source: 'plaintiff', target: '起诉方' },
      { source: 'tort', target: '侵权' },
    ]);
  });

  test('勾选“不翻译”后不需要译法，填了也不保存', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const saved = await setDomainTerms(law.id, [
      { source: 'GDPR', noTranslate: true },
      { source: 'HIPAA', target: '随便', noTranslate: true },
    ]);
    expect(saved.terms).toEqual([
      { source: 'GDPR', noTranslate: true },
      { source: 'HIPAA', noTranslate: true },
    ]);
    expect(await termsOf(law.id)).toEqual(saved.terms);
  });

  test('勾选“不翻译”、原词为空的行丢弃，残留的译法不算缺原词', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const saved = await setDomainTerms(law.id, [
      { source: 'tort', target: '侵权' },
      { source: '', target: '残留', noTranslate: true },
    ]);
    expect(saved.terms).toEqual([{ source: 'tort', target: '侵权' }]);
  });

  test('去掉首尾空格；原词与译法都为空的行丢弃', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const saved = await setDomainTerms(law.id, [
      { source: '  plaintiff ', target: ' 原告 ' },
      { source: ' ', target: '' },
    ]);
    expect(saved.terms).toEqual([{ source: 'plaintiff', target: '原告' }]);
  });

  test('同一领域内原词重复（不区分大小写）→ 拒绝保存，报出重复的原词', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    await expect(
      setDomainTerms(law.id, [
        { source: 'Plaintiff', target: '原告' },
        { source: 'tort', target: '侵权' },
        { source: 'plaintiff ', noTranslate: true },
        { source: 'PLAINTIFF', target: '原告' },
      ]),
    ).rejects.toMatchObject({ duplicates: ['plaintiff'] });
    expect(await termsOf(law.id)).toEqual([{ source: 'tort', target: '侵权' }]);
  });

  test('没勾选“不翻译”也没填译法、或只填了译法 → 拒绝保存，报出这些行', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await expect(
      setDomainTerms(law.id, [
        { source: 'tort', target: '侵权' },
        { source: 'plaintiff', target: '  ' },
        { source: '', target: '被告' },
      ]),
    ).rejects.toMatchObject({ missingTarget: ['plaintiff'], missingSource: ['被告'] });
    expect(await termsOf(law.id)).toEqual([]);
  });

  test('领域不存在时抛 DomainNotFoundError', async () => {
    await expect(setDomainTerms('user:missing', [])).rejects.toBeInstanceOf(DomainNotFoundError);
  });

  test('领域已在别处被删除 → 保存术语抛 DomainNotFoundError，不复活该领域（#430）', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await deleteDomain(law.id);
    await expect(
      setDomainTerms(law.id, [{ source: 'plaintiff', target: '原告' }]),
    ).rejects.toBeInstanceOf(DomainNotFoundError);
    expect((await getEffectiveDomains()).some((d) => d.id === law.id)).toBe(false);
  });

  test('只改术语不影响名称、目标语言与适用网址', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainSites(law.id, ['example.com']);
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);
    const saved = (await getEffectiveDomains()).find((d) => d.id === law.id)!;
    expect(saved).toMatchObject({ name: '法律', targetLang: 'zh-CN', sites: ['example.com'] });
  });
});

describe('生效领域列表的变更订阅（#417）', () => {
  /** 模拟另一个上下文（设置页）改完领域后的存储变更事件。 */
  async function changedElsewhere(): Promise<void> {
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    await new Promise((r) => setTimeout(r, 0));
  }

  test('领域变更后交付新的生效领域列表，新领域可成为当前领域', async () => {
    const fn = vi.fn();
    watchEffectiveDomains(fn);
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainSites(law.id, ['example.com']);
    await changedElsewhere();

    const latest = fn.mock.lastCall![0] as Domain[];
    expect(latest.map((d) => d.id)).toContain(law.id);
    expect(currentDomain(latest, 'example.com', 'zh-CN')?.id).toBe(law.id);
  });

  test('删除领域后交付的列表里不再有它', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const fn = vi.fn();
    watchEffectiveDomains(fn);
    await deleteDomain(law.id);
    await changedElsewhere();

    expect((fn.mock.lastCall![0] as Domain[]).map((d) => d.id)).not.toContain(law.id);
  });

  test('读取还没完成又发生变更 → 只交付最后一次读取的结果', async () => {
    await createDomain({ name: '法律', targetLang: 'zh-CN' });
    const fn = vi.fn();
    watchEffectiveDomains(fn);
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    await new Promise((r) => setTimeout(r, 0));

    expect(fn).toHaveBeenCalledTimes(1);
    expect((fn.mock.lastCall![0] as Domain[]).some((d) => d.name === '法律')).toBe(true);
  });

  test('取消订阅后不再交付，也不再占用存储监听器', async () => {
    const fn = vi.fn();
    const off = watchEffectiveDomains(fn);
    const added = vi.mocked(chrome.storage.onChanged.addListener).mock.lastCall![0];
    off();
    await changedElsewhere();

    expect(fn).not.toHaveBeenCalled();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(added);
  });

  test('变更事件发出后、读取完成前取消订阅 → 不交付', async () => {
    const fn = vi.fn();
    const off = watchEffectiveDomains(fn);
    fireStorageChange({ 'pt-domains': { newValue: {} } }, 'local');
    off();
    await new Promise((r) => setTimeout(r, 0));

    expect(fn).not.toHaveBeenCalled();
  });
});
