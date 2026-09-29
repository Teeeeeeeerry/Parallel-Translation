// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

import type { Term } from './domains';
import { isQuotaError } from './quota';

const PREFIX = 'pt-c:';
const MAX_ENTRIES = 5000;
const INDEX_KEY = 'pt-cache-index';
/** index 里每条的字节数（#510），与 index 一一对应、一起写。 */
const SIZES_KEY = 'pt-cache-sizes';

/**
 * 缓存条目的总字节数上限（#510）。扩展申请了 unlimitedStorage；没有它时
 * storage.local 总共约 10MB，缓存最多占一半，给领域、术语、站点页面规则
 * 留出空间。按键名与存入值的 UTF-8 字节数估算，与 Chrome 计配额的口径相近。
 */
export const CACHE_MAX_BYTES = 5 * 1024 * 1024;

/** 缓存条目有效期 —— 30 天。超期条目在读取时惰性淘汰（#175）。 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function sha1hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 术语哈希的口径版本（#419）。#380 起按“命中的全部术语”写入的条目，写入时
 * 译文可能还没有术语约束；口径改为“实际生效的术语”后换版本，这批旧条目
 * 不再命中。以后哈希口径再变时递增。
 */
const TERMS_HASH_VERSION = 2;

/**
 * 本段实际生效术语的哈希（#380）：原词、译法、“不翻译”标记，外加口径
 * 版本（#419）。与术语顺序、所属领域无关 —— 两个站点命中相同术语时共用
 * 缓存。机翻引擎“指定译法”开关（#390）打开时追加一个标记；关闭时哈希
 * 输入与引入开关前相同，已有缓存继续有效。
 */
function termsHash(terms: readonly Term[], mtTermTargets: boolean): Promise<string> {
  const canonical = terms
    .map((t) => JSON.stringify([t.source.trim(), t.target ?? '', t.noTranslate === true]))
    .sort();
  const input = `v${TERMS_HASH_VERSION}[${canonical.join(',')}]`;
  return sha1hex(mtTermTargets ? `${input}mt-targets` : input);
}

/**
 * 生成缓存 key: pt-c:{engine}:{from}:{to}[:{model}]:{sha1hex(text)}[:{termsHash}]
 * 跨站点共享 —— 同一段英文在不同网站只翻一次。
 *
 * #175: BYOK 引擎（openai/gemini）的模型名进 key —— 切换模型后
 * 不再命中旧模型的译文。无模型的引擎（google/bing）key 不含模型段。
 *
 * #380: 本段命中术语时追加术语哈希 —— 修改术语后不命中旧译文；
 * 没有命中时不追加，key 与引入术语前逐字节相同，现有缓存继续有效。
 * #419: 调用方只传该引擎实际生效的术语；机翻引擎在“指定译法”开关
 * （#390）打开时传 mtTermTargets = true，开关状态随之进术语哈希。
 */
export async function cacheKey(
  engine: string,
  from: string,
  to: string,
  text: string,
  model = '',
  terms: readonly Term[] = [],
  mtTermTargets = false,
): Promise<string> {
  const base = `${PREFIX}${engine}:${from}:${to}${model ? `:${model}` : ''}:${await sha1hex(text)}`;
  return terms.length > 0 ? `${base}:${await termsHash(terms, mtTermTargets)}` : base;
}

// ---- Index 序列化链 ----
// chrome.storage.local 的读-改-写不是原子的，
// 并发 cacheSet / cacheGet（刷新位置）会丢失 index 条目。
// 所有涉及 index 变动的操作通过这条 Promise 链串行化。

let chain: Promise<void> = Promise.resolve();

// ---- Index 内部操作 ----

const encoder = new TextEncoder();

/** 一条缓存占的字节数（#510）：键名加存入值的 JSON，按 UTF-8 计。 */
function entryBytes(key: string, stored: unknown): number {
  return typeof stored === 'string'
    ? encoder.encode(key).length + encoder.encode(JSON.stringify(stored)).length
    : 0;
}

