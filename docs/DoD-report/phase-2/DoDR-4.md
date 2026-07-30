# 阶段 2 DoD 验收报告 #4（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md`（本轮已随实现更新 DoD 1/2） |
| 被测提交 | `d5f3a86` fix: DoDR-3 四项修复（分支 `v0.3-engines`） |
| 前三轮 | [DoDR-1](DoDR-1.md) `91eab65`、[DoDR-2](DoDR-2.md) `2bc8e10`、[DoDR-3](DoDR-3.md) `274311e` |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 构建产物审计 + Node 桩测试 34 条断言 ×2 组参数（各通过 33 / 失败 1，同一条边界）+ 两端点实网连通 + `en.wikipedia.org/wiki/Translation` 真实 DOM |
| **结论** | **有条件通过** — 代码层 8 项 DoD 全部满足，上轮 4 项已修 3 项半；DoD 3 的真机端到端仍需用户自测（清单见 §5）。剩余 2 项均为非阻塞边界 |

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P2-12 | `.mw-body-header` 误杀页面标题 | ✅ 已修，`<h1>` 回到采集结果，注入/还原正常 |
| P2-13 | 闸门建好后不随设置重建 | ✅ 已修，两组参数双向验证通过；但重建方式引入新边界（P2-15） |
| P2-14 | 总开关关闭时静默返回 | ⚠️ content 侧已回状态码，**popup 仍不读响应**，用户依旧没有反馈 |
| 文档 | DoD 1/2 与实现对齐 | ✅ 已改为「popup 中点『翻译本页』」 |

---

## 2. 结果总览

| # | DoD 项 | #1 | #2 | #3 | #4 |
|---|---|---|---|---|---|
| 1 | popup 点「翻译本页」，段落下方出现译文 | ⚠️ | ⚠️ | ⚠️ | ✅ 文档已对齐，链路待真机 |
| 2 | 再次点击，译文消失（还原原文） | ⚠️ | ✅ | ✅ | ✅ |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ✅假阳性 | ❌ | ✅ | ✅ 代码与产物层成立，**真机待验证** |
| 4 | 屏蔽 Google 后自动切 Bing | ✅ | ✅ | ✅ | ✅ |
| 5 | 两引擎均不可用时给出可读错误 | ✅ | ✅ | ✅ | ✅ |
| 6 | 二次翻译命中缓存，无新请求 | ✅ | ✅ | ✅ | ✅ |
| 7 | 并发不超过 6 | ✅ | ✅ | ✅ | ✅ 且上限随设置即时生效 |
| 8 | 无 `host_permissions` | ✅ | ✅ | ✅ | ✅ |
| — | `typecheck` / `build` | ✅ | ✅ | ✅ | ✅ |

---

## 3. 待修问题

### P2-14（续）状态码没人消费，用户仍无反馈（P2）

`content.ts` 现在按情况返回 `disabled` / `no-elements` / `error` / `translated` / `restored`，协议这半边做对了。但 `popup/main.ts:77` 的 `onTranslatePageClick()` 只 `.catch()` 吞掉异常，**从不读 `sendResponse` 的返回值**：

```typescript
chrome.tabs.sendMessage(tabId, { type: 'pt:toggle-translate' })
  .catch(() => { /* 静默忽略 */ });     // ← 响应丢弃
```

于是关掉总开关再点「翻译本页」，表现与上轮完全一致：按钮点了没反应，也不知道为什么。补消费方即可：

```typescript
const resp = await chrome.tabs.sendMessage(tabId, { type: 'pt:toggle-translate' });
if (resp?.status === 'disabled') showHint('总开关已关闭');
if (resp?.status === 'no-elements') showHint('本页没有可翻译的内容');
```

（或者更省事：总开关关闭时把「翻译本页」按钮置灰，用户根本点不到。）

### P2-15 闸门重建方式在设置变更瞬间会翻倍（P2，新引入）

