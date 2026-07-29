# 阶段 1 DoD 验收报告 #2（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 1 — 设置与存储层 |
| 验收依据 | `docs/phases/phase-1-storage.md` |
| 被测提交 | `2537175`（分支 `v0.2-storage`） |
| 上轮报告 | [`DoDR-1.md`](./DoDR-1.md)（被测 `7d30a2e`，未通过） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + Node 桩测试，47 条断言，通过 46 / 失败 1 |
| **结论** | **通过** — 8 项 DoD 全部满足，上轮三项问题均已关闭；另发现 1 个不阻塞本阶段、但阶段 7 会踩的写入路径缺陷 |

---

## 1. 结果总览

| # | DoD 项 | DoDR-1 | 本轮 |
|---|---|---|---|
| 1 | `schema.ts` 覆盖 9 个阶段所需配置项 | ❌ | ✅ |
| 2 | popup 读出真实设置并写回 | ✅ | ✅ |
| 3 | 关闭 popup 重开，设置保持 | ✅ | ✅ |
| 4 | 重启浏览器后设置仍在 | ✅ | ✅ |
| 5 | 两上下文经 `onSettingsChanged` 即时同步 | ✅ | ✅ |
| 6 | 清空 storage 后返回完整默认值，无 `undefined` | ✅ | ✅ |
| 7 | 旧设置缺失字段被默认值补齐 | ⚠️ | ✅ |
| 8 | 写入 5001 条后条目数稳定在 5000 | ✅ | ✅ |
| — | `pnpm typecheck` / `pnpm build` | ✅ | ✅ |
| — | 密钥不进 sync | ✅ | ✅ |
| — | 并发写缓存 | ❌ | ✅ |
| — | `patchSettings` 传嵌套对象（新增项） | — | ❌ |

---

## 2. 上轮问题关闭情况

### P1-1 `Settings` 缺 `models` — 已关闭

`schema.ts` 新增 `models: Partial<Record<EngineId, string>>`，默认 `{}`。阶段 7 的 `getSettings().models?.openai` 不再落空。

### P1-2 嵌套对象合并 — 已关闭

抽出 `merge()` 函数，`hotkeys` / `siteList` / `models` 三个嵌套对象逐一与默认值合并，`settingsReady` 与 `onSettingsChanged` 共用同一实现。上轮失败的两条现已通过：

| 存储中的旧值 | DoDR-1 | 本轮 |
|---|---|---|
| `{ hotkeys: { 'toggle-translate': 'Mod+K' } }` | `toggle-mode` 为 `undefined` | `'Mod+Shift+M'` |
| `{ siteList: { mode: 'whitelist' } }` | `list` 为 `undefined` | `[]` |

### P1-3 缓存并发丢 index — 已关闭

index 变动全部串入一条 Promise 链，`cacheGet` 命中时也刷新位置。四组并发场景实测：

| 场景 | DoDR-1 | 本轮 |
|---|---|---|
| 20 条并发 `cacheSet` → index 长度 | 1 | 20 |
| 30 条并发 `cacheSet` → index 长度 | — | 30 |
| 30 条并发 `cacheGet` → 返回值与 key 对应 | — | 错配 0 条 |
| set/get 交叉并发 40 次 → index / 孤儿 | — | 40 / 0 |
| 4990 条铺底 + 30 条并发突破上限 | — | index 5000、实体 5000、无孤儿 |

`cacheGet` 命中后该 key 移到 index 末尾，未命中不污染 index，淘汰策略与「最近使用」的注释现已一致。链上每环都有 `.catch(() => {})`，单次失败不会卡死后续调用。

---

## 3. 新发现

### P2-1 `patchSettings` 传嵌套对象会丢兄弟键（不阻塞本阶段，阶段 7 会踩）

`settings.ts:45` 的 `current = { ...current, ...patch }` 仍是纯浅合并 —— 修复只覆盖了读取路径，写入路径没跟上。

```javascript
await patchSettings({ hotkeys: { 'toggle-mode': 'Mod+J' } });
getSettings().hotkeys['toggle-translate']   // → undefined
```

原来的四个快捷键只剩一个，且这个残缺对象会被原样写进 `chrome.storage.sync`。