/**
 * LRU 顺序（最旧在前）与每条的字节数（#510），两者一一对应、一起读写。
 * 总字节数每次现算，不单独累计：设置页清空缓存与后台写入不在同一条
 * chain 上，交错时后台可能把清空前的 index 写回；逐条记大小时，写回的
 * 那些已不存在的条目随淘汰一起扣掉，总数不会一直虚高。
 */
interface IndexState {
  index: string[];
  sizes: number[];
}

async function loadIndex(): Promise<IndexState> {
  const r = await chrome.storage.local.get([INDEX_KEY, SIZES_KEY]);
  const index = (r[INDEX_KEY] as string[] | undefined) ?? [];
  const sizes = r[SIZES_KEY];
  if (Array.isArray(sizes) && sizes.length === index.length) return { index, sizes };
  // #510 之前写入的缓存没有大小记录：按现有条目算一次
  const entries = index.length > 0 ? await chrome.storage.local.get(index) : {};
  return { index, sizes: index.map((k) => entryBytes(k, entries[k])) };
}

function saveIndex(state: IndexState): Promise<void> {
  return chrome.storage.local.set({ [INDEX_KEY]: state.index, [SIZES_KEY]: state.sizes });
}

/** 把 key 移到末尾（"最近使用"），大小记为 bytes。 */
function touch(state: IndexState, key: string, bytes: number): void {
  const at = state.index.indexOf(key);
  if (at !== -1) {
    state.index.splice(at, 1);
    state.sizes.splice(at, 1);
  }
  state.index.push(key);
  state.sizes.push(bytes);
}

/**
 * 从最旧的开始淘汰，直到 more(剩余条数, 剩余字节数) 为假；keep（刚写入或
 * 刚读到的）不淘汰。
 */
async function evictOldest(
  state: IndexState,
  keep: string,
  more: (count: number, bytes: number) => boolean,
): Promise<void> {
  let count = state.index.length;
  let bytes = state.sizes.reduce((a, b) => a + b, 0);
  const evicted = new Set<string>();
  for (let i = 0; i < state.index.length && more(count, bytes); i++) {
    const k = state.index[i]!;
    if (k === keep) continue;
    evicted.add(k);
    count--;
    bytes -= state.sizes[i]!;
  }
  if (evicted.size === 0) return;
  state.sizes = state.sizes.filter((_, i) => !evicted.has(state.index[i]!));
  state.index = state.index.filter((k) => !evicted.has(k));
  await chrome.storage.local.remove([...evicted]);
}

/** 条数或总字节数超过上限。 */
function overLimit(count: number, bytes: number): boolean {
  return count > MAX_ENTRIES || bytes > CACHE_MAX_BYTES;
}

/**
 * 命中后把 key 移到 index 末尾（"最近使用"），必要时淘汰最旧的条目。
 * stored 是读到的条目：不在 index 里的（条目写入成功、index 没写成）
 * 按它补上大小。
 */
async function refreshIndex(key: string, stored: string): Promise<void> {
  const state = await loadIndex();
  touch(state, key, entryBytes(key, stored));
  await evictOldest(state, key, overLimit);
  await saveIndex(state);
}

// ---- Public API ----

/** 一条缓存：译文，以及它是否“未遵守术语”（#428）。 */
export interface CacheEntry {
  value: string;
  /**
   * 未遵守术语：机翻引擎改坏了“不翻译”术语的占位符，这份译文是用原文
   * 重译的（#389），却写在带术语哈希的 key 下 —— 同一段原文再次翻译时
   * 直接命中，不再重走回退。
   */
  ignoresTerms: boolean;
}

/** 移除超期条目，并从 index 里去掉，不再占字节数（#510）。 */
async function removeExpired(key: string): Promise<undefined> {
  const state = await loadIndex();
  const at = state.index.indexOf(key);
  if (at !== -1) {
    state.index.splice(at, 1);
    state.sizes.splice(at, 1);
  }
  await chrome.storage.local.remove(key);
  await saveIndex(state);
  return undefined;
}

