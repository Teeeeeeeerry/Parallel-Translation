/**
 * storage/domains.ts — 多个扩展页面同时修改领域 单元测试（#485）
 *
 * 只断言外部可观察的行为：两个互不共享模块内存状态的页面（各自加载一份
 * 领域存储模块，共用同一份 storage.local）交错写入后，生效领域列表里
 * 两边的改动都在。测试环境没有 Web Locks，这里提供一个同名锁排队执行
 * 的替身，行为与浏览器一致。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

type DomainsModule = typeof import('~/src/storage/domains');

const BUILTIN = 'builtin:software-zh-CN';

/** Web Locks 替身：同名锁按请求顺序一次只让一个回调执行。 */
function fakeLocks(): Pick<LockManager, 'request'> {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: ((name: string, cb: (lock: Lock | null) => Promise<unknown>) => {
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(() => cb({ name, mode: 'exclusive' } as Lock));
      tails.set(name, run.catch(() => {}));
      return run;
    }) as LockManager['request'],
  };
}

/** 模拟一个扩展页面：重新加载模块，得到一份独立的页面内状态。 */
async function openPage(): Promise<DomainsModule> {
  vi.resetModules();
  return import('~/src/storage/domains');
}

let a: DomainsModule;
let b: DomainsModule;

beforeEach(async () => {
  resetStorage();
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true });
  a = await openPage();
  b = await openPage();
});

afterEach(() => {
  // 只卸下锁替身；chrome 替身由全局 setup 提供，不能一并清掉
  delete (navigator as { locks?: unknown }).locks;
});

describe('两个设置页标签页同时修改领域（#485）', () => {
  test('一边新建领域、另一边保存术语 → 两者都在', async () => {
    const law = await a.createDomain({ name: '法律', targetLang: 'zh-CN' });

    const [med] = await Promise.all([
      a.createDomain({ name: '医学', targetLang: 'zh-CN' }),
      b.setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]),
    ]);

    const list = await a.getEffectiveDomains();
    expect(list.map((d) => d.id)).toContain(med.id);
    expect(list.find((d) => d.id === law.id)?.terms).toEqual([{ source: 'tort', target: '侵权' }]);
  });

  test('一边调整顺序、另一边编辑术语 → 两者都生效', async () => {
    const law = await a.createDomain({ name: '法律', targetLang: 'zh-CN' });

    await Promise.all([
      a.moveDomain(law.id, 'up'),
      b.setDomainTerms(law.id, [{ source: 'tort', target: '侵权' }]),
    ]);

    const list = await b.getEffectiveDomains();
    expect(list[0]!.id).toBe(law.id);
    expect(list[0]!.terms).toEqual([{ source: 'tort', target: '侵权' }]);
  });

  test('内置领域的术语与适用网址分别在两边保存 → 两者都保留', async () => {
    await Promise.all([
      a.setDomainTerms(BUILTIN, [{ source: 'monorepo', target: '单仓库' }]),
      b.setDomainSites(BUILTIN, ['example.org']),
    ]);

    const dev = (await a.getEffectiveDomains()).find((d) => d.id === BUILTIN)!;
    expect(dev.terms).toEqual([{ source: 'monorepo', target: '单仓库' }]);
    expect(dev.sites).toEqual(['example.org']);
  });

  test('一边写入失败不影响另一边之后的写入', async () => {
    await expect(
      Promise.all([
        a.setDomainTerms('user:missing', []),
        b.createDomain({ name: '医学', targetLang: 'zh-CN' }),
      ]),
    ).rejects.toBeInstanceOf(a.DomainNotFoundError);

    await a.createDomain({ name: '法律', targetLang: 'zh-CN' });
    expect((await b.getEffectiveDomains()).map((d) => d.name)).toEqual(
      expect.arrayContaining(['医学', '法律']),
    );
  });
});
