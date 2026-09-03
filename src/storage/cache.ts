// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

const PREFIX = 'pt-c:';
const MAX_ENTRIES = 5000;
const INDEX_KEY = 'pt-cache-index';

/** 缓存条目有效期 —— 30 天。超期条目在读取时惰性淘汰（#175）。 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 生成缓存 key: pt-c:{engine}:{from}:{to}[:{model}]:{sha1hex(text)}
 * 跨站点共享 —— 同一段英文在不同网站只翻一次。
 *
 * #175: BYOK 引擎（openai/gemini）的模型名进 key —— 切换模型后
 * 不再命中旧模型的译文。无模型的引擎（google/bing）key 不含模型段。
 */
export async function cacheKey(
  engine: string,
  from: string,
  to: string,
  text: string,
  model = '',
): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  );
  const hex = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${PREFIX}${engine}:${from}:${to}${model ? `:${model}` : ''}:${hex}`;
}

// ---- Index 序列化链 ----
// chrome.storage.local 的读-改-写不是原子的，
// 并发 cacheSet / cacheGet（刷新位置）会丢失 index 条目。
// 所有涉及 index 变动的操作通过这条 Promise 链串行化。

let chain: Promise<void> = Promise.resolve();

// ---- Index 内部操作 ----

/** 将 key 移到 index 末尾（"最近使用"），必要时淘汰最旧的条目。 */
async function refreshIndex(key: string): Promise<void> {
  const idxResult = await chrome.storage.local.get(INDEX_KEY);
  let index: string[] = (idxResult[INDEX_KEY] as string[] | undefined) ?? [];

  const existing = index.indexOf(key);
  if (existing !== -1) {
    index.splice(existing, 1);
  }
  index.push(key);

  if (index.length > MAX_ENTRIES) {
    const toEvict = index.splice(0, index.length - MAX_ENTRIES);
    await chrome.storage.local.remove(toEvict);
  }

  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

// ---- Public API ----

/** 读取缓存条目。命中时刷新 LRU 位置，未命中返回 null。 */
export function cacheGet(key: string): Promise<string | null> {
  let value: string | null = null;

  chain = chain
    .then(() => chrome.storage.local.get(key))
    .then((result) => {
      const v = result[key];
      if (typeof v !== 'string') return undefined;
      // #175: 条目为带时间戳的 JSON 包装；超期 → 移除并视为未命中。
      // 旧版纯字符串条目（升级前写入）没有时间戳，按永不过期处理，
      // 由 LRU 自然淘汰。
      try {
        const parsed = JSON.parse(v) as { v?: string; t?: number };
        if (typeof parsed.v === 'string' && typeof parsed.t === 'number') {
          if (Date.now() - parsed.t > CACHE_TTL_MS) {
            return chrome.storage.local.remove(key).then(() => undefined);
          }
          value = parsed.v;
        } else {
          value = v;
        }
      } catch {
        value = v;
      }
      // 命中 → 刷新 index 位置
      return refreshIndex(key);
    })
    .catch((e) => {
      console.warn('[PT] 缓存读取失败:', e);
    });

  return chain.then(() => value);
}

/**
 * 写入缓存条目。
 * 自动维护 LRU index —— 超过 MAX_ENTRIES 则淘汰最旧的条目。
 */
export function cacheSet(key: string, value: string): Promise<void> {
  chain = chain
    .then(() =>
      chrome.storage.local.set({
        [key]: JSON.stringify({ v: value, t: Date.now() }),
      }),
    )
    .then(() => refreshIndex(key))
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
      await chrome.storage.local.remove(INDEX_KEY);
    })
    .catch(() => {});

  return chain;
}