/** 读取缓存条目。命中时刷新 LRU 位置，未命中返回 null。 */
export function cacheGet(key: string): Promise<string | null> {
  return cacheGetEntry(key).then((entry) => entry?.value ?? null);
}

/** 读取缓存条目及其标记（#428）。命中时刷新 LRU 位置，未命中返回 null。 */
export function cacheGetEntry(key: string): Promise<CacheEntry | null> {
  let entry: CacheEntry | null = null;

  chain = chain
    .then(() => chrome.storage.local.get(key))
    .then((result) => {
      const v = result[key];
      if (typeof v !== 'string') return undefined;
      // #175: 条目为带时间戳的 JSON 包装；超期 → 移除并视为未命中。
      // 旧版纯字符串条目（升级前写入）没有时间戳，按永不过期处理，
      // 由 LRU 自然淘汰。
      try {
        const parsed = JSON.parse(v) as { v?: string; t?: number; ignoresTerms?: boolean };
        if (typeof parsed.v === 'string' && typeof parsed.t === 'number') {
          if (Date.now() - parsed.t > CACHE_TTL_MS) {
            return removeExpired(key);
          }
          entry = { value: parsed.v, ignoresTerms: parsed.ignoresTerms === true };
        } else {
          entry = { value: v, ignoresTerms: false };
        }
      } catch {
        entry = { value: v, ignoresTerms: false };
      }
      // 命中 → 刷新 index 位置
      return refreshIndex(key, v);
    })
    .catch((e) => {
      console.warn('[PT] 缓存读取失败:', e);
    });

  return chain.then(() => entry);
}

/**
 * 写入缓存条目。
 * 自动维护 LRU index —— 超过 MAX_ENTRIES 条或总字节数超过 CACHE_MAX_BYTES
 * （#510）则淘汰最旧的条目。写入遇到存储空间不足时先淘汰最旧的四分之一
 * 再重试一次 —— 缓存只是加速用的，空间不够时让位。
 * opts.ignoresTerms 标记这份译文未遵守术语（#428），缺省不标记。
 */
export function cacheSet(
  key: string,
  value: string,
  opts: { ignoresTerms?: boolean } = {},
): Promise<void> {
  const stored = JSON.stringify({
    v: value,
    t: Date.now(),
    ...(opts.ignoresTerms && { ignoresTerms: true }),
  });
  chain = chain
    .then(async () => {
      const state = await loadIndex();
      try {
        await chrome.storage.local.set({ [key]: stored });
      } catch (e) {
        if (!isQuotaError(e) || state.index.length === 0) throw e;
        console.warn('[PT] 缓存写入遇到存储空间不足，淘汰最旧的条目后重试:', e);
        const quarter = Math.ceil(state.index.length / 4);
        const floor = state.index.length - quarter;
        await evictOldest(state, key, (count) => count > floor);
        await saveIndex(state);
        await chrome.storage.local.set({ [key]: stored });
      }
      touch(state, key, entryBytes(key, stored));
      await evictOldest(state, key, overLimit);
      await saveIndex(state);
    })
    .catch((e) => {
      // #175: 配额满（storage.local 总量 10MB）等写失败不再静默吞掉 ——
      // 控制台可见原因，避免「缓存开了但从不生效」的无声失效
      console.warn('[PT] 缓存写入失败（可能已达存储配额上限）:', e);
    });

  return chain;
}

/** 清空全部缓存。串在 index 链上，确保与并发写入不交叉。 */
export function cacheClear(): Promise<void> {
  chain = chain
    .then(async () => {
      const idxResult = await chrome.storage.local.get(INDEX_KEY);
      const index: string[] = (idxResult[INDEX_KEY] as string[] | undefined) ?? [];
      if (index.length > 0) {
        await chrome.storage.local.remove(index);
      }
      await chrome.storage.local.remove([INDEX_KEY, SIZES_KEY]);
    })
    .catch(() => {});

  return chain;
}