P2-13 的修法是 `onSettingsChanged(() => { gate = null; })`，下次 `getGate()` 造一个全新闸门。问题是**旧闸门的 `active` 计数随对象一起被丢弃**：设置变更时若已有请求在飞，之后新发起的调用会用新闸门从 0 起算，两个闸门各限各的。

桩测（`google-web.ts` 的闸门上限 6）：

```
route(A: 24 段) 发出 → 6 个在飞
  ↓ 30ms 后 patchSettings({ maxConcurrency: 6 })   → gate = null
route(B: 12 段) 发出 → 新闸门再放 6 个
实测同时在飞峰值 = 12
```

阶段 2 触发不到（单次调用，且要在翻译途中改设置）；阶段 3 分批并行后，用户在翻译过程中动一下设置就会瞬时冲到 12。根治办法是改上限而不是换对象——给 `createGate` 加一个 `setMax()`，`onSettingsChanged` 里调它，`active` 与等待队列都保留：

```typescript
export function createGate(max: number) {
  let active = 0; const waiting: (() => void)[] = [];
  const run = async <T>(task: () => Promise<T>) => { /* 原逻辑 */ };
  run.setMax = (n: number) => { max = n; while (active < max) waiting.shift()?.(); };
  return run;
}
```

### 两处小风险（不单列编号）

- `content.ts:73` 的 `(doRestore(), Promise.resolve('restored'))` 用逗号运算符把同步调用塞进三元表达式。`doRestore()` 若同步抛错，异常会逃出 `.catch()`，`sendResponse` 不被调用，消息通道挂到超时。写成 `Promise.resolve().then(() => doRestore())` 即可纳入统一错误处理。
- `google-web.ts:49` 在模块顶层调 `onSettingsChanged`，import 该模块就会触碰 `chrome.storage`。扩展内没问题（背景页 import 时 `chrome` 已存在），但任何非扩展上下文（单元测试、以后可能的 Node 侧工具）一 import 就抛 `ReferenceError`。本轮测试台为此把 `chrome` 替身拆成独立模块、保证先于引擎求值。若后续要加常规单测，建议把订阅挪进一个 `initEngine()` 里显式调用。

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                                          → 0 error
pnpm build                                              → 47.4 kB
grep host_permissions .output/chrome-mv3/manifest.json  → 无（DoD 8 ✅）
content.js 中 translate.googleapis.com                   → 0 次（引擎未误打包进 content script）
background.js（压缩后按调用形态核对）：
  storage.sync.get ×1、onChanged.addListener ×1（函数体，运行时注册 2 次）
  onMessage：J().then(()=>be(payload))        ← settingsReady → route
  V(()=>{X=null})                             ← 闸门随设置重建（P2-13 已进产物）
  J(), V(()=>{})                              ← 背景页启动时加载设置并订阅
