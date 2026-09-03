/**
 * changelog/claim.ts — 更新提示显示权仲裁 单元测试
 *
 * 扩展更新后，用户打开的每个新页面都会有一个 content script 启动并问
 * 「该我弹吗」。它们互不知情，各自读存储会同时读到「未读」，于是同时
 * 弹出。仲裁把判定收到 background（单实例单线程）串行执行。
 *
 * 「并发申请只有一个拿到」是本文件的核心用例 —— 去掉串行化后它会立刻
 * 变红，而其余用例照常通过。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

describe('claimShow', () => {
  beforeEach(() => {
    resetStorage();
    // claim.ts 持有模块级串行队列，每个用例需要干净的实例
    vi.resetModules();
  });

  test('首次申请 → 拿到显示权', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    expect(await claimShow('2.1.0')).toBe(true);
  });

  test('同版本第二次申请 → 拒绝', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    await claimShow('2.1.0');
    expect(await claimShow('2.1.0')).toBe(false);
  });

  test('多标签页并发申请 → 只有一个拿到', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    const results = await Promise.all([
      claimShow('2.1.0'),
      claimShow('2.1.0'),
      claimShow('2.1.0'),
      claimShow('2.1.0'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('不同版本各自独立', async () => {
    const { claimShow } = await import('~/src/changelog/claim');
    await claimShow('2.1.0');
    expect(await claimShow('2.2.0')).toBe(true);
  });
});

describe('首装闸门', () => {
  beforeEach(() => {
    resetStorage();
    vi.resetModules();
  });

  test('置位后一律拒绝发放 —— 新用户不会看到更新提示', async () => {
    const { claimShow, markFreshInstall } = await import('~/src/changelog/claim');
    markFreshInstall();
    expect(await claimShow('2.1.0')).toBe(false);
  });

  test('置位早于 markSeen 落盘也生效 —— 消除异步写入的竞态窗口', async () => {
    const { claimShow, markFreshInstall } = await import('~/src/changelog/claim');
    // 不调用 markSeen，模拟「storage 尚未写完」的那一瞬
    markFreshInstall();
    expect(await claimShow('2.1.0')).toBe(false);
  });
});
