/**
 * storage/domains.ts — 内置领域恢复默认（#398）
 *
 * 内置数据换成可变的测试数据。只断言外部可观察的行为：恢复后生效领域
 * 等于当前内置内容，以及领域是否有用户修改。
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
  moveDomain,
  setDomainSites,
  setDomainTerms,
  resetBuiltinDomain,
  isBuiltinModified,
} from '~/src/storage/domains';

const DEV = 'builtin:dev';
const LAW = 'builtin:law';

function release(): void {
  builtin = [
    {
      id: DEV,
      name: '软件开发',
      targetLang: 'zh-CN',
      sites: ['github.com', 'gitlab.com'],
      origin: 'builtin',
      terms: [
        { source: 'issue', noTranslate: true },
        { source: 'branch', target: '分支' },
      ],
    },
    {
      id: LAW,
      name: '法律',
      targetLang: 'zh-CN',
      sites: ['law.example.org'],
      origin: 'builtin',
      terms: [{ source: 'tort', target: '侵权' }],
    },
  ];
}

const effective = async (id: string) => (await getEffectiveDomains()).find((d) => d.id === id)!;

beforeEach(() => {
  resetStorage();
  release();
});

describe('恢复默认（#398）', () => {
  test('清空术语修改、新增、删除与网址增删，生效内容等于当前内置内容', async () => {
    await setDomainTerms(DEV, [
      { source: 'branch', target: '支线' },
      { source: 'fork', noTranslate: true },
    ]);
    await setDomainSites(DEV, ['github.com', 'gitee.com']);
    expect(isBuiltinModified(await effective(DEV))).toBe(true);

    const restored = await resetBuiltinDomain(DEV);
    expect(restored).toEqual(builtin[0]);
    expect(await effective(DEV)).toEqual(builtin[0]);
    expect(isBuiltinModified(await effective(DEV))).toBe(false);
  });

  test('只恢复这一个领域：其他内置领域的修改、自建领域与领域顺序不变', async () => {
    await setDomainTerms(DEV, [{ source: 'issue', target: '议题' }]);
    await setDomainTerms(LAW, [{ source: 'tort', target: '民事侵权' }]);
    const mine = await createDomain({ name: '我的', targetLang: 'zh-CN' });
    await moveDomain(mine.id, 'up');
    await moveDomain(mine.id, 'up');
    const order = (await getEffectiveDomains()).map((d) => d.id);

    await resetBuiltinDomain(DEV);
    expect((await effective(LAW)).terms).toEqual([{ source: 'tort', target: '民事侵权' }]);
    expect((await getEffectiveDomains()).map((d) => d.id)).toEqual(order);
  });

  test('没有修改的内置领域不算修改；自建领域不算', async () => {
    expect(isBuiltinModified(await effective(DEV))).toBe(false);
    const mine = await createDomain({ name: '我的', targetLang: 'zh-CN' });
    await setDomainTerms(mine.id, [{ source: 'a', target: 'b' }]);
    expect(isBuiltinModified(await effective(mine.id))).toBe(false);
  });

  test('改回与内置相同的内容不算修改', async () => {
    await setDomainTerms(DEV, [{ source: 'branch', target: '支线' }]);
    await setDomainTerms(DEV, builtin[0]!.terms);
    expect(isBuiltinModified(await effective(DEV))).toBe(false);
  });

  test('自建领域不能恢复默认', async () => {
    const mine = await createDomain({ name: '我的', targetLang: 'zh-CN' });
    await expect(resetBuiltinDomain(mine.id)).rejects.toThrow();
  });
});
