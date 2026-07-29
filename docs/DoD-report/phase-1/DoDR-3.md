# 阶段 1 DoD 验收报告 #3（P2-1 复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 1 — 设置与存储层 |
| 验收依据 | `docs/phases/phase-1-storage.md` |
| 被测提交 | `1aea683`（分支 `v0.2-storage`） |
| 上轮报告 | [`DoDR-2.md`](./DoDR-2.md)（被测 `2537175`，通过，遗留 P2-1） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + Node 桩测试，63 条断言，**通过 63 / 失败 0** |
| **结论** | **通过** — 8 项 DoD 全部满足，P2-1 已关闭，无新增问题 |

---

## 1. P2-1 关闭情况

`patchSettings` 改用 `mergeInto(current, patch)`；原 `merge()` 保留为「base 固定是 `DEFAULT_SETTINGS`」的特化。嵌套键（`hotkeys` / `siteList` / `models`）现在只在 `mergeInto` 里枚举一处，读写两条路径共用 —— 符合上轮报告提的「日后加第四个嵌套对象只改一处」。

`patch.x ? {...base.x, ...patch.x} : base.x` 的写法也对：patch 里没这个键时原样保留 base 的引用，不会因为 `{...undefined}` 造出一个新空对象把 base 的值抹掉。

DoDR-2 给出的那条断言现已通过：

```javascript
await patchSettings({ hotkeys: { 'toggle-translate': 'Mod+K' } });
await patchSettings({ hotkeys: { 'toggle-mode': 'Mod+J' } });
getSettings().hotkeys['toggle-translate']   // → 'Mod+K'（上轮 undefined）
```

完整验证矩阵：

| 检查点 | DoDR-2 | 本轮 |
|---|---|---|
| 连续嵌套 patch 后先前的自定义值 | `undefined` | `'Mod+K'` |
| 存储中 `hotkeys` 的键数 | 1 | 4 |
| 重开上下文后自定义值 | 被 `merge()` 补成默认值 | 仍是 `'Mod+K'` |
| 未 patch 的键 | — | 保持默认 `'Mod+Shift+E'` |
| 跨上下文回调载荷的兄弟键 | — | 完整，4 键齐全 |

**语义边界一并确认**（防止「修过头」把该替换的也合并了）：

| 场景 | 期望 | 实际 |
|---|---|---|
| `patch { siteList: { mode } }` | `list` 保留 | ✅ `[]` |
| `patch { siteList: { list } }` | `mode` 保留 | ✅ `'whitelist'` |
| `list` 数组本身 | 整体替换，不逐元素合并 | ✅ `["a.com"]` |
| `models` 连续 patch 不同引擎 | 互不覆盖 | ✅ `{openai, deepl}` 并存 |
| `enginePriority` 数组 | 整体替换 | ✅ `["deepl"]` |
| 多个顶层字段同时 patch | 各自生效，不牵连其他 | ✅ |

---

## 2. 全量回归

前两轮的 47 条断言全部重跑，无回归：

| 分组 | 断言数 | 结果 |
|---|---|---|
| 默认值 / 首次安装（T1、T3） | 5 | ✅ |
| 持久化与重开（T2） | 3 | ✅ |
| 跨上下文同步（T4、T17） | 7 | ✅ |
| 嵌套补齐（T3b、T9） | 4 | ✅ |
| 缓存基础与 LRU（T5、T6、T10） | 12 | ✅ |
| 缓存并发（T7、T11、T12） | 8 | ✅ |
| 密钥隔离（T8） | 6 | ✅ |
| `patchSettings` 语义（T13–T16） | 18 | ✅ |

关键数据点未变：5001 条顺序写入后 index 5000 / 实体 5000 / 零孤儿；40 次 set-get 交叉并发零孤儿零串号；`cacheKey` 的 SHA-1 校验正确；sync 全量转储不含密钥明文。

`pnpm typecheck` 零错误，`pnpm build` 产出 24.29 kB（上轮 24.23 kB）。

---

## 3. 遗留人工验证

三轮均为逻辑等价验证（Node 桩模拟 `chrome.storage`），以下两项建议 `pnpm dev` 加载扩展后确认一次：

- [ ] 完全退出 Chrome 再启动，目标语言仍是上次所选
- [ ] popup 与 options 同时打开，popup 改语言 → options 页即时变化，无需刷新

**阶段 1 关闭，可进入阶段 2。**
