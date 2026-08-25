/**
 * ui/lifecycle-registry.ts — UI 生命周期注册表 单元测试（#235）
 *
 * 用假 create/stop 断言：启停成对、重复注册幂等、停止后不重复执行、
 * ensure 设置变更钩子幂等、dispose 全量停止。
 */
import { describe, test, expect, vi } from 'vitest';
import { createLifecycleRegistry } from '~/src/ui/lifecycle-registry';

interface FakeCtx {
  id: string;
}

function fakeLifecycle(id: string, log: string[]) {
  return {
    create: vi.fn((): FakeCtx => {
      log.push(`create:${id}`);
      return { id };
    }),
    stop: vi.fn((ctx: FakeCtx) => {
      log.push(`stop:${ctx.id}`);
    }),
  };
}

describe('register — 启停成对', () => {
  test('register 立即 create，返回的停止函数触发对应 stop', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();

    const stop = registry.register('ball', lc);
    expect(lc.create).toHaveBeenCalledTimes(1);
    expect(registry.isRunning('ball')).toBe(true);

    stop();
    expect(log).toEqual(['create:ball', 'stop:ball']);
    expect(registry.isRunning('ball')).toBe(false);
    // 停止函数幂等：再次调用不重复执行 stop
    stop();
    expect(lc.stop).toHaveBeenCalledTimes(1);
  });

  test('unregister 停止并移除，未注册 id 为空操作', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();

    registry.register('ball', lc);
    registry.unregister('ball');
    expect(log).toEqual(['create:ball', 'stop:ball']);
    registry.unregister('ball'); // 空操作，不抛
    expect(lc.stop).toHaveBeenCalledTimes(1);
  });
});

describe('register — 重复注册幂等', () => {
  test('同一 id 重复注册：旧实例先停止，同一时刻仅一个实例在跑', () => {
    const log: string[] = [];
    const lc1 = fakeLifecycle('a1', log);
    const lc2 = fakeLifecycle('a2', log);
    const registry = createLifecycleRegistry();

    registry.register('ball', lc1);
    expect(registry.isRunning('ball')).toBe(true);

    registry.register('ball', lc2);
    expect(log).toEqual(['create:a1', 'stop:a1', 'create:a2']);
    expect(registry.isRunning('ball')).toBe(true);

    // 旧实例不会被二次停止
    registry.unregister('ball');
    expect(log).toEqual(['create:a1', 'stop:a1', 'create:a2', 'stop:a2']);
  });
});

describe('ensure — 设置变更驱动的启停钩子', () => {
  test('ensure(true) 幂等：连续调用只 create 一次', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();
    registry.register('ball', lc);

    registry.ensure('ball', true);
    registry.ensure('ball', true);
    expect(lc.create).toHaveBeenCalledTimes(1); // 注册时一次，ensure 不再重复
    expect(registry.isRunning('ball')).toBe(true);
  });

  test('ensure(false) 停止；再 ensure(true) 重新创建', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();
    registry.register('ball', lc);

    registry.ensure('ball', false);
    expect(log).toEqual(['create:ball', 'stop:ball']);
    expect(registry.isRunning('ball')).toBe(false);

    // 停止后不重复执行：再 ensure(false) 不触发二次 stop
    registry.ensure('ball', false);
    expect(lc.stop).toHaveBeenCalledTimes(1);

    // 重新启用 → 重新创建（启停成对）
    registry.ensure('ball', true);
    expect(log).toEqual(['create:ball', 'stop:ball', 'create:ball']);
    expect(registry.isRunning('ball')).toBe(true);
  });

  test('未注册的 id：ensure 为空操作', () => {
    const registry = createLifecycleRegistry();
    registry.ensure('ghost', true);
    registry.ensure('ghost', false);
    expect(registry.isRunning('ghost')).toBe(false);
  });
});

describe('dispose', () => {
  test('停止全部实例并清空注册表', () => {
    const log: string[] = [];
    const registry = createLifecycleRegistry();
    registry.register('ball', fakeLifecycle('ball', log));
    registry.register('para-btn', fakeLifecycle('para-btn', log));

    registry.dispose();
    expect(log).toEqual(['create:ball', 'create:para-btn', 'stop:ball', 'stop:para-btn']);
    expect(registry.isRunning('ball')).toBe(false);
    expect(registry.isRunning('para-btn')).toBe(false);

    // 清空后 ensure 不再复活
    registry.ensure('ball', true);
    expect(registry.isRunning('ball')).toBe(false);
  });
});
