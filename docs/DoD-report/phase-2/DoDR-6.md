# 阶段 2 DoD 验收报告 #6（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md` |
| 被测提交 | `39b8984` fix: setMax 死循环修正，版本号统一至 0.3.0（分支 `v0.3-engines`） |
| 前五轮 | [DoDR-1](DoDR-1.md)、[DoDR-2](DoDR-2.md)、[DoDR-3](DoDR-3.md)、[DoDR-4](DoDR-4.md)、[DoDR-5](DoDR-5.md) |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 构建产物审计 + Node 桩测试 34 条 ×2 组参数（全通过）+ 闸门专项 8 条 + 两端点实网连通 + `en.wikipedia.org/wiki/Translation` 真实 DOM |
| **结论** | **有条件通过** — P2-16 已修，全部自动化断言首次一次性全绿；8 项 DoD 在代码与产物层面均成立。DoD 3 的真机端到端仍需用户自测（清单见 §5），无遗留待修项 |

> 本轮修正由验收方直接提交（`39b8984`），非独立第三方复核。P2-16 的修法即 DoDR-5 §2 提出的方案，请在合并前过一眼 `src/queue/concurrency.ts` 的 diff。

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P2-16 | `setMax()` 死循环，设置变更即卡死背景页 | ✅ 已修，三种场景全部立即返回 |
| — | 版本号 `package.json` 0.1.0 与 popup 页脚 v0.2.0 不同步 | ✅ 统一为 0.3.0，manifest 产出 `"version":"0.3.0"` |

`src/queue/concurrency.ts` 改为泵式调度：

```typescript
function pump(): void {
  while (active < max && waiting.length > 0) {
    active++;              // 放行的同时同步自增 —— 循环条件由循环体推进
    waiting.shift()!();
  }
}
run.setMax = (n) => { max = n; pump(); };
```

两处关键点：`active++` 同步执行（原实现指望等待者在微任务里自增，同步 `while` 根本等不到），以及 `waiting.length > 0` 保证队列排空后必然终止。产物中已是 `for(;t<e&&n.length>0;)t++,n.shift()()`。

---

## 2. 结果总览

| # | DoD 项 | #5 | #6 |
|---|---|---|---|
| 1 | popup 点「翻译本页」，段落下方出现译文 | ⚠️ | ✅ 链路待真机 |
| 2 | 再次点击，译文消失（还原原文） | ⚠️ | ✅ |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ❌ | ✅ 代码与产物层成立，**真机待验证** |
| 4 | 屏蔽 Google 后自动切 Bing | ⚠️ | ✅ |
| 5 | 两引擎均不可用时给出可读错误 | ⚠️ | ✅ |
| 6 | 二次翻译命中缓存，无新请求 | ⚠️ | ✅ |
| 7 | 并发不超过 6 | ⚠️ | ✅ 上限随设置即时生效，翻译途中改也不越限 |
| 8 | 无 `host_permissions` | ✅ | ✅ |
| — | `typecheck` / `build` | ✅ | ✅ |

六轮累计修复：P2-1 ~ P2-16 共 16 项，本轮无新增待修项。

---

## 3. 验证明细

### 3.1 静态与产物

```
pnpm typecheck                                          → 0 error
pnpm build                                              → 48.04 kB
manifest.json  "version":"0.3.0"，无 host_permissions，permissions 仅 ["storage"]
background.js：storage.sync.get ×1、onChanged.addListener ×1、setMax ×2
               闸门实现 for(;t<e&&n.length>0;)t++,n.shift()()
               onMessage：settingsReady() → route()
content.js：   translate.googleapis.com 出现 0 次（引擎未误打包进 content script）
```

### 3.2 闸门专项（`createGate` 单独验收，8 条）

| 编号 | 断言 | 结果 |
|---|---|---|
| G1 | 空闲闸门（`active=0`、无等待者）调 `setMax` 立即返回 | ✅ 上轮此处死循环 |
| G2 | 并发峰值恰为上限 | ✅ |
| G3 / G4 | 返回值保序；FIFO 执行顺序 | ✅ |
| G5 | 任务抛错由调用方捕获，不吞不挂 | ✅ |
| G6 | 抛错后名额归还，后续峰值仍为上限 | ✅ |
| G7 | 运行中放宽上限，等待者立即放行且不越新上限 | ✅ |
| G8 | 运行中收紧上限不越限 | ✅ |

G5/G6 是这次重构新增的覆盖：`run()` 改成包装 Promise 后，`task()` 的 rejection 经 `.then(resolve, reject)` 透传，调用方 `.catch` 行为与重构前一致。

### 3.3 桩测试（真实源码，替身 `fetch` / `chrome.storage`）

`GATE_MAX=6` 与 `GATE_MAX=2` 两组各 34 条，**全部通过**：

