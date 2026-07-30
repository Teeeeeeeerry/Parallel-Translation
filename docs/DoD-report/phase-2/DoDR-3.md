# 阶段 2 DoD 验收报告 #3（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md` |
| 被测提交 | `274311e` fix: DoDR-2 四项修复（分支 `v0.3-engines`） |
| 前两轮 | [DoDR-1](DoDR-1.md)（`91eab65`）、[DoDR-2](DoDR-2.md)（`2bc8e10`），均未通过 |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 构建产物审计 + Node 桩测试 32 条断言 ×2 组参数（各通过 31 / 失败 1，同一条）+ 两端点实网连通 + `en.wikipedia.org/wiki/Translation` 真实 DOM |
| **结论** | **有条件通过** — 代码层 8 项 DoD 全部满足；但 DoD 3 的真机端到端本环境无法执行，需用户自测确认（清单见 §5）。另有 1 个采集回归（页面标题不再翻译）与 2 项非阻塞风险 |

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P2-8 | 背景页从不加载用户设置（阻塞 DoD 3） | ✅ 已修，产物可证 |
| P2-9 | 闸门在 import 时求值，`maxConcurrency` 失效 | ✅ 首次读取已正确；闸门建好后改设置仍不重建（P2-13） |
| P2-10 | 总开关 `enabled` 无人消费 | ✅ 已修；但静默返回，用户无反馈（P2-14） |
| P2-11 | 采集含不可见元素与参考文献 | ✅ 全部清零；但误杀了页面标题（P2-12） |
| 文档 | DoD 第 1 条与实现对齐 | ❌ 未改，`phase-2-engines.md:267` 仍写「点击工具栏图标」 |

P2-8 的产物证据（`background.js` 已压缩，按调用形态核对）：

```
storage.sync.get            出现 1 次      ← 上轮为 0
storage.onChanged.addListener 出现 1 次    ← 上轮为 0
onMessage 处理链：J().then(()=>be(e.payload))
                  ↑settingsReady        ↑route     —— 先加载设置再路由
```

---

## 2. 结果总览

| # | DoD 项 | #1 | #2 | #3 |
|---|---|---|---|---|
| 1 | 点工具栏图标，段落下方出现译文 | ⚠️ | ⚠️ | ⚠️ 入口为 popup「翻译本页」，DoD 文本仍未同步 |
| 2 | 再次点击，译文消失（还原原文） | ⚠️ | ✅ | ✅ |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ✅假阳性 | ❌ | ✅ 代码与产物层成立，**真机待验证** |
| 4 | 屏蔽 Google 后自动切 Bing | ✅ | ✅ | ✅ |
| 5 | 两引擎均不可用时给出可读错误 | ✅ | ✅ | ✅ |
| 6 | 二次翻译命中缓存，无新请求 | ✅ | ✅ | ✅ |
| 7 | 并发不超过 6 | ✅ | ✅ | ✅ 且上限如实取自设置 |
| 8 | 无 `host_permissions` | ✅ | ✅ | ✅ |
| — | `typecheck` / `build` | ✅ | ✅ | ✅ |

---

## 3. 待修问题

### P2-12 页面标题不再被翻译（P1，采集回归）

`collect.ts:7` 的 SKIP 新增了 `.mw-body-header`，而 Wikipedia 的文章标题 `#firstHeading`（`<h1>`）正在这个容器里。实测：

```
h1 文本            "Translation"
是否被采集          false
被哪条规则拦下      .mw-body-header vector-page-titlebar …
采集结果里的 H1 数   0     ← 前两轮均为 1
```

`.mw-body-header` 在 DoDR-2 里只是"正文外元素"归类统计中的 1 条（页面标题本身），不在建议排除清单内。一篇文章最显眼的一行不翻译，用户第一眼就会发现。从 SKIP 里去掉 `.mw-body-header` 即可——它下面除了标题只有站点副标题，量极小。

### P2-13 闸门建好后不随设置重建（P2）

惰性单例修对了首次读取，但 `gate ??=` 之后永不更新。参数化桩测（同一套用例跑两遍，只改首次翻译时的 `maxConcurrency`）：

| 首次建闸门时的值 | T0 实测峰值 | 之后改为 | T11 实测峰值 |
|---|---|---|---|
| 6 | 6 ✅ | 2 | 6 ❌ |
| 2 | 2 ✅ | 6 | 2 ❌ |

即改 `maxConcurrency` 必须重启 Service Worker 才生效。不阻塞 DoD（默认值 6 与 DoD 要求一致），但 options 页放出这个设置项之前要补：

```typescript
onSettingsChanged(() => { gate = null; });   // 下次翻译按新上限重建
```

### P2-14 总开关关闭时静默返回（P2）

`content.ts:19` 的 `if (!s.enabled) return;` 位置正确，但返回后 `sendResponse({ ok: true, translated: willTranslate })` 仍报告 `translated: true`，且页面上没有任何提示。用户关掉总开关后点「翻译本页」，表现为按钮点了没反应、也不知道为什么。建议回一个明确状态（如 `{ ok: true, skipped: 'disabled' }`），popup 据此提示一行；或者干脆在总开关关闭时把「翻译本页」按钮置灰。

### 文档未同步（P1，遗留自 DoDR-2 复测清单第 6 条）

`docs/phases/phase-2-engines.md:267` 仍写「Wikipedia 英文页点击工具栏图标，段落下方出现中文译文」，而实现已改成 popup 内的「翻译本页」按钮（这是 DoDR-1 里选定的方案）。文档不改，下一轮验收还会在同一条上卡住。建议改为：

