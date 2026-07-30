# 阶段 2 DoD 验收报告 #2（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md` |
| 被测提交 | `2bc8e10` fix: DoDR-1 六项修复（分支 `v0.3-engines`） |
| 上一轮 | [DoDR-1](DoDR-1.md)（`91eab65`，未通过） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + **构建产物静态审计** + Node 桩测试（真实 `router`/`engines`/`gate` 源码）31 条断言，通过 30 / 失败 1 + 两端点实网连通 + `en.wikipedia.org/wiki/Translation` 真实 DOM 上的注入/还原/注入面测试 |
| **结论** | **未通过** — 上轮 4 个待修项已修好 3 个半；但本轮查出一个更靠上游的 P0：**背景页从不加载用户设置**，DoD 第 3 条端到端不成立 |

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P2-1 | `route()` 丢弃 `req.from` / `req.to` | ✅ 已修，T8 转绿 |
| P2-2 | `innerHTML` 拼接：还原丢结构 + 可执行注入 | ✅ 已修，真实页面逐字节还原、译文按纯文本渲染 |
| P2-3 | 工具栏点击不触发翻译、开关语义混用 | ⚠️ 控件已拆开，但 DoD 文本未同步，且 `enabled` 现在无人消费（P2-10） |
| P2-4 | 采集范围过宽（1030 元素） | ⚠️ 降到 722，导航/页脚清零；剩余 155 个不可见元素与 164 条参考文献仍在（P2-11） |
| P2-5 | 闸门按调用新建，分批并行会破上限 | ✅ 已修，两次并行 `route()` 峰值仍为 6（T10）；但引入 P2-9 |
| P2-7 | `sendResponse` 的 `translated` 恒为反 | ✅ 已修，改用 `willTranslate` 预判值 |

---

## 2. 结果总览

| # | DoD 项 | 上轮 | 本轮 |
|---|---|---|---|
| 1 | 点工具栏图标，段落下方出现中文译文 | ⚠️ | ⚠️ 入口改为 popup 内「翻译本页」，DoD 文本待同步 |
| 2 | 再次点击，译文消失（还原原文） | ⚠️ | ✅ |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ✅ | ❌ **背景页读不到设置**（P2-8） |
| 4 | 屏蔽 Google 后自动切 Bing | ✅ | ✅ |
| 5 | 两引擎均不可用时给出可读错误 | ✅ | ✅ |
| 6 | 二次翻译命中缓存，无新请求 | ✅ | ✅ |
| 7 | 并发不超过 6 | ✅ | ✅（并行调用亦守住；但 `maxConcurrency` 设置失效，P2-9） |
| 8 | 无 `host_permissions` | ✅ | ✅ |
| — | `typecheck` / `build` | ✅ | ✅ |
| — | `route()` 尊重入参语言对 | ❌ | ✅ |

DoD 3 上轮判 ✅ 是桩测里显式 `await settingsReady()` 造成的假阳性——那行代码只存在于测试台，扩展里没有。本轮补了构建产物审计才暴露出来，此处更正。

---

## 3. 待修问题

### P2-8 背景页从不加载用户设置（P0，阻塞 DoD 3）

`entrypoints/background.ts` 既没有 `await settingsReady()`，也没有 `onSettingsChanged()`。而 `getSettings()` 返回的是模块内存副本 `current`，它只在 `settingsReady()` 或 `onSettingsChanged` 回调里被赋值——两者在 SW 里都没跑过。构建产物直接可证：

```
grep -c settingsReady          background.js → 0
grep -c chrome.storage.sync.get background.js → 0
grep -o 'enginePriority:\[[^]]*\]' background.js
  → enginePriority:["google-web","bing-edge"]     ← 编译期常量
```

后果：popup 里改引擎/语言/缓存开关，写进了 `chrome.storage.sync`，但 `route()` 永远按 `DEFAULT_SETTINGS` 执行。

