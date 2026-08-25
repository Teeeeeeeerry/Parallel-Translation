// UI 生命周期注册表 —— #224 架构评审候选 6 的核心（#235）。
//
// mount/unmount 样板在每个 UI 模块里重复，content 入口用五个 stop 变量
// 手写生命周期，设置变更处把创建块整体重抄一遍 —— teardown 全靠自觉，
// 没有任何一处兜底保证启停成对。本模块以 register(id, create, stop)
// 收敛生命周期：
//   - 启停成对：每个 create 恰对应一次 stop，stop 幂等、未启动为空操作
//   - 重复注册幂等：同一 id 至多一个实例在跑，重注册先停止旧实例
//   - 设置变更驱动的启停钩子 ensure(id, enabled)：开关即时生效

export interface RegistryLifecycle<T> {
  /** 创建实例，返回实例上下文（通常是该 UI 的停止函数）。 */
  create: () => T;
  /** 停止实例。与 create 严格成对，每个实例恰好停止一次。 */
  stop: (ctx: T) => void;
}

export interface LifecycleRegistry {
  /**
   * 注册一个 UI 生命周期并立即创建实例。
   * 重复注册同一 id：先停止旧实例再创建新实例（幂等）。
   * 返回该注册的停止函数（停止并移除）。
   */
  register<T>(id: string, lifecycle: RegistryLifecycle<T>): () => void;
  /**
   * 设置变更驱动的启停钩子（幂等）：
   * enabled 为 true 且未运行 → 启动；false 且运行中 → 停止。
   * 未注册的 id 为空操作。
   */
  ensure(id: string, enabled: boolean): void;
  /** 停止并移除指定 id。未注册 / 未启动为空操作。 */
  unregister(id: string): void;
  /** 当前是否运行中。 */
  isRunning(id: string): boolean;
  /** 停止全部实例并清空注册表。 */
  dispose(): void;
}

export function createLifecycleRegistry(): LifecycleRegistry {
  /** 声明（跨启停保留）。 */
  const decls = new Map<string, RegistryLifecycle<unknown>>();
  /** 运行中的实例上下文。 */
  const instances = new Map<string, unknown>();

  const stopInstance = (id: string): void => {
    const ctx = instances.get(id);
    if (ctx === undefined) return;
    instances.delete(id);
    decls.get(id)!.stop(ctx as never);
  };

  const registry: LifecycleRegistry = {
    register<T>(id: string, lifecycle: RegistryLifecycle<T>): () => void {
      // 重复注册幂等：旧实例先停止，同一 id 至多一个实例在跑
      stopInstance(id);
      decls.set(id, lifecycle as RegistryLifecycle<unknown>);
      instances.set(id, lifecycle.create());
      return () => registry.unregister(id);
    },

    ensure(id: string, enabled: boolean): void {
      if (enabled) {
        if (instances.has(id)) return; // 已在运行 —— 幂等
        const decl = decls.get(id);
        if (!decl) return; // 未注册 —— 空操作
        instances.set(id, decl.create());
      } else {
        stopInstance(id);
      }
    },

    unregister(id: string): void {
      stopInstance(id);
      decls.delete(id);
    },

    isRunning(id: string): boolean {
      return instances.has(id);
    },

    dispose(): void {
      for (const id of [...instances.keys()]) {
        stopInstance(id);
      }
      decls.clear();
    },
  };

  return registry;
}
