/**
 * storage/domains.ts — 内置领域叠加层：修改与新增（#395）、删除（#396）
 *
 * 内置数据换成可变的测试数据，改动它来模拟一次扩展升级。只断言外部
 * 可观察的行为：生效领域列表里内置领域的术语。
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
  createDomain,
  setDomainTerms,
  setDomainSites,
  isBuiltinTerm,
} from '~/src/storage/domains';

const DEV = 'builtin:dev';

/** 当前版本的内置领域。 */
function release(terms: Term[]): void {
  builtin = [
    {
      id: DEV,
      name: '软件开发',
      targetLang: 'zh-CN',
      sites: ['github.com'],
      origin: 'builtin',
      terms,
    },
  ];
}

async function devTerms(): Promise<Term[]> {
  return (await getEffectiveDomains()).find((d) => d.id === DEV)!.terms;
}

beforeEach(() => {
  resetStorage();
  release([
    { source: 'issue', noTranslate: true },
    { source: 'branch', target: '分支' },
    { source: 'merge', target: '合并' },
  ]);
});

describe('修改与新增内置领域的术语', () => {
  test('修改的术语以用户为准，位置不变；新增的术语排在内置术语之后', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', target: '议题' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'fork', noTranslate: true },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'issue', target: '议题' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'fork', noTranslate: true },
    ]);
  });

  test('返回保存后的生效领域；名称、目标语言与适用网址不变', async () => {
    const saved = await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);

    expect(saved).toMatchObject({ id: DEV, name: '软件开发', targetLang: 'zh-CN', sites: ['github.com'], origin: 'builtin' });
    expect(saved.terms).toEqual(await devTerms());
  });

  test('校验与自建领域一致：原词重复（不区分大小写）→ 拒绝保存，生效内容不变', async () => {
    await expect(
      setDomainTerms(DEV, [
        { source: 'issue', noTranslate: true },
        { source: 'Issue', target: '议题' },
      ]),
    ).rejects.toMatchObject({ duplicates: ['issue'] });
    expect(await devTerms()).toEqual(builtin[0]!.terms);
  });

  test('只有当前版本内置的原词算内置术语（不区分大小写）', async () => {
    await setDomainTerms(DEV, [{ source: 'fork', noTranslate: true }]);
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });

    expect(isBuiltinTerm(DEV, 'Branch')).toBe(true);
    expect(isBuiltinTerm(DEV, 'fork')).toBe(false);
    expect(isBuiltinTerm(law.id, 'branch')).toBe(false);
  });

  test('内置领域的适用网址仍不能修改', async () => {
    await expect(setDomainSites(DEV, ['example.com'])).rejects.toThrow();
  });
});

