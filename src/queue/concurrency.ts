// Phase 2 — 并发闸门。
// 限制同时在飞的异步任务数，防止瞬间打爆端点触发限流。
// 浏览器对单域名并发连接数的常见上限为 6，与默认值对齐。

export function createGate(max: number) {
  // #172: 防御 max <= 0 —— 0 会让 pump 永不放行，在飞任务全部挂死。
  // 正常路径已有设置侧钳制（clampConcurrency），这里兜住所有调用方。
  max = Math.max(1, Math.floor(max) || 1);
  let active = 0;
  const waiting: (() => void)[] = [];

  /**
   * 在名额允许且队列非空时放行任务。
   * active 必须在放行这一刻同步自增 —— 等待者要到微任务才继续执行，
   * 若靠它推进循环条件，同步 while 会空转不止。
   */
  function pump(): void {
    while (active < max && waiting.length > 0) {
      active++;
      waiting.shift()!();
    }
  }

  function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  }

  /** 动态调整上限，保留当前 active 计数与等待队列。 */
  run.setMax = (n: number) => {
    max = Math.max(1, Math.floor(n) || 1);
    pump();
  };

  return run;
}
