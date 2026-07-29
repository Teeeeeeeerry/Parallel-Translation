import type { Settings } from './schema';
import { DEFAULT_SETTINGS } from './schema';

const KEY = 'pt-settings';

/** 内存副本。content script 的热路径不能每次都 await storage。 */
let current: Settings = DEFAULT_SETTINGS;
let ready: Promise<Settings> | null = null;

/**
 * 首次调用触发加载；后续复用同一个 Promise，避免并发重复读。
 * 读取时与 DEFAULT_SETTINGS 浅合并 —— 版本升级新增字段时老用户不会拿到 undefined。
 */
export function settingsReady(): Promise<Settings> {
  if (!ready) {
    ready = chrome.storage.sync.get(KEY).then((r) => {
      current = { ...DEFAULT_SETTINGS, ...(r[KEY] ?? {}) };
      return current;
    });
  }
  return ready;
}

/** 同步读取内存副本。调用前必须已 await settingsReady()。 */
export function getSettings(): Settings {
  return current;
}

/** 部分更新设置并写回 sync。自动合并到内存副本。 */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch };
  await chrome.storage.sync.set({ [KEY]: current });
}

/**
 * 跨上下文变更订阅。
 * popup 改设置 → 所有已打开标签页的 content script 立即收到回调。
 *
 * 返回取消订阅函数。
 */
export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'sync' || !changes[KEY]) return;
    current = { ...DEFAULT_SETTINGS, ...changes[KEY].newValue };
    fn(current);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
