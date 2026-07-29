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

/** 读取缓存条目。未命中返回 null。 */
export async function cacheGet(key: string): Promise<string | null> {
  const result = await chrome.storage.local.get(key);
  const value = result[key];
  if (typeof value === 'string') return value;
  return null;
}

/**
 * 写入缓存条目。
 * 自动维护 LRU index —— 超过 MAX_ENTRIES 则淘汰最旧的一批。
 */
export async function cacheSet(key: string, value: string): Promise<void> {
  // 1. 写入条目
  await chrome.storage.local.set({ [key]: value });

  // 2. 更新 index
  const idxResult = await chrome.storage.local.get(INDEX_KEY);
  let index: string[] = idxResult[INDEX_KEY] ?? [];

  // 同名 key 已存在则移除旧位置（后续追加到末尾，即"最近使用"）
  const existing = index.indexOf(key);
  if (existing !== -1) {
    index.splice(existing, 1);
  }
  index.push(key);

  // 3. 超过上限则批量淘汰最旧的
  if (index.length > MAX_ENTRIES) {
    const toEvict = index.splice(0, index.length - MAX_ENTRIES);
    await chrome.storage.local.remove(toEvict);
  }

  // 4. 写回 index
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

/** 清空全部缓存。 */
export async function cacheClear(): Promise<void> {
  const idxResult = await chrome.storage.local.get(INDEX_KEY);
  const index: string[] = idxResult[INDEX_KEY] ?? [];
  if (index.length > 0) {
    await chrome.storage.local.remove(index);
  }
  await chrome.storage.local.remove(INDEX_KEY);
}
