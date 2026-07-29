# 阶段 1 — 设置与存储层

## 目标

一次性定死全局 settings schema，实现设置读写与变更订阅、翻译结果缓存、BYOK 密钥存储三个模块。popup 从静态页变为读写真实设置。本阶段结束后，在 popup 里改设置能持久化，重启浏览器后仍在。

## 前置依赖

阶段 0：WXT 骨架可加载、`tokens.css` 就位、popup 静态 UI 已实现。

## 交付文件清单

```
src/storage/
├── schema.ts        # Settings 类型定义 + DEFAULT_SETTINGS，全局唯一真相来源
├── settings.ts      # 读写 chrome.storage.sync + 变更订阅
├── cache.ts         # 翻译结果缓存，chrome.storage.local + LRU
└── keys.ts          # BYOK 密钥，chrome.storage.local（与设置隔离，不同步）

entrypoints/popup/main.ts    # 改为读写真实设置
```

## 关键代码骨架

### `src/storage/schema.ts`

**这个文件是全局唯一真相来源。** 后续所有阶段新增配置项都改这里，不要在别处另开对象。

```typescript
export type DisplayMode  = 'bilingual' | 'translation-only';
export type StyleId      = 'default' | 'dim' | 'underline' | 'bold' | 'italic' | 'fade';
export type EngineId     = 'google-web' | 'bing-edge' | 'openai' | 'deepl' | 'gemini';
export type HotkeyAction =
  | 'toggle-translate'    // 全页翻译开关
  | 'toggle-mode'         // 对照 ↔ 仅译文
  | 'translate-paragraph' // 翻译光标所在段
  | 'toggle-extension';   // 扩展总开关

export interface Settings {
  enabled: boolean;

  /** 引擎优先级列表，router 按序尝试，前一个失败切下一个 */
  enginePriority: EngineId[];

  from: string;              // 'auto' 或 BCP-47 语言码
  to:   string;              // BCP-47 语言码

  displayMode: DisplayMode;
  style:       StyleId;
  customCss:   string;       // 仅声明块，不含选择器（阶段 4 校验）

  /** 平台无关的组合键，形如 'Mod+Shift+Y'。阶段 6 使用 */
  hotkeys: Record<HotkeyAction, string>;

  /** 站点名单。mode 决定 list 是黑名单还是白名单 */
  siteList: { mode: 'blacklist' | 'whitelist'; list: string[] };

  showFloatingBall:   boolean;
  showParagraphBtn:   boolean;
  maxConcurrency:     number;
  useCache:           boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  enginePriority: ['google-web', 'bing-edge'],
  from: 'auto',
  to: 'zh-CN',
  displayMode: 'bilingual',
  style: 'default',
  customCss: '',
  hotkeys: {
    'toggle-translate':    'Mod+Shift+Y',
    'toggle-mode':         'Mod+Shift+M',
    'translate-paragraph': 'Mod+Shift+D',
    'toggle-extension':    'Mod+Shift+E',
  },
  siteList: { mode: 'blacklist', list: [] },
  showFloatingBall: true,
  showParagraphBtn: true,
  maxConcurrency: 6,
  useCache: true,
};
```

### `src/storage/settings.ts`

```typescript
import { Settings, DEFAULT_SETTINGS } from './schema';

const KEY = 'pt-settings';

/** 内存副本。content script 的热路径不能每次都 await storage */
let current: Settings = DEFAULT_SETTINGS;
let ready: Promise<Settings> | null = null;

/** 首次调用触发加载；后续复用同一个 Promise，避免并发重复读 */
export function settingsReady(): Promise<Settings> {
  if (!ready) {
    ready = chrome.storage.sync.get(KEY).then(r => {
      // 与默认值浅合并 —— 版本升级新增字段时，老用户不会拿到 undefined
      current = { ...DEFAULT_SETTINGS, ...(r[KEY] ?? {}) };
      return current;
    });
  }
  return ready;
}

/** 同步读取内存副本。调用前必须已 await settingsReady() */
export function getSettings(): Settings {
  return current;
}

export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch };
  await chrome.storage.sync.set({ [KEY]: current });
}

/** 跨上下文变更订阅：popup 改设置，所有已打开标签页的 content script 立即收到 */
export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || !changes[KEY]) return;
    current = { ...DEFAULT_SETTINGS, ...changes[KEY].newValue };
    fn(current);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
```

### `src/storage/cache.ts`

```typescript
const PREFIX = 'pt-c:';
const MAX_ENTRIES = 5000;
const INDEX_KEY = 'pt-cache-index';   // 单独存 key 列表，用于 LRU 淘汰

/** key = engine:from:to:hash(text)，跨站点共享 */
export async function cacheKey(
  engine: string, from: string, to: string, text: string,
): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${PREFIX}${engine}:${from}:${to}:${hex}`;
}

