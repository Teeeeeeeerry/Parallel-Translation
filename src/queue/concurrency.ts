// Phase 2 — 并发闸门。
// 限制同时在飞的异步任务数，防止瞬间打爆端点触发限流。
// 浏览器对单域名并发连接数的常见上限为 6，与默认值对齐。

export function createGate(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      return new Promise<void>((r) => waiting.push(r)).then(() => run(task));
    }
    active++;
    return task().finally(() => {
      active--;
      waiting.shift()?.();
    });
  }

  /** 动态调整上限，保留当前 active 计数与等待队列。 */
  run.setMax = (n: number) => {
    max = n;
    // 上限放宽后，释放等待队列中可立即执行的任务
    while (active < max) waiting.shift()?.();
  };

  return run;
}