describe('删除内置术语（#396）', () => {
  test('保存时去掉的内置术语从生效内容中消失，其余不变', async () => {
    await setDomainTerms(DEV, [
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);
  });

  test('升级后被删的术语仍不出现，即使新版改了它的译法；新版新增的内置术语照常生效', async () => {
    await setDomainTerms(DEV, [
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'Issue', target: '议题' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'commit', noTranslate: true },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'commit', noTranslate: true },
    ]);
  });

  test('删掉后再加回同一原词 → 以用户填写的为准，之后不再算删除', async () => {
    await setDomainTerms(DEV, [
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);
    await setDomainTerms(DEV, [
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'issue', target: '议题' },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'issue', target: '议题' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    // 加回的内容与内置相同：跟随新版内置
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);
    release([
      { source: 'issue', target: '事项' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);
    expect((await devTerms())[0]).toEqual({ source: 'issue', target: '事项' });
  });

  test('删除用户新增的术语：直接消失，不影响内置术语', async () => {
    await setDomainTerms(DEV, [
      ...builtin[0]!.terms,
      { source: 'fork', noTranslate: true },
    ]);
    await setDomainTerms(DEV, builtin[0]!.terms);
    expect(await devTerms()).toEqual(builtin[0]!.terms);
  });

  test('被删的术语在某一版内置里暂时去掉、期间保存过其他改动，之后加回也不复活', async () => {
    await setDomainTerms(DEV, [
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);
    release([
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);
    await setDomainTerms(DEV, [
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);
    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);
  });

  test('全部内置术语都可以删除', async () => {
    await setDomainTerms(DEV, []);
    expect(await devTerms()).toEqual([]);
  });

  test('删除记录存放在 storage.local；脏数据被忽略，内置术语照常生效', async () => {
    await setDomainTerms(DEV, [{ source: 'branch', target: '分支' }]);
    expect(Object.keys(await chrome.storage.sync.get(null))).toEqual([]);
    expect(JSON.stringify(await chrome.storage.local.get(null))).toContain('issue');

    await chrome.storage.local.set({
      'pt-domains': { user: [], builtin: { [DEV]: { terms: [], removedTerms: [42, null, ' Merge '] } } },
    });
    expect(await devTerms()).toEqual([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
    ]);

    // 同一原词既在删除记录里、又有用户填写的术语：以用户填写的为准
    await chrome.storage.local.set({
      'pt-domains': {
        user: [],
        builtin: { [DEV]: { terms: [{ source: 'merge', target: '合入' }], removedTerms: ['merge'] } },
      },
    });
    expect((await devTerms())[2]).toEqual({ source: 'merge', target: '合入' });

    await chrome.storage.local.set({
      'pt-domains': { user: [], builtin: { [DEV]: { terms: [], removedTerms: 'merge' } } },
    });
    expect(await devTerms()).toEqual(builtin[0]!.terms);
  });
});

describe('升级后（内置数据变化）', () => {
  test('用户修改的术语仍以用户为准，即使新版内置改了该词译法', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分叉' },
      { source: 'merge', target: '合并' },
    ]);

    expect((await devTerms()).find((t) => t.source === 'branch')).toEqual({
      source: 'branch',
      target: '支线',
    });
  });

  test('用户新增的术语仍在，新版新增的内置术语也生效', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'fork', noTranslate: true },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'commit', noTranslate: true },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'commit', noTranslate: true },
      { source: 'fork', noTranslate: true },
    ]);
  });

  test('用户没改过的内置术语跟随新版内置', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', target: '议题' },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分叉' },
      { source: 'merge', target: '合入' },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'issue', target: '议题' },
      { source: 'branch', target: '分叉' },
      { source: 'merge', target: '合入' },
    ]);
  });

  test('改回与内置相同的术语不再算用户修改，之后跟随新版内置', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分叉' },
      { source: 'merge', target: '合并' },
    ]);

    expect((await devTerms()).find((t) => t.source === 'branch')!.target).toBe('分叉');
  });

  test('用户改过的术语在新版内置里被删掉 → 作为新增照常生效，排在最后', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '支线' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'merge', target: '合并' },
    ]);

    expect(await devTerms()).toEqual([
      { source: 'issue', noTranslate: true },
      { source: 'merge', target: '合并' },
      { source: 'branch', target: '支线' },
    ]);
  });

  test('与内置只差大小写的术语不算用户修改，之后跟随新版内置', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'Branch', target: '分支' },
      { source: 'merge', target: '合并' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分叉' },
      { source: 'merge', target: '合并' },
    ]);

    expect((await devTerms()).find((t) => t.source.toLowerCase() === 'branch')).toEqual({
      source: 'branch',
      target: '分叉',
    });
  });

  test('新版内置加入了用户已新增的原词 → 以用户为准，不重复', async () => {
    await setDomainTerms(DEV, [
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'fork', target: '复刻' },
    ]);

    release([
      { source: 'issue', noTranslate: true },
      { source: 'branch', target: '分支' },
      { source: 'merge', target: '合并' },
      { source: 'Fork', noTranslate: true },
    ]);

    const terms = await devTerms();
    expect(terms.filter((t) => t.source.toLowerCase() === 'fork')).toEqual([
      { source: 'fork', target: '复刻' },
    ]);
  });
});

describe('叠加层的存放', () => {
  test('同时写入自建领域与叠加层不会互相覆盖', async () => {
    const [law] = await Promise.all([
      createDomain({ name: '法律', targetLang: 'zh-CN' }),
      setDomainTerms(DEV, [{ source: 'branch', target: '支线' }]),
    ]);

    const domains = await getEffectiveDomains();
    expect(domains.map((d) => d.id)).toContain(law.id);
    expect(domains.find((d) => d.id === DEV)!.terms).toContainEqual({ source: 'branch', target: '支线' });
  });

  test('叠加层与自建领域互不覆盖', async () => {
    const law = await createDomain({ name: '法律', targetLang: 'zh-CN' });
    await setDomainTerms(DEV, [{ source: 'branch', target: '支线' }]);
    await setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]);

    const domains = await getEffectiveDomains();
    expect(domains.find((d) => d.id === law.id)!.terms).toEqual([{ source: 'tort', target: '侵权' }]);
    expect(domains.find((d) => d.id === DEV)!.terms).toContainEqual({ source: 'branch', target: '支线' });
  });

  test('叠加层存放在 storage.local，不占 storage.sync', async () => {
    await setDomainTerms(DEV, [{ source: 'branch', target: '支线' }]);
    expect(Object.keys(await chrome.storage.sync.get(null))).toEqual([]);
    expect(JSON.stringify(await chrome.storage.local.get(null))).toContain('支线');
  });

  test('存储里叠加层的脏数据被忽略，内置术语照常生效', async () => {
    await chrome.storage.local.set({
      'pt-domains': { user: [], builtin: { [DEV]: { terms: [{ target: '没有原词' }, 42] } } },
    });
    expect(await devTerms()).toEqual(builtin[0]!.terms);

    await chrome.storage.local.set({ 'pt-domains': { user: [], builtin: { [DEV]: 'bad' } } });
    expect(await devTerms()).toEqual(builtin[0]!.terms);

    // 译法类型不对、或既没译法也没标“不翻译”的条目，不顶掉同原词的内置术语
    await chrome.storage.local.set({
      'pt-domains': {
        user: [],
        builtin: { [DEV]: { terms: [{ source: 'branch', target: 42 }, { source: 'merge' }] } },
      },
    });
    expect(await devTerms()).toEqual(builtin[0]!.terms);
  });
});