export async function cacheGet(key: string): Promise<string | null> { /* ... */ }

/** 写入后检查 index 长度，超过 MAX_ENTRIES 则批量淘汰最旧的一批 */
export async function cacheSet(key: string, value: string): Promise<void> { /* ... */ }

export async function cacheClear(): Promise<void> { /* ... */ }
```

### `src/storage/keys.ts`

```typescript
import type { EngineId } from './schema';

const KEY = 'pt-keys';

/** BYOK 密钥单独存 local，不进 sync */
export async function getKey(engine: EngineId): Promise<string | undefined> { /* ... */ }
export async function setKey(engine: EngineId, value: string): Promise<void> { /* ... */ }
```

## 实现要点与取舍

**为什么 schema 要在阶段 1 一次定死。** 后续 7 个阶段每个都要读写设置。若边做边加字段，会反复出现"阶段 4 加了个字段，阶段 1 的默认值合并逻辑没覆盖到"的问题。宁可现在多想十分钟，把阶段 6 的快捷键、阶段 4 的样式全部预留好。**预留字段不实现功能是零成本的，事后加字段要改 N 处。**

**sync 与 local 的划分标准是"该不该跟着账号走"。**

| 数据 | 位置 | 理由 |
|---|---|---|
| 设置 | `chrome.storage.sync` | 换设备应保留偏好；配额 100KB 够用 |
| 翻译缓存 | `chrome.storage.local` | 体量大（5000 条），sync 配额装不下，且无跨设备价值 |
| BYOK 密钥 | `chrome.storage.local` | **不应跟随账号在云端流转**，属安全边界 |

**内存副本 + `settingsReady()` 是为了热路径性能。** content script 每翻译一个段落都要读引擎、语言、样式配置。若每次 `await chrome.storage.sync.get()`，翻译一页几百段就是几百次异步 IO。做法是启动时 await 一次，之后同步读内存，靠 `onSettingsChanged` 保持一致。

**读取时必须与 `DEFAULT_SETTINGS` 浅合并。** 版本升级新增字段时，老用户存储里没有该键，不合并就会拿到 `undefined` 并在下游炸掉。这是扩展升级最常见的崩溃来源。

**LRU 的 index 单独存一个 key。** `chrome.storage.local` 没有"列出所有 key 并按时间排序"的原生能力，`getBytesInUse` 也不给分项。维护一个独立的 key 列表是唯一可行的淘汰方案。

**缓存 key 不含站点信息 —— 这是刻意的。** 同一段英文在不同网站只翻一次，跨站点共享缓存。这是相比"缓存挂在页面 localStorage"的明确改进。

## DoD 验收标准

- [ ] `schema.ts` 覆盖全部 9 个阶段所需配置项，后续阶段无需新增字段
- [ ] popup 的引擎选择、语言对、开关能读出真实设置并写回
- [ ] 改设置 → 关闭 popup → 重开 → 设置保持
- [ ] 重启浏览器后设置仍在
- [ ] 打开两个 popup（或 popup + options），在一处改设置，另一处通过 `onSettingsChanged` 即时更新
- [ ] 首次安装（清空 storage 后）读取返回完整的 `DEFAULT_SETTINGS`，无 `undefined` 字段
- [ ] 模拟版本升级：手动写入一个缺字段的旧设置对象，读取后缺失字段被默认值补齐
- [ ] 缓存写入 5001 条后，条目数稳定在 5000

## 验证步骤

```bash
pnpm dev
```

1. 加载扩展，打开 popup，切换目标语言为「日本語」
2. 关闭 popup 重开 → 语言仍是日本語
3. 完全退出 Chrome 再启动 → 语言仍是日本語

**跨上下文同步**：打开 options 页，同时打开 popup。在 popup 改目标语言 → options 页的语言选择器应立即跟随变化，无需刷新。

**默认值合并**（在 popup 的 DevTools Console 执行）：

```javascript
// 写入一个缺字段的旧版设置
await chrome.storage.sync.set({ 'pt-settings': { to: 'ko' } });
// 刷新 popup 后检查
const r = await chrome.storage.sync.get('pt-settings');
console.log(r['pt-settings']);
// 预期：to 为 'ko'，其余字段被 DEFAULT_SETTINGS 补齐，无 undefined
```

**LRU 淘汰**：

```javascript
// 在 background 的 DevTools Console 执行
for (let i = 0; i < 5001; i++) {
  await cacheSet(await cacheKey('google-web', 'en', 'zh-CN', `text-${i}`), `译文-${i}`);
}
const idx = (await chrome.storage.local.get('pt-cache-index'))['pt-cache-index'];
console.log(idx.length);   // 预期 5000
```

**密钥隔离自查**：

```javascript
// sync 区不应出现任何密钥
console.log(await chrome.storage.sync.get(null));   // 预期不含 pt-keys
```
