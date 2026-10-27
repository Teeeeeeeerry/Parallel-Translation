/**
 * changelog/claim.ts — 更新提示显示权仲裁 单元测试
 *
 * 扩展更新后，用户打开的每个新页面都会有一个 content script 启动并问
 * 「该我弹吗」。它们互不知情，各自读存储会同时读到「未读」，于是同时
 * 弹出。仲裁把判定收到 background（单实例单线程）串行执行。
 *
 * #1172 起显示权发出去只是“占住”，不当场记已读：占用者看完自己写已读
 * 再释放，没看成就释放。流程整体的用例在 prompt.test.ts。
 *
 * 「并发申请只有一个拿到」是本文件的核心用例 —— 去掉串行化后它会立刻
 * 变红，而其余用例照常通过。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

beforeEach(() => {
  resetStorage();
  // claim.ts 持有模块级串行队列与占用者，每个用例需要干净的实例
  vi.resetModules();
});

describe('claimShow / releaseShow', () => {
  test('首次申请 → 拿到显示权，不写已读', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    const { hasSeen } = await import('~/src/changelog/state');
    expect(await claimShow('2.1.0', {})).toBe('granted');
    expect(await hasSeen('2.1.0')).toBe(false);
  });

  test('有人占着 → 别的页面得到 busy，占用者本人再问照样拿到', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    const a = {};
    await claimShow('2.1.0', a);
    expect(await claimShow('2.1.0', {})).toBe('busy');
    expect(await claimShow('2.1.0', a)).toBe('granted');
  });

  test('多标签页并发申请 → 只有一个拿到', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    const results = await Promise.all([
      claimShow('2.1.0', {}),
      claimShow('2.1.0', {}),
      claimShow('2.1.0', {}),
      claimShow('2.1.0', {}),
    ]);
    expect(results.filter((r) => r === 'granted')).toHaveLength(1);
  });

  test('占用者释放 → 下一个页面能拿到；别人释放不算数', async () => {
    const { claimShow, releaseShow } = await import('~/src/changelog/claim');
    const a = {};
    const b = {};
    await claimShow('2.1.0', a);
    releaseShow(b);
    expect(await claimShow('2.1.0', b)).toBe('busy');
    releaseShow(a);
    expect(await claimShow('2.1.0', b)).toBe('granted');
  });

  test('已读过 → seen', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    const { markSeen } = await import('~/src/changelog/state');
    await markSeen('2.1.0');
    expect(await claimShow('2.1.0', {})).toBe('seen');
  });
});

describe('首装闸门', () => {
  test('置位后一律不发放 —— 新用户不会看到更新提示', async () => {
    const { claimShow, markFreshInstall } = await import('~/src/changelog/claim');
    markFreshInstall();
    expect(await claimShow('2.1.0', {})).toBe('seen');
  });

  test('首装标记落盘后由存储接手（SW 回收、内存标志丢失之后）', async () => {
    const { markInstalled } = await import('~/src/changelog/state');
    await markInstalled('2.1.0');
    const { claimShow } = await import('~/src/changelog/claim');
    expect(await claimShow('2.1.0', {})).toBe('seen');
  });
});