**为什么上一轮没测出来。** DoDR-1 只验了「存储里已有旧数据 → 读出来补齐」，这是 DoD 第 7 条的字面要求。P2-1 是反方向：先写坏，再读回。写的时候把数据弄残，读的时候 `merge()` 又补上 —— 从「有没有 `undefined`」这个角度看一切正常，所以它藏得住。

**后果一：调用方自身的内存副本被破坏。** 直到下次重新加载才由 `merge()` 修好。阶段 6 改完快捷键后立刻读 `getSettings().hotkeys`，拿到的就是 `undefined`。重开一次 popup 即可恢复，不致命。

**后果二：用户的自定义值被静默丢弃。** 这条才是真问题：

| 步 | 操作 | 存储中的 `hotkeys` |
|---|---|---|
| 1 | 用户把 `toggle-translate` 改成 `Mod+K` | `{ toggle-translate: 'Mod+K', …另外三个 }` |
| 2 | 用户接着改 `toggle-mode` | `{ toggle-mode: 'Mod+J' }` ← 其余三键被整体替换掉 |
| 3 | 重开 popup，`merge()` 补齐 | `toggle-translate` 变成默认值 `'Mod+Shift+Y'` |

补回来的是默认值，不是用户设的 `Mod+K`。信息在第 2 步就已从存储里消失，**`merge()` 救不回来**。用户看到的现象是「我改了第二个快捷键，第一个自己变回去了」。

**为什么不计入阶段 1 判定。** DoD 第 7 条要求的是读取时补齐，已满足且实测通过。阶段 1 的唯一调用方是 popup，只 patch `to` / `from` / `enabled` / `displayMode` / `enginePriority` 这些顶层标量与数组，踩不到。阶段 7 会踩：options 页要为 `hotkeys`、`siteList`、`models` 三个嵌套对象逐项提供控件，且 DoD 明写「任一设置项修改后即时持久化」，每动一个子键就是一次嵌套 patch。

**改法**：让写入路径复用同一套合并。

```typescript
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  current = merge({ ...current, ...patch });
  await chrome.storage.sync.set({ [KEY]: current });
}
```

传入的是已完整的 `current` 叠加 patch，默认值不会覆盖用户值，结果等价于嵌套合并。若嫌 `merge()` 的语义（「与默认值合并」）在此处含糊，可另抽 `mergeInto(base, patch)`，与 `merge()` 共用同一份嵌套键列表 —— 关键是**嵌套键只在一处枚举**，日后往 `Settings` 加第四个嵌套对象时不会漏改。

---

## 4. 其余复测证据

**默认值与持久化**：清空 storage 后返回值与 `DEFAULT_SETTINGS` 深度相等，19 个顶层字段无一 `undefined`；`patchSettings({ to: 'ja' })` 后新建模块实例重读得 `'ja'`。

**跨上下文同步**：A 实例写入 → B 实例回调同轮微任务触发，载荷经 `merge()` 无 `undefined`，退订函数生效。

**LRU 基线**：顺序写入 5001 条后 index 5000、实体 5000、零孤儿，最旧淘汰、最新命中、重复写不重复入列。`cacheKey` 的 SHA-1 独立校验正确，key 不含站点信息。

**密钥隔离**：`pt-keys` 只在 local，sync 全量转储不含密钥明文，`removeKey` 不误伤其他引擎。

**构建**：`typecheck` 零错误，`build` 产出 24.23 kB（上轮 23.88 kB，增量来自 `merge()` 与缓存链）。

---

## 5. 遗留人工验证

以下两项依赖真实浏览器，两轮均为逻辑等价验证，建议 `pnpm dev` 加载扩展后确认一次：

- [ ] 完全退出 Chrome 再启动，目标语言仍是上次所选
- [ ] popup 与 options 同时打开，popup 改语言 → options 页即时变化，无需刷新

阶段 1 可以关闭，进入阶段 2。P2-1 建议在动阶段 7 之前顺手修掉，并补一条断言：

```javascript
await patchSettings({ hotkeys: { 'toggle-translate': 'Mod+K' } });
await patchSettings({ hotkeys: { 'toggle-mode': 'Mod+J' } });
getSettings().hotkeys['toggle-translate']   // 期望 'Mod+K'，现状 undefined
```
