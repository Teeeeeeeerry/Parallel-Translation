/**
 * storage/specialization.ts — 多个扩展页面同时修改站点页面规则 单元测试（#508）
 *
 * 只断言外部可观察的行为：两个互不共享模块内存状态的页面（各自加载一份
 * 领域与规则存储模块，共用同一份 storage.local）交错写入后，站点卡片里
 * 两边的改动都在。测试环境没有 Web Locks，这里提供一个替身，只模拟
 * 用到的语义：同名锁按请求顺序排队执行，回调出错时照样放锁。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

type Spec = typeof import('~/src/storage/specialization');

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
async function openPage(): Promise<Spec> {
  vi.resetModules();
  return import('~/src/storage/specialization');
}

const file = (sites: Record<string, unknown>) =>
  JSON.stringify({ format: 'parallel-translation-site-rules', version: 1, sites });

let a: Spec;
let b: Spec;

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

describe('两个设置页标签页同时修改站点页面规则（#508）', () => {
  test('一边新增站点卡片、另一边保存别的卡片 → 两者都在', async () => {
    await a.saveUserSiteRules('example.com', {});

    await Promise.all([
      a.saveUserSiteRules('example.org', {}),
      b.saveUserSiteRules('example.com', { exclude: ['.ad'] }),
    ]);

    expect(await a.getUserSiteRules()).toEqual([
      { site: 'example.com', exclude: ['.ad'] },
      { site: 'example.org' },
    ]);
  });

  test('两边分别保存同一张卡片的不同字段 → 后保存的一方基于前一方的结果', async () => {
    await Promise.all([
      a.saveUserSiteRules('example.com', { exclude: ['.ad'] }),
      b.saveUserSiteRules('example.com', { scope: ['main'] }),
      a.setBuiltinSiteRulesDisabled('example.com', true),
      b.saveUserSiteRules('example.com', { preserve: ['code'] }),
    ]);

    expect(await b.getUserSiteRules()).toEqual([
      { site: 'example.com', exclude: ['.ad'], scope: ['main'], disableBuiltin: true, preserve: ['code'] },
    ]);
  });

  test('一边导入 JSON、另一边删除卡片 → 两者都生效', async () => {
    await a.saveUserSiteRules('example.com', { exclude: ['.ad'] });

    await Promise.all([
      a.importUserSiteRules(
        file({ 'example.org': { scope: [], exclude: ['.x'], preserve: [], disableBuiltin: false } }),
      ),
      b.deleteUserSiteRules('example.com'),
    ]);

    expect(await b.getUserSiteRules()).toEqual([{ site: 'example.org', exclude: ['.x'] }]);
  });

  test('一边写入报错 → 错误交给调用方，另一边和之后的写入照常', async () => {
    await expect(
      Promise.all([
        a.saveUserSiteRules('http://example.com', {}),
        b.saveUserSiteRules('example.org', {}),
      ]),
    ).rejects.toThrow('[PT] 站点须为裸域名');

    await a.saveUserSiteRules('example.net', {});
    expect((await b.getUserSiteRules()).map((u) => u.site)).toEqual(['example.org', 'example.net']);
  });
});