- `enginePriority` 锁死在 `['google-web','bing-edge']` → **DoD 第 3 条端到端不成立**（桩测 T4 只证明了 router 逻辑本身正确）；
- `useCache` 锁死 `true`、`maxConcurrency` 锁死 `6`——恰好与默认值相同，所以 DoD 6、7 看上去是过的，实际是碰巧。

content script 侧没有这个问题（`content.ts:15` 有 `await settingsReady()`），这也是语言对能生效、引擎优先级不能生效的原因：前者由 content 传参，后者由 background 自己读。

修法（background 入口顶部）：

```typescript
export default defineBackground(() => {
  settingsReady();          // 首次加载
  onSettingsChanged(() => {}); // 注册监听，保持 current 与 sync 同步
  ...
});
```

SW 会被休眠回收，重新唤醒时模块重新求值，`settingsReady()` 返回的 Promise 也随之重建，因此更稳妥的做法是在 `onMessage` 处理里 `await settingsReady()` 之后再 `route()`——保证每次唤醒后的第一条消息也拿到真实设置。

### P2-9 闸门上限在 import 时求值，`maxConcurrency` 设置失效（P1）

`src/engines/google-web.ts:41`：

```typescript
const gate = createGate(getSettings().maxConcurrency);   // 模块顶层
```

P2-5 的方向对了（单例共享），但求值时机错了：模块 import 发生在任何设置加载之前，`getSettings()` 此刻必然返回 `DEFAULT_SETTINGS`。桩测（唯一一条失败）：

```
patchSettings({ maxConcurrency: 2 })
route(12 段文本)  →  实测并发峰值 6，期望 ≤2
```

即便 P2-8 修好，这一行仍然读不到用户值。改成惰性单例，把上限的读取推迟到首次使用：

```typescript
let gate: ReturnType<typeof createGate> | null = null;
function getGate() {
  return (gate ??= createGate(getSettings().maxConcurrency));
}
```

设置变更后需重建闸门的话，在 `onSettingsChanged` 里把 `gate = null` 即可。

### P2-10 总开关 `enabled` 无人消费（P1）

P2-3 把控件拆成「总开关」和「翻译本页」之后，`enabled` 只剩写入方：全仓库对它的读取为 0 处（`content.ts` / `background.ts` / `router.ts` / `collect.ts` 均无）。关掉总开关，再点「翻译本页」照样翻译。

上轮是"两个语义挤在一个控件"，这轮变成"一个控件没有语义"。`doTranslate()` 开头补一句即可：

```typescript
if (!getSettings().enabled) return;
```

（阶段 3 的 `siteList` 判断也落在同一位置，可一并预留。）

### P2-11 采集仍含不可见文本与参考文献（P2）

`collect.ts` 的 SKIP 清单生效了，但覆盖不全。同一 Wikipedia 页实测：

| 指标 | 上轮 | 本轮 |
|---|---|---|
| 采集元素总数 | 1030 | 722 |
| 位于 `nav`/`footer`/`aside` 内 | 96 | 0 ✅ |
| 位于 `#mw-content-text` 之外 | — | 162 |
| **渲染尺寸为 0（不可见）** | — | **155** |
| 参考文献条目（`.references li`） | — | 164 |
| 采集总字符数 | — | 141,354 |

正文外的 162 个按祖先归类：`.vector-menu-content-list` 134（语言列表 + 工具菜单，其中 155 个不可见项主要来自这里）、`#mw-hidden-catlinks` 21（**CSS 隐藏的分类**）、`#mw-normal-catlinks` 6、`.mw-body-header` 1。

两点值得注意：

1. **SKIP 里的 `.reflist` 在本页压根不匹配**——这页参考文献的实际容器是 `.references`（`document.querySelector('.reflist')` 为 `null`，而 `.references li` 有 164 条）。选择器是照着旧版皮肤写的。
2. **没有可见性判断**，所以 155 个 `display:none` 的元素照样被翻译并计费。

