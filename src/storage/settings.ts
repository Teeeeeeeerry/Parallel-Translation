import type { DeepPartial, Settings } from './schema';
import { DEFAULT_SETTINGS, clampConcurrency } from './schema';

const KEY = 'pt-settings';

/** 内存副本。content script 的热路径不能每次都 await storage。 */
let current: Settings = DEFAULT_SETTINGS;
let ready: Promise<Settings> | null = null;

/** 嵌套键合并策略（#234 数据驱动）：'merge' 逐键合并，'replace' 整体替换。 */
export type NestedMergeStrategy = 'merge' | 'replace';

/** 声明表能覆盖的嵌套键（Settings 中的对象类型键）。 */
export type NestedSettingsKey = 'hotkeys' | 'siteList' | 'models';

/**
 * 显式清空嵌套键的哨兵（#241）—— patchSettings({ models: CLEAR_NESTED })
 * 把该键重置为其默认值（models → {}，自定义模型名不残留）。
 */
export const CLEAR_NESTED: unique symbol = Symbol('pt-clear-nested');
export type ClearNested = typeof CLEAR_NESTED;

/** patchSettings 可接受的 patch 形状：嵌套键额外允许清空哨兵（#241）。 */
export type SettingsPatch = Omit<DeepPartial<Settings>, NestedSettingsKey> & {
  [K in NestedSettingsKey]?: DeepPartial<Settings>[K] | ClearNested;
};

/**
 * 嵌套键声明表（#234 / #241）—— 每个嵌套对象键声明合并策略。
 * 合并函数按此表驱动，替代硬编码的三键分支；整体替换（replaceSettings）
 * 同样走此表；日后新增嵌套对象只改此处一处。
 */
export const NESTED_KEYS: Record<NestedSettingsKey, NestedMergeStrategy> = {
  hotkeys: 'merge',
  siteList: 'merge',
  models: 'merge',
};

/**
 * 将 patch 深度合并到 base。
 * 嵌套对象（hotkeys / siteList / models）按 NESTED_KEYS 声明表逐键合并，
 * 其余字段浅覆盖。'replace' 策略下保持浅覆盖结果（patch 值整体替换）；
 * CLEAR_NESTED 哨兵把该键重置为其默认值（#241 显式置空）。
 */
function mergeInto(base: Settings, patch: SettingsPatch): Settings {
  // 浅覆盖。patch 的嵌套键为可选类型，展开后类型带 | undefined ——
  // 此处统一经声明表循环修正（下方对全部嵌套键重新赋值），
  // 与旧实现显式重写三个键的语义一致
  const merged = { ...base, ...patch } as Settings;

  for (const key of Object.keys(NESTED_KEYS) as NestedSettingsKey[]) {
    const pv = patch[key];
    const mergedValue: unknown =
      // #241 显式置空：哨兵按类型判定（跨模块实例同一语义 ——
      // resetModules 等场景下不同实例的 CLEAR_NESTED 不是同一
      // Symbol 对象，但都是 symbol 类型；设置值不可能为 symbol）
      typeof pv === 'symbol'
        ? DEFAULT_SETTINGS[key] // 重置为该键默认值（models → {}，自定义模型名不残留）
        : pv === undefined
          ? // patch 未携带该键（或显式 undefined）→ 保持 base 原值，
            // 浅覆盖阶段可能已把它冲掉，这里补回
            base[key]
          : NESTED_KEYS[key] === 'merge'
            ? // 逐键合并：patch 只覆盖提供的键，兄弟键保留
              { ...base[key], ...(pv as object) }
            : // 'replace'：整体替换，浅覆盖结果（patch 值）即为最终值
              pv;
    (merged as Record<NestedSettingsKey, unknown>)[key] = mergedValue;
  }

  // #172: 任何写入口（导入/跨上下文 patch）都可能绕过 UI 下拉 ——
  // maxConcurrency <= 0 会让并发闸门永久饿死，统一钳制到合法范围
  merged.maxConcurrency =
    patch.maxConcurrency === undefined
      ? base.maxConcurrency
      : clampConcurrency(patch.maxConcurrency);
  return merged;
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
export async function patchSettings(patch: SettingsPatch): Promise<void> {
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
 * 整对象替换设置（恢复默认专用）—— #169 → #241。
 * 替换语义由声明表机制驱动：整体替换时嵌套键按 replace 策略整体覆盖，
 * DEFAULT_SETTINGS.models = {} 替换掉用户自定义的模型名 —— 恢复默认
 * 后自定义模型名不残留。替代旧的「特例函数直接赋值」：嵌套键的策略
 * 只声明在 NESTED_KEYS 一处，新增嵌套对象无需再改这里。
 */
export async function replaceSettings(next: Settings): Promise<void> {
  // 经声明表循环的整体替换：每个嵌套键取 patch（=next）值作为最终值，
  // 与逐键合并语义区分开（#241）
  const merged = { ...next } as Settings;
  for (const key of Object.keys(NESTED_KEYS) as NestedSettingsKey[]) {
    (merged as Record<NestedSettingsKey, unknown>)[key] = next[key];
  }
  current = merged;
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
