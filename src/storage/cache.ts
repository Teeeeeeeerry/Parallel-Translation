const PREFIX = 'pt-c:';
const MAX_ENTRIES = 5000;
const INDEX_KEY = 'pt-cache-index';

/**
 * 生成缓存 key: pt-c:{engine}:{from}:{to}:{sha1hex(text)}
 * 跨站点共享 —— 同一段英文在不同网站只翻一次。
 */
export async function cacheKey(
  engine: string,
  from: string,
  to: string,
  text: string,
): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  );
  const hex = [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${PREFIX}${engine}:${from}:${to}:${hex}`;
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
  let index: string[] = idxResult[INDEX_KEY] ?? [];

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
      if (typeof v === 'string') {
        value = v;
        // 命中 → 刷新 index 位置
        return refreshIndex(key);
      }
      return undefined;
    })
    .catch(() => {});

  return chain.then(() => value);
}

/**
 * 写入缓存条目。
 * 自动维护 LRU index —— 超过 MAX_ENTRIES 则淘汰最旧的条目。
 */
export function cacheSet(key: string, value: string): Promise<void> {
  chain = chain
    .then(() => chrome.storage.local.set({ [key]: value }))
    .then(() => refreshIndex(key))
    .catch(() => {});

  return chain;
}

/** 清空全部缓存。串在 index 链上，确保与并发写入不交叉。 */
export function cacheClear(): Promise<void> {
  chain = chain
    .then(async () => {
      const idxResult = await chrome.storage.local.get(INDEX_KEY);
      const index: string[] = idxResult[INDEX_KEY] ?? [];
      if (index.length > 0) {
        await chrome.storage.local.remove(index);
      }
      await chrome.storage.local.remove(INDEX_KEY);
    })
    .catch(() => {});

  return chain;
}
