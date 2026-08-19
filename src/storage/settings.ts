import type { DeepPartial, Settings } from './schema';
import { DEFAULT_SETTINGS, clampConcurrency } from './schema';

const KEY = 'pt-settings';

/** 内存副本。content script 的热路径不能每次都 await storage。 */
let current: Settings = DEFAULT_SETTINGS;
let ready: Promise<Settings> | null = null;

/**
 * 将 patch 深度合并到 base。
 * 嵌套对象（hotkeys / siteList / models）递归到叶子，
 * 其余字段浅覆盖。嵌套键单一定义，日后加第四个嵌套对象只改此处。
 */
function mergeInto(base: Settings, patch: DeepPartial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    // #172: 任何写入口（导入/跨上下文 patch）都可能绕过 UI 下拉 ——
    // maxConcurrency <= 0 会让并发闸门永久饿死，统一钳制到合法范围
    maxConcurrency:
      patch.maxConcurrency === undefined
        ? base.maxConcurrency
        : clampConcurrency(patch.maxConcurrency),
    hotkeys: patch.hotkeys
      ? { ...base.hotkeys, ...patch.hotkeys }
      : base.hotkeys,
    siteList: patch.siteList
      ? { ...base.siteList, ...patch.siteList }
      : base.siteList,
    models: patch.models
      ? { ...base.models, ...patch.models }
      : base.models,
  };
}

/**
 * 合并存储值与默认值 —— mergeInto 的特化，base 固定为 DEFAULT_SETTINGS。
 */
function merge(stored: Partial<Settings> | undefined): Settings {
  return mergeInto(DEFAULT_SETTINGS, stored ?? {});
}

/**
 * 首次调用触发加载；后续复用同一个 Promise，避免并发重复读。
 */
export function settingsReady(): Promise<Settings> {
  if (!ready) {
    ready = chrome.storage.sync
      .get(KEY)
      .then((r) => {
        current = merge(r[KEY] as Partial<Settings> | undefined);
        return current;
      })
      .catch((e) => {
        // 失败的 Promise 不能留在缓存里 —— 否则首次读取一旦失败，
        // 之后每次 settingsReady() 都拿到同一个 rejected Promise，
        // 翻译在整个上下文生命周期内永久不可用。
        ready = null;
        throw e;
      });
  }
  return ready;
}

/** 同步读取内存副本。调用前必须已 await settingsReady()。 */
export function getSettings(): Settings {
  return current;
}

/** 部分更新设置并写回 sync。嵌套对象递归合并，不会丢兄弟键。 */
export async function patchSettings(patch: DeepPartial<Settings>): Promise<void> {
  // #167: 跨上下文并发写保护 —— 写前重读存储，基于最新值合并再写回
  // （compare-and-swap 风格）。每个上下文（popup/options/content）都有
  // 自己的内存副本，直接拿内存值整对象覆盖会静默回滚另一个上下文刚
  // 写入的修改（lost update）。
  const stored = ((await chrome.storage.sync.get(KEY))[KEY] as
    | Partial<Settings>
    | undefined);
  current = mergeInto(merge(stored), patch);
  await chrome.storage.sync.set({ [KEY]: current });
}

/**
 * 整对象替换设置（恢复默认专用）—— #169。
 * patchSettings 对嵌套对象（models/hotkeys/siteList）是合并语义，
 * DEFAULT_SETTINGS.models = {} 合并不掉用户自定义的模型名 —— 恢复
 * 默认必须整体替换而不是合并。替换本身就是有意的全量覆盖。
 */
export async function replaceSettings(next: Settings): Promise<void> {
  current = next;
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
    current = merge(changes[KEY].newValue as Partial<Settings> | undefined);
    fn(current);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
