# 阶段 1 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 1 — 设置与存储层 |
| 验收依据 | `docs/phases/phase-1-storage.md` |
| 被测提交 | `7d30a2e`（分支 `v0.2-storage`） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + Node 桩测试（模拟 `chrome.storage` sync/local 双区与 `onChanged`），32 条断言，通过 29 / 失败 3 |
| **结论** | **未通过** — 8 项 DoD 中 6 项满足；2 项待修，另有 1 个会在阶段 2 触发的并发缺陷 |

---

## 1. 结果总览

| # | DoD 项 | 结果 |
|---|---|---|
| 1 | `schema.ts` 覆盖 9 个阶段所需配置项 | ❌ 缺 `models` |
| 2 | popup 读出真实设置并写回 | ✅ |
| 3 | 关闭 popup 重开，设置保持 | ✅ |
| 4 | 重启浏览器后设置仍在 | ✅ |
| 5 | 两上下文经 `onSettingsChanged` 即时同步 | ✅ |
| 6 | 清空 storage 后返回完整默认值，无 `undefined` | ✅ |
| 7 | 旧设置缺失字段被默认值补齐 | ⚠️ 顶层可以，嵌套不行 |
| 8 | 写入 5001 条后条目数稳定在 5000 | ✅ |
| — | `pnpm typecheck` / `pnpm build` | ✅ |
| — | 密钥不进 sync | ✅ |
| — | 并发写缓存（补充项） | ❌ |

---

## 2. 待修问题

### P1-1 `Settings` 缺 `models` 字段（阻塞 DoD 1）

`docs/phases/phase-7-options.md:65` 读取 `getSettings().models?.openai`，但 `src/storage/schema.ts` 没有这个字段。这正是本阶段「schema 一次定死」要避免的情况。建议现在补上：

```typescript
/** BYOK 引擎的模型名。阶段 7 使用。 */
models: Partial<Record<EngineId, string>>;
```

其余阶段引用的字段（`enginePriority` / `displayMode` / `style` / `customCss` / `hotkeys`）均已就位。

### P1-2 浅合并补不齐嵌套对象（阻塞 DoD 7）

`settings.ts:17` 与 `:47` 均为 `{ ...DEFAULT_SETTINGS, ...stored }`，嵌套对象被整体覆盖：

| 存储中的旧值 | 实际读取 | 应为 |
|---|---|---|
| `{ hotkeys: { 'toggle-translate': 'Mod+K' } }` | `hotkeys['toggle-mode']` 为 `undefined` | `'Mod+Shift+M'` |
| `{ siteList: { mode: 'whitelist' } }` | `siteList.list` 为 `undefined` | `[]` |

后果：阶段 6 遍历 `hotkeys` 拿到 `undefined` 组合键；阶段 3 对 `siteList.list` 调 `.includes()` 直接抛 `TypeError`。而这两个字段恰恰最可能随版本增删条目。文档实现要点写的是「浅合并」，与 DoD 第 7 条冲突，以 DoD 为准。建议抽一个合并函数，两处调用点共用（`onSettingsChanged` 目前重复实现了一遍）：

```typescript
function merge(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    hotkeys:  { ...DEFAULT_SETTINGS.hotkeys,  ...(s.hotkeys  ?? {}) },
    siteList: { ...DEFAULT_SETTINGS.siteList, ...(s.siteList ?? {}) },
  };
}
```

### P1-3 `cacheSet` 并发写入丢失 index（补充项，阶段 2 必踩）

`cache.ts:37-60` 的「读 index → 改 → 写回」非原子。20 条并发写入实测：

| 指标 | 实际 | 预期 |
|---|---|---|
| `pt-cache-index` 长度 | **1** | 20 |
| `pt-c:` 实体条目数 | 20 | 20 |

丢失的 19 条成为孤儿：占配额、永不被 LRU 淘汰、`cacheClear()` 也清不掉（它只删 index 里列出的 key），长期单向膨胀。阶段 2 的 `maxConcurrency: 6` 让这成为常态路径而非边界情况。建议把 index 更新串成一条 Promise 链：

```typescript
let chain: Promise<void> = Promise.resolve();

export function cacheSet(key: string, value: string): Promise<void> {
  chain = chain.then(() => doCacheSet(key, value)).catch(() => {});
  return chain;
}
```

另：`cacheGet` 命中时不刷新 index 位置，实际淘汰策略是「最近写入」而非注释所称的「最近使用」。对翻译缓存影响不大，但注释与实现应二选一改齐。

---

## 3. 通过项证据

**持久化与 popup 读写（DoD 2/3/4）**：popup 引用的 6 个 DOM id 与 `index.html` 逐一对上，`displayMode` 的 `<option>` 值与联合类型一致；`init()` 先 `await settingsReady()` 再渲染，不会在内存副本仍是默认值时刷 UI。`patchSettings({ to: 'ja' })` 后新建模块实例重读得 `'ja'`（「重开 popup」与「重启浏览器」对 `chrome.storage.sync` 是同一语义）。

**跨上下文同步（DoD 5）**：A 实例 `patchSettings` → B 实例回调在同轮微任务触发，载荷无 `undefined`，B 的 `getSettings()` 同步更新；退订函数生效。

**首次安装（DoD 6）**：清空 storage 后返回值与 `DEFAULT_SETTINGS` 深度相等，18 个顶层字段无一 `undefined`。

**LRU（DoD 8）**：顺序写入 5001 条后 index 5000、实体 5000、零孤儿；最旧条目已淘汰，最新条目命中；重复写同一 key 不重复入列。`cacheKey` 的 SHA-1 经独立校验正确（`hello` → `aaf4c61d…9434d`），key 不含站点信息，符合跨站点共享的设计意图。

**密钥隔离**：`pt-keys` 只在 local，sync 全量转储不含密钥明文；`removeKey` 不误伤其他引擎。

**构建**：`typecheck` 零错误，`build` 产出 23.88 kB，`chunks/settings-*.js` 被 popup 与 options 复用。

---

## 4. 复测清单

- [ ] `Settings` 含 `models`，`DEFAULT_SETTINGS` 有对应默认值
- [ ] 旧值 `{ hotkeys: { 'toggle-translate': 'Mod+K' } }` 读取后其余三个 action 有默认值；`{ siteList: { mode: 'whitelist' } }` 读取后 `list` 为 `[]`
- [ ] 合并逻辑只有一处实现，`onSettingsChanged` 复用它
- [ ] 20 条并发 `cacheSet` 后 index 长度为 20
- [ ] `cacheGet` 的 LRU 语义与注释一致
- [ ] 重跑 32 条断言 + `pnpm typecheck` + `pnpm build`

以下两项依赖真实浏览器，本轮为逻辑等价验证，建议 `pnpm dev` 后人工确认：

- [ ] 完全退出 Chrome 再启动，目标语言仍是上次所选
- [ ] popup 与 options 同时打开，popup 改语言 → options 页即时变化，无需刷新