按当前采集量，一次全页翻译走 Google 是 722 个 HTTP 请求（闸门 6 并发，粗估 2 分钟量级）；走 Bing 按 45k 字符分批约 4 个请求。阶段 3 的 walker 至少要补：`.references,.refbegin,.mw-references-wrap,.vector-menu-content-list,#catlinks` 以及一条 `getBoundingClientRect()` 尺寸为 0 即跳过的规则。

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                                       → 0 error
pnpm build                                           → 46.42 kB
grep host_permissions .output/chrome-mv3/manifest.json → 无（DoD 8 ✅）
grep settingsReady   .output/chrome-mv3/background.js  → 0 处（P2-8）
```

### 4.2 桩测试（真实源码，替身 `fetch` / `chrome.storage`）

| 编号 | 断言 | 结果 |
|---|---|---|
| T1 / T2 | 闸门峰值与保序；Google 30 段顺序对应、峰值 6、`sl=auto` 透传 | ✅ |
| T3 | Google 抛错自动切 Bing；`from=auto` 传空串；3 段 1 次 POST；`detectedFrom` 透出 | ✅ |
| T4 | 优先级置 Bing 首位 → 无 Google 请求 | ✅ |
| T5 | 401 清空令牌后重取且复用；`exp` 过期每次重取 | ✅ |
| T6 | 首次 3 请求 / 二次 0 请求；部分命中只请求未命中项且槽位顺序正确 | ✅ |
| T7 | 全引擎失败抛「所有引擎均失败」，含两个引擎标识 | ✅ |
| **T8** | `route()` 把 `req.from`/`req.to` 传给引擎（`sl=en&tl=ja`） | ✅ **上轮失败，已修** |
| T9 | 优先级全为未注册引擎 → 报错且不发请求 | ✅ |
| **T10** | 两次并行 `route()`（各 20 段）总并发峰值 ≤6，两批结果各自保序 | ✅ **P2-5 已修** |
| **T11** | `maxConcurrency=2` 时并发 ≤2 | ❌ 实测 6（P2-9） |

实网连通（真实端点）：`google → ["你好世界","早上好"]`；`bing → ["你好，世界","早上好"] detectedFrom=en`。

### 4.3 真实 DOM（`en.wikipedia.org/wiki/Translation`）

| 观察项 | 上轮 | 本轮 |
|---|---|---|
| 注入后原文链接保留数 | 0 | **11**（原 11） |
| 还原后 `innerHTML` 与注入前一致 | ❌ | **✅ 逐字节一致** |
| 还原后链接数 | 0/11 | **11/11** |
| 译文含 `<img onerror>` / `<script>` 时生成元素 | ❌ 生成 `<img>` | **✅ 0 个，按纯文本渲染** |
| 注入→还原→再注入→再还原 幂等 | — | ✅ `innerHTML` 复原 |
| 对未注入元素调 `removeSimple` | — | ✅ 无副作用 |
| 重新采集跳过已翻译容器 | ✅ | ✅ |
| `data-pt` 注入/清除 | ✅ | ✅ |
| 采集元素数 / 不可见元素数 | 1030 / — | 722 / **155**（P2-11） |

未覆盖：扩展装入浏览器后的端到端消息链路（`background ↔ content`）。P2-8 恰好落在这条未覆盖路径上——它在桩测里不可见，只能靠产物审计或真机复测发现。**P2-8 修好后必须补一次真机验证**，这是本阶段判定通过的前置条件。

---

## 5. 复测清单

1. popup 切到 Bing 优先 → 刷新页面重新翻译 → Network 只见 `api-edge.cognitive.microsofttranslator.com`，无 `translate.googleapis.com`（**真机验证，不接受桩测替代**）。
2. SW 休眠后（`chrome://serviceworker-internals` 停止，或静置 30s）再次翻译，仍走用户设置的引擎。
3. `patchSettings({ maxConcurrency: 2 })` 后翻译长页面，Network 同时 pending ≤2。
4. 关闭总开关 → 点「翻译本页」→ 页面无变化。
5. `collectSimple()` 在同一 Wikipedia 页返回的元素中，渲染尺寸为 0 的数量为 0，`.references li` 数量为 0。
6. `docs/phases/phase-2-engines.md` 的 DoD 第 1 条改写为「popup 中点『翻译本页』」，与实现对齐。
