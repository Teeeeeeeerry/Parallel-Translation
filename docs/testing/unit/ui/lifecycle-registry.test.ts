/**
 * ui/lifecycle-registry.ts — UI 生命周期注册表 单元测试（#235）
 *
 * 用假 create/stop 断言：声明与实例化分离（register 不 create，
 * 首次 ensure(true) 才创建）、启停成对、重复注册幂等、停止后不重复
 * 执行、ensure 设置变更钩子幂等、dispose 全量停止。
 *
 * #267：register 声明即创建的语义会让副作用类生命周期（增量补翻
 * observer 挂 MutationObserver）在内容脚本初始化时误启动 —— 本测试
 * 钉死「register 后 create 未被调用」的契约。
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

describe('register — 声明与实例化分离', () => {
  test('register 不立即 create（#267 回归）；首次 ensure(true) 才创建', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('observer', log);
    const registry = createLifecycleRegistry();

    registry.register('observer', lc);
    // 声明后未启动 —— 副作用类生命周期不得因声明而误启动
    expect(lc.create).not.toHaveBeenCalled();
    expect(registry.isRunning('observer')).toBe(false);

    registry.ensure('observer', true);
    expect(lc.create).toHaveBeenCalledTimes(1);
    expect(registry.isRunning('observer')).toBe(true);
  });

  test('register 返回的停止函数：停止实例并移除声明', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();

    const stop = registry.register('ball', lc);
    expect(lc.create).not.toHaveBeenCalled();

    registry.ensure('ball', true);
    expect(log).toEqual(['create:ball']);

    stop();
    expect(log).toEqual(['create:ball', 'stop:ball']);
    expect(registry.isRunning('ball')).toBe(false);
    // 停止函数幂等：再次调用不重复执行 stop
    stop();
    expect(lc.stop).toHaveBeenCalledTimes(1);
    // 声明已移除：ensure 不再复活
    registry.ensure('ball', true);
    expect(registry.isRunning('ball')).toBe(false);
  });

  test('unregister 停止并移除，未注册 id 为空操作', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();

    registry.register('ball', lc);
    registry.ensure('ball', true);
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
    registry.ensure('ball', true);
    expect(registry.isRunning('ball')).toBe(true);

    registry.register('ball', lc2);
    expect(log).toEqual(['create:a1', 'stop:a1']);
    expect(registry.isRunning('ball')).toBe(false); // 声明被替换，未重新创建

    // 新声明经 ensure 启动 —— 旧实例不会被二次停止
    registry.ensure('ball', true);
    expect(log).toEqual(['create:a1', 'stop:a1', 'create:a2']);
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
    expect(lc.create).toHaveBeenCalledTimes(1);
    expect(registry.isRunning('ball')).toBe(true);
  });

  test('ensure(false) 停止；再 ensure(true) 重新创建', () => {
    const log: string[] = [];
    const lc = fakeLifecycle('ball', log);
    const registry = createLifecycleRegistry();
    registry.register('ball', lc);

    registry.ensure('ball', false);
    expect(log).toEqual([]); // 未启动过 —— 停止为空操作
    expect(registry.isRunning('ball')).toBe(false);

    registry.ensure('ball', true);
    expect(log).toEqual(['create:ball']);
    expect(registry.isRunning('ball')).toBe(true);

    registry.ensure('ball', false);
    expect(log).toEqual(['create:ball', 'stop:ball']);
    expect(registry.isRunning('ball')).toBe(false);

    // 停止后不重复执行：再 ensure(false) 不触发二次 stop
    registry.ensure('ball', false);
    expect(lc.stop).toHaveBeenCalledTimes(1);

    // 重新启用 → 重新创建（启停成对）
    registry.ensure('ball', true);
    expect(log).toEqual(['create:ball', 'stop:ball', 'create:ball']);
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
    registry.ensure('ball', true);
    registry.ensure('para-btn', true);

    registry.dispose();
    expect(log).toEqual(['create:ball', 'create:para-btn', 'stop:ball', 'stop:para-btn']);
    expect(registry.isRunning('ball')).toBe(false);
    expect(registry.isRunning('para-btn')).toBe(false);

    // 清空后 ensure 不再复活
    registry.ensure('ball', true);
    expect(registry.isRunning('ball')).toBe(false);
  });
});