| 编号 | 断言 | 结果 |
|---|---|---|
| T0 / T11 | 首次按设置建闸门，峰值恰为设定值；建好后改 `maxConcurrency` 双向即时生效 | ✅ |
| T1 | 闸门峰值、保序、50 任务全完成 | ✅ |
| T2 | Google 30 段顺序严格对应；请求数=文本数；`sl=auto` 透传 | ✅ |
| T3 | Google 抛错自动切 Bing；`from=auto` 传空串；3 段 1 次 POST；`detectedFrom` 透出 | ✅ |
| T4 | 优先级置 Bing 首位 → 无 Google 请求 | ✅ |
| T5 | 401 清空令牌后重取且复用；`exp` 过期每次重取 | ✅ |
| T6 | 首次 3 请求 / 二次 0 请求；部分命中只请求未命中项且槽位顺序正确 | ✅ |
| T7 | 全引擎失败抛「所有引擎均失败」，含两个引擎标识 | ✅ |
| T8 | `route()` 把 `req.from`/`req.to` 传给引擎 | ✅ |
| T9 | 未注册引擎报错且不发请求 | ✅ |
| T10 | 两次并行 `route()` 总并发恰为 6，两批各自保序 | ✅ |
| T12 | 翻译途中改设置：结果完整、顺序正确，总并发仍 ≤6 | ✅ |

实网连通（真实端点）：`google → ["你好世界","早上好"]`；`bing → ["你好，世界","早上好"] detectedFrom=en`。

### 3.4 真实 DOM（`en.wikipedia.org/wiki/Translation`）

本轮未改 `collect.ts` / `inject.ts`，回归无漂移：

| 观察项 | 结果 |
|---|---|
| 采集元素数 / 总字符数 | 397 / 109,325 |
| 正文段落 `<p>` 保留率 | 173 / 173（零误杀） |
| 文章标题 `<h1>` 采集 + 注入还原 | ✅ / ✅ |
| 不可见元素 / 参考文献条目 | 0 / 0 |
| 注入后原文链接保留 | 11 / 11 |
| 还原后 `innerHTML` 与注入前一致 | ✅ |
| 译文含 `<img onerror>` / `<script>` 时生成元素 | 0 / 0，无 XSS 触发 |
| 重新采集跳过已翻译容器 | ✅ |

### 3.5 未覆盖

扩展装入浏览器后的端到端链路（`popup → content → background → 引擎`）本环境无法执行：需要以未打包扩展加载进 Chrome，当前会话没有这个能力。**DoD 3 因此只到"代码与构建产物层面成立"**——`route()` 逻辑（T4）与背景页设置加载（产物审计）分别验证过，串起来跑通没有实测。

六轮里有两个缺陷正是落在这条未覆盖路径上：P2-8（背景页不读设置）靠产物审计才发现，P2-16（`setMax` 死循环）靠把用例真的跑一遍才发现，`typecheck` 与 `build` 对两者都是绿的。

---

## 4. 遗留（不阻塞，建议并入阶段 3）

| 项 | 说明 |
|---|---|
| 缓存写入串行 | `router.ts:78` 每段文本 `await cacheSet`，且 `cache.ts` 把 index 操作串在一条 Promise 链上；397 段即 397 次串行读-改-写 |
| 缓存键含引擎 id | 故障切换到 Bing 后同一段文本要重翻一次，属阶段 1 的既定取舍 |
| `onSettingsChanged` 在模块顶层 | `google-web.ts:49` import 即触碰 `chrome.storage`，非扩展上下文（单元测试）一 import 就抛；建议挪进显式 `initEngine()` |
| Google 请求量 | 单段一请求，整页 397 段 = 397 个 HTTP 请求；Bing 按 45k 字符分批约 3 个。阶段 3 分批合并后差距会拉大 |

---

## 5. 用户自测清单（约 5 分钟，决定阶段 2 能否判定通过）

```bash
pnpm dev
```

1. **P2-16 回归（必测）**：翻译一次 → popup 改任意设置 → 再翻译。应正常工作；`chrome://serviceworker-internals` 里 SW 状态仍为 activated、CPU 不飙。
2. **引擎优先级（DoD 3，必测）**：popup 切到 Bing → 重新翻译 → Network 只见 `api-edge.cognitive.microsofttranslator.com`，无 `translate.googleapis.com`。
3. **SW 唤醒后仍读设置**：Stop 掉 SW（或静置 30 秒）→ 再翻译 → 仍走 Bing。
4. **基础链路 + 还原（DoD 1、2）**：翻译后段落下方出现中文、标题也翻；再点一次译文消失且链接完好。
5. **故障切换（DoD 4）**：Network 里 Block `translate.googleapis.com` → 重新翻译仍成功。
6. **并发（DoD 7）**：整页 397 段翻译，Waterfall 同时 pending ≤6。
7. **提示（P2-14 目视）**：关掉总开关点「翻译本页」，popup 底部出现「总开关已关闭」。

1、2 两条通过即可判定阶段 2 通过，进入阶段 3。
