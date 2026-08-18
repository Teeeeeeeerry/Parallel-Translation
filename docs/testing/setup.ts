/**
 * 全局测试 Setup —— mock Chrome Extension API。
 *
 * vitest 的 jsdom 环境没有 chrome.storage / chrome.runtime 等 API，
 * 所有涉及这些 API 的模块都需要在此处提供 mock 实现。
 *
 * mock 规则：
 * - 默认返回合理空值，避免 undefined 导致的 TypeError
 * - 各测试文件可以 vi.hoisted() 或 beforeEach 覆盖具体行为
 */

import { vi } from 'vitest';

// ---- chrome.storage.local ----

const localStore = new Map<string, unknown>();

function createStorageArea(): chrome.storage.StorageArea {
  return {
    get: vi.fn().mockImplementation(
      (keys: string | string[] | Record<string, unknown> | null) => {
        if (keys === null) {
          // 返回全部
          const all: Record<string, unknown> = {};
          for (const [k, v] of localStore) all[k] = v;
          return Promise.resolve(all);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: localStore.get(keys) });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const k of keys) result[k] = localStore.get(k);
          return Promise.resolve(result);
        }
        // keys 是对象 → 返回默认值
        const result: Record<string, unknown> = {};
        for (const k of Object.keys(keys)) result[k] = localStore.get(k) ?? keys[k];
        return Promise.resolve(result);
      },
    ),
    set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) localStore.set(k, v);
      return Promise.resolve();
    }),
    remove: vi.fn().mockImplementation((keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) localStore.delete(k);
      return Promise.resolve();
    }),
    clear: vi.fn().mockImplementation(() => {
      localStore.clear();
      return Promise.resolve();
    }),
    getBytesInUse: vi.fn().mockResolvedValue(0),
  } as unknown as chrome.storage.StorageArea;
}

// ---- chrome.storage.sync ----

const syncStore = new Map<string, unknown>();

function createSyncArea(): chrome.storage.StorageArea {
  return {
    get: vi.fn().mockImplementation(
      (keys: string | string[] | Record<string, unknown> | null) => {
        if (keys === null) {
          const all: Record<string, unknown> = {};
          for (const [k, v] of syncStore) all[k] = v;
          return Promise.resolve(all);
        }
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: syncStore.get(keys) });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const k of keys) result[k] = syncStore.get(k);
          return Promise.resolve(result);
        }
        const result: Record<string, unknown> = {};
        for (const k of Object.keys(keys)) result[k] = syncStore.get(k) ?? keys[k];
        return Promise.resolve(result);
      },
    ),
    set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) syncStore.set(k, v);
      return Promise.resolve();
    }),
    remove: vi.fn().mockImplementation((keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) syncStore.delete(k);
      return Promise.resolve();
    }),
    clear: vi.fn().mockImplementation(() => {
      syncStore.clear();
      return Promise.resolve();
    }),
    getBytesInUse: vi.fn().mockResolvedValue(0),
  } as unknown as chrome.storage.StorageArea;
}

// ---- chrome.storage.onChanged ----

const changeListeners: Array<
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
> = [];

// ---- 安装全局 mock ----

vi.stubGlobal('chrome', {
  storage: {
    local: createStorageArea(),
    sync: createSyncArea(),
    onChanged: {
      addListener: vi.fn().mockImplementation(
        (
          cb: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => {
          changeListeners.push(cb);
        },
      ),
      removeListener: vi.fn().mockImplementation(
        (
          cb: (
            changes: Record<string, chrome.storage.StorageChange>,
            area: string,
          ) => void,
        ) => {
          const idx = changeListeners.indexOf(cb);
          if (idx !== -1) changeListeners.splice(idx, 1);
        },
      ),
      hasListener: vi.fn().mockReturnValue(false),
    },
  },
  runtime: {
    // 真实 content script 里 runtime.id 是扩展 id 字符串；messaging.ts
    // 的 isContextInvalidated 以 id == null 判定上下文失效
    id: 'mock-extension-id',
    getURL: vi.fn().mockImplementation((path: string) => `chrome-extension://mock/${path}`),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  i18n: {
    getMessage: vi.fn().mockImplementation((key: string) => key),
    getUILanguage: vi.fn().mockReturnValue('zh-CN'),
  },
});

// ---- 辅助函数 ----

/** 默认可见几何（jsdom 默认全 0 → 全部判不可见） */
const DEFAULT_VISIBLE_RECT: DOMRect = {
  x: 0, y: 0, width: 100, height: 20,
  top: 0, right: 100, bottom: 20, left: 0,
  toJSON: () => ({}),
} as DOMRect;

/**
 * 给元素 stub 一个可见的 getBoundingClientRect。
 * 返回原元素，便于链式调用；rect 可覆盖个别字段（如 200×30、30×20）。
 */
export function mockBoundingRect(
  el: Element,
  rect: Partial<DOMRect> = {},
): Element {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...DEFAULT_VISIBLE_RECT, ...rect }) as DOMRect;
  return el;
}

/**
 * 原型级 stub：全部元素（含运行中新建的，如 splitPre 切出的 span）
 * 都返回可见几何。返回恢复函数。
 */
export function mockAllBoundingRects(
  rect: Partial<DOMRect> = {},
): () => void {
  const proto = HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => DOMRect;
  };
  const orig = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () =>
    ({ ...DEFAULT_VISIBLE_RECT, ...rect }) as DOMRect;
  return () => {
    proto.getBoundingClientRect = orig;
  };
}

/** 清空内存中的 local + sync 存储，各测试文件的 beforeEach 中调用 */
export function resetStorage(): void {
  localStore.clear();
  syncStore.clear();
  changeListeners.length = 0;
}

/** 触发 storage 变更事件（模拟跨上下文同步） */
export function fireStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  area = 'sync',
): void {
  for (const cb of changeListeners) cb(changes, area);
}

/** 获取 local store 的快照（调试用） */
export function localStoreSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const [k, v] of localStore) snap[k] = v;
  return snap;
}

/** 获取 sync store 的快照（调试用） */
export function syncStoreSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const [k, v] of syncStore) snap[k] = v;
  return snap;
}
