import type { Settings } from './schema';
import { DEFAULT_SETTINGS } from './schema';

const KEY = 'pt-settings';

/** 内存副本。content script 的热路径不能每次都 await storage。 */
let current: Settings = DEFAULT_SETTINGS;
let ready: Promise<Settings> | null = null;

/**
 * 合并存储值与默认值。
 * 顶层浅合并，嵌套对象（hotkeys / siteList）递归到叶子，
 * 避免旧版本只存了部分子键就把其余子键丢成 undefined。
 */
function merge(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(s.hotkeys ?? {}) },
    siteList: { ...DEFAULT_SETTINGS.siteList, ...(s.siteList ?? {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(s.models ?? {}) },
  };
}

/**
 * 首次调用触发加载；后续复用同一个 Promise，避免并发重复读。
 */
export function settingsReady(): Promise<Settings> {
  if (!ready) {
    ready = chrome.storage.sync.get(KEY).then((r) => {
      current = merge(r[KEY]);
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
    current = merge(changes[KEY].newValue);
    fn(current);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