```markdown
- [ ] Wikipedia 英文页，popup 中点「翻译本页」，段落下方出现中文译文
- [ ] 再次点击，译文消失（还原原文）
```

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                                          → 0 error
pnpm build                                              → 47.35 kB
grep host_permissions .output/chrome-mv3/manifest.json  → 无（DoD 8 ✅）
background.js：storage.sync.get ×1、onChanged.addListener ×1、
               onMessage 内 settingsReady() → route()（P2-8 ✅）
```

### 4.2 桩测试（真实源码，替身 `fetch` / `chrome.storage`）

闸门是进程级单例，一次运行只能观测一个上限，因此同一套用例参数化跑两遍（`GATE_MAX=6` / `GATE_MAX=2`），两组各 32 条断言、结果一致：

| 编号 | 断言 | 结果 |
|---|---|---|
| **T0** | 首次翻译按设置建闸门，峰值**恰为** `maxConcurrency`（6 和 2 两组分别验证） | ✅ **P2-9 已修** |
| T1 | 闸门峰值 ≤6、保序返回、50 任务全完成 | ✅ |
| T2 | Google 30 段顺序严格对应；请求数=文本数；`sl=auto` 透传 | ✅ |
| T3 | Google 抛错自动切 Bing；`from=auto` 传空串；3 段 1 次 POST；`detectedFrom` 透出 | ✅ |
| T4 | 优先级置 Bing 首位 → 无 Google 请求 | ✅ |
| T5 | 401 清空令牌后重取且复用；`exp` 过期每次重取 | ✅ |
| T6 | 首次 3 请求 / 二次 0 请求；部分命中只请求未命中项且槽位顺序正确 | ✅ |
| T7 | 全引擎失败抛「所有引擎均失败」，含两个引擎标识 | ✅ |
| T8 | `route()` 把 `req.from`/`req.to` 传给引擎 | ✅ |
| T9 | 优先级全为未注册引擎 → 报错且不发请求 | ✅ |
| T10 | 两次并行 `route()` 总并发仍为闸门上限，两批各自保序 | ✅ |
| **T11** | 闸门建好后改 `maxConcurrency` 应生效 | ❌ 两组均不生效（P2-13） |

上轮 T11 曾"通过"，是因为 T0 已把单例锁在同一个值上，属测试台缺陷；本轮改为断言峰值**恰好等于**设定值并双向参数化，才测得准。

实网连通（真实端点）：`google → ["你好世界","早上好"]`；`bing → ["你好，世界","早上好"] detectedFrom=en`。

### 4.3 真实 DOM（`en.wikipedia.org/wiki/Translation`）

采集范围三轮对比：

| 指标 | #1 | #2 | #3 |
|---|---|---|---|
| 采集元素总数 | 1030 | 722 | **396** |
| 采集总字符数 | — | 141,354 | **109,314** |
| `nav`/`footer`/`aside` 内 | 96 | 0 | 0 |
| 渲染尺寸为 0（不可见） | — | 155 | **0** |
| 参考文献条目 | — | 164 | **0** |
| 分类链接 / 语言菜单 | — | 27 / 134 | **0 / 0** |
| `#mw-content-text` 之外 | — | 162 | **0** |
| 正文段落 `<p>` 保留率 | 173 | 173 | **173 / 173（零误杀）** |
| 文章标题 `<h1>` | 采集 | 采集 | **未采集**（P2-12） |
| 采集耗时（含可见性判断） | — | — | 4.1 ms（不含判断 4.3 ms，开销可忽略） |

注入 / 还原回归（全部保持 #2 的结果）：

| 观察项 | 结果 |
|---|---|
| 注入后原文链接保留 | 11 / 11 |
| 还原后 `innerHTML` 与注入前一致 | ✅ |
| 译文含 `<img onerror>` / `<script>` 时生成元素数 | 0 / 0，无 XSS 触发 |
| 重新采集跳过已翻译容器 | ✅ |
| 注入后元素被 `display:none`，仍可被 `allTranslated()` 找到并还原 | ✅（可见性过滤只作用于采集，不影响还原） |

### 4.4 未覆盖

扩展装入浏览器后的端到端链路（`popup → content → background → 引擎`）本环境无法执行：需要以未打包扩展加载进 Chrome，当前会话没有这个能力。**DoD 3 因此只到"代码与构建产物层面成立"**——`route()` 逻辑（T4）、背景页设置加载（产物审计）分别验证过，但两者串起来跑通没有实测。这也正是 P2-8 上轮能逃过一轮验收的位置。

---

## 5. 用户自测清单（约 5 分钟，决定阶段 2 能否判定通过）

```bash
pnpm dev
```

1. **引擎优先级（DoD 3，必测）**：popup 切到 Bing → 打开 `en.wikipedia.org/wiki/Translation` → 点「翻译本页」→ Network 只见 `api-edge.cognitive.microsofttranslator.com`，无 `translate.googleapis.com`。
2. **SW 唤醒后仍读设置**：`chrome://serviceworker-internals` 里 Stop 掉 SW（或静置 30 秒）→ 再翻译一次 → 仍走 Bing。
3. **基础链路 + 还原（DoD 1、2）**：翻译后段落下方出现中文；再点一次，译文消失且链接完好。
4. **故障切换（DoD 4）**：Network 里 Block `translate.googleapis.com` → 重新翻译仍成功。
5. **总开关**：关掉总开关 → 点「翻译本页」→ 页面无变化（当前无提示，见 P2-14）。

1、2 两条通过即可判定阶段 2 通过；P2-12 建议在同一次提交里一并修掉（一行 SKIP 改动）。
