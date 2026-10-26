// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 设置页“订阅存储、只用最后一次读取的结果”的刷新逻辑（#1153，父 #1141）。
//
// 领域分区与站点页面规则分区原先各写一份：连续变更时先发起、后返回的旧读取
// 不覆盖新列表（#536）；读取失败只在它仍是最后一次读取时报出，旧读取失败、
// 新读取已成功时不提示；列表是否已按存储显示过决定说“没有载入”还是“没有
// 刷新”（#549）。现在收成这一个函数，存储变更经两个存储模块的订阅（底下都是
// “带锁 local 存储记录”的 subscribe）触发。不依赖 main.ts，可以单独在 jsdom 里测。

export interface LatestReadOptions<T> {
  /** 读一次存储（严格读，读取失败时抛错） */
  read: () => Promise<T>;
  /** 按读到的数据渲染；只对最后一次读取调用。抛错与读取失败一样处理（#550） */
  render: (value: T) => void;
  /**
   * 最后一次读取（或渲染）失败时调用一次；loaded 是失败之前列表有没有按存储
   * 显示过（#549）
   */
  onError: (e: unknown, loaded: boolean) => void;
  /** 订阅存储变更（任一上下文写入后回调），返回取消订阅函数 */
  subscribe: (onChange: () => void) => () => void;
}

export interface LatestRead {
  /**
   * 按存储重新读一次、渲染，不会失败。返回列表是否已按最新存储刷新；被更晚的
   * 刷新取代的那次返回最后一次刷新的结果。
   */
  refresh(): Promise<boolean>;
  /** 列表是否已按存储显示过 */
  loaded(): boolean;
  /** 取消订阅；之后返回的读取不再渲染 */
  stop(): void;
}

/** 立即读一次并订阅存储变更，之后每次变更都重读，只用最后一次读取的结果。 */
export function watchLatestRead<T>(opts: LatestReadOptions<T>): LatestRead {
  let seq = 0;
  let latest: Promise<boolean> = Promise.resolve(true);
  let loaded = false;

  function refresh(): Promise<boolean> {
    const mine = ++seq;
    const p = opts
      .read()
      .then((value) => {
        if (mine !== seq) return;
        opts.render(value);
        loaded = true;
      })
      .then(
        () => (mine !== seq ? latest : true),
        (e: unknown) => {
          if (mine !== seq) return latest;
          opts.onError(e, loaded);
          return false;
        },
      );
    latest = p;
    return p;
  }

  void refresh();
  const unsubscribe = opts.subscribe(() => void refresh());
  return {
    refresh,
    loaded: () => loaded,
    stop() {
      unsubscribe();
      // 之后返回的读取都不是最后一次；它们改返回这个结果 —— 仍返回 latest 的话，
      // 在飞的那次读取会拿到它自己，成了 Promise 自引用
      seq++;
      latest = Promise.resolve(false);
    },
  };
}