```

### 4.2 桩测试（真实源码，替身 `fetch` / `chrome.storage`）

替身本轮升级：`storage.set` 会真实派发 `onChanged`——否则依赖 `onSettingsChanged` 的修复根本测不出来（上轮的替身是空实现）。同一套用例参数化跑两遍（`GATE_MAX=6` / `GATE_MAX=2`），两组结果一致。

| 编号 | 断言 | 结果 |
|---|---|---|
| T0 | 首次翻译按设置建闸门，峰值**恰为** `maxConcurrency` | ✅ |
| T1 | 闸门峰值 ≤6、保序返回、50 任务全完成 | ✅ |
| T2 | Google 30 段顺序严格对应；请求数=文本数；`sl=auto` 透传 | ✅ |
| T3 | Google 抛错自动切 Bing；`from=auto` 传空串；3 段 1 次 POST；`detectedFrom` 透出 | ✅ |
| T4 | 优先级置 Bing 首位 → 无 Google 请求 | ✅ |
| T5 | 401 清空令牌后重取且复用；`exp` 过期每次重取 | ✅ |
| T6 | 首次 3 请求 / 二次 0 请求；部分命中只请求未命中项且槽位顺序正确 | ✅ |
| T7 | 全引擎失败抛「所有引擎均失败」，含两个引擎标识 | ✅ |
| T8 | `route()` 把 `req.from`/`req.to` 传给引擎 | ✅ |
| T9 | 优先级全为未注册引擎 → 报错且不发请求 | ✅ |
| T10 | 两次并行 `route()` 总并发恰为闸门上限 6，两批各自保序 | ✅ |
| **T11** | 闸门建好后改 `maxConcurrency` 即时生效（6→2 与 2→6 双向） | ✅ **P2-13 已修** |
| **T12.1** | 翻译途中改设置，两批结果仍完整且顺序正确 | ✅ |
| **T12.2** | 翻译途中改设置后再发起调用，总并发仍 ≤6 | ❌ 实测 12（P2-15） |

实网连通（真实端点）：`google → ["你好世界","早上好"]`；`bing → ["你好，世界","早上好"] detectedFrom=en`。

### 4.3 真实 DOM（`en.wikipedia.org/wiki/Translation`）

| 指标 | #2 | #3 | #4 |
|---|---|---|---|
| 采集元素总数 | 722 | 396 | 397 |
| 采集总字符数 | 141,354 | 109,314 | 109,325 |
| 文章标题 `<h1>` | 采集 | **未采集** | **采集 ✅** |
| 正文段落 `<p>` 保留率 | 173 | 173/173 | 173/173（零误杀） |
| 不可见元素 / 参考文献 / 分类链接 / 语言菜单 | 155/164/27/134 | 0 | 0 / 0 / 0 / 0 |
| `#mw-content-text` 之外 | 162 | 0 | 1（即标题本身，符合预期） |

注入 / 还原回归：

| 观察项 | 结果 |
|---|---|
| 注入后原文链接保留 | 11 / 11 |
| 还原后 `innerHTML` 与注入前一致 | ✅ |
| 标题 `<h1>` 注入译文并还原 | ✅ 逐字节一致 |
| 译文含 `<img onerror>` / `<script>` 时生成元素数 | 0 / 0，无 XSS 触发 |
| 重新采集跳过已翻译容器 | ✅ |

### 4.4 未覆盖

扩展装入浏览器后的端到端链路（`popup → content → background → 引擎`）本环境仍无法执行——需要以未打包扩展加载进 Chrome，当前会话没有这个能力。**DoD 3 因此只到"代码与构建产物层面成立"**：`route()` 逻辑（T4）与背景页设置加载（产物审计）分别验证过，串起来跑通没有实测。

---

## 5. 用户自测清单（约 5 分钟，决定阶段 2 能否判定通过）

```bash
pnpm dev
```

1. **引擎优先级（DoD 3，必测）**：popup 切到 Bing → 打开 `en.wikipedia.org/wiki/Translation` → 点「翻译本页」→ Network 只见 `api-edge.cognitive.microsofttranslator.com`，无 `translate.googleapis.com`。
2. **SW 唤醒后仍读设置**：`chrome://serviceworker-internals` 里 Stop 掉 SW（或静置 30 秒）→ 再翻译一次 → 仍走 Bing。
3. **基础链路 + 还原（DoD 1、2）**：翻译后段落下方出现中文、标题也翻；再点一次，译文消失且链接完好。
4. **故障切换（DoD 4）**：Network 里 Block `translate.googleapis.com` → 重新翻译仍成功。
5. **并发（DoD 7）**：翻译整页（397 段）时 Waterfall 同时 pending ≤6。

1、2 两条通过即可判定阶段 2 通过。P2-14（popup 消费状态码）与 P2-15（闸门 `setMax`）可并入阶段 3 一起做——前者是 UI 反馈，后者要等分批并行落地才会真正触发。
