// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 带锁的 local 存储记录（#1151，父 #1141）：storage.local 里的一个键，按键名
// 实例化，提供严格读、宽松读、读-改-写与变更订阅。
//
// 领域与站点页面规则两个存储模块（ADR-0004 不合并）原先各写了一遍同样的
// 串行写入链、Web Locks 跨页面加锁、严格读、“读取失败，未作改动”与配额错误
// 转换；现在各建一个实例，两边仍互不 import。以后新增存进 storage.local 的
// 用户数据直接用它，读取失败、配额满、跨页并发写的口径自动一致。

import { isQuotaError, StorageQuotaError } from './quota';
import { StorageReadError } from './read-error';

export interface LockedRecordOptions<T> {
  /** storage.local 的键名 */
  key: string;
  /** 存储里的原始值 → 记录；存储里还没有数据时收到 undefined，应给出默认值 */
  parse: (raw: unknown) => T;
  /** 记录 → 写进存储的值；缺省原样写入 */
  serialize?: (value: T) => unknown;
  /** 读-改-写的跨页面锁名（Web Locks，扩展页面与后台同源，锁在它们之间共享） */
  lock: string;
  /** 宽松读读取失败时给的值（只剩内置数据），并记日志 */
  fallback: () => T;
  /** 写入之前读取失败时的报错（#537：告诉用户数据没有被改坏），日志前缀也用它 */
  readFailedMessage: string;
  /** 本上下文写入成功之后调用（更新内存快照、清缓存） */
  onWrite?: (value: T) => void;
}

/** 读-改-写的修改函数结果：要写入的新值（null 表示没有变化、不写入）与带给调用方的值。 */
export interface RecordChange<T, R> {
  value: T | null;
  result: R;
}

export interface LockedRecord<T> {
  /** 严格读：读取失败抛 StorageReadError。设置页的列表、导出与写入路径用它。 */
  read(): Promise<T>;
  /**
   * 宽松读：读取失败退回 fallback 并记日志 —— 存储故障不该让整页翻译失败。
   * 写入路径不用它：把退回的值当作现有数据写回会清掉用户的数据。
   */
  readOrFallback(): Promise<T>;
  /**
   * 读-改-写：挂到本上下文的写入链上串行执行，再包一层同名 Web Locks（拿不到
   * 锁接口的环境只有页面内串行）。严格读出当前值交给 change，写入它返回的
   * 新值。读取失败时抛错、不调用 change、不写入；写入遇到存储空间不足抛
   * StorageQuotaError。某一次失败不会让链断掉。
   */
  update<R>(change: (current: T) => RecordChange<T, R>): Promise<R>;
  /** 订阅任一上下文对这个键的写入，回调收到解析后的新值。返回取消订阅函数。 */
  subscribe(fn: (value: T) => void): () => void;
}

export function lockedRecord<T>(opts: LockedRecordOptions<T>): LockedRecord<T> {
  const { key } = opts;
  let writeChain: Promise<unknown> = Promise.resolve();

  async function read(): Promise<T> {
    let raw: unknown;
    try {
      raw = (await chrome.storage.local.get(key))[key];
    } catch (e) {
      throw new StorageReadError(e);
    }
    return opts.parse(raw);
  }

  return {
    read,

    async readOrFallback() {
      try {
        return await read();
      } catch (e) {
        console.warn(`${opts.readFailedMessage}:`, e);
        return opts.fallback();
      }
    },

    update(change) {
      const readModifyWrite = async () => {
        const current = await read().catch((e: unknown) => {
          throw new Error(`${opts.readFailedMessage}，未作改动`, { cause: e });
        });
        const { value, result } = change(current);
        if (value !== null) {
          const stored = opts.serialize ? opts.serialize(value) : value;
          await chrome.storage.local.set({ [key]: stored }).catch((e: unknown) => {
            // 存储空间不足（#510、#523）：换成说得清原因与办法的错误
            throw isQuotaError(e) ? new StorageQuotaError(e) : e;
          });
          opts.onWrite?.(value);
        }
        return result;
      };
      const locks = globalThis.navigator?.locks;
      const next = writeChain.then(async () =>
        locks ? await locks.request(opts.lock, readModifyWrite) : readModifyWrite(),
      );
      writeChain = next.catch(() => {});
      return next;
    },

    subscribe(fn) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[key]) fn(opts.parse(changes[key].newValue));
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}
