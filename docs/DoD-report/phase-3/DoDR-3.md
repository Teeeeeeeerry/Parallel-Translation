# 阶段 3 DoD 验收报告 #3（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 3 — DOM 采集完备化 |
| 验收依据 | `docs/phases/phase-3-dom.md` |
| 被测提交 | `9878d3d` fix: DoDR-2 验收缺陷修复 (P3-8~P3-10)（分支 `v0.4-dom`） |
| 前两轮 | [DoDR-1](DoDR-1.md)、[DoDR-2](DoDR-2.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 27 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + manifest 审计 + jsdom 用例 41 条 + content script 多 frame 桩测试 4 条 + 闸门专项 + 性能剖析 + `en.wikipedia.org/wiki/Translation` 真实页面 |
| **结论** | **有条件通过** — P3-1 ~ P3-10 共 10 项缺陷全部修复并复测通过，45 条自动化断言中 44 条通过（唯一失败项为 jsdom 环境限制，非代码缺陷）。9 项 DoD 在代码与产物层面全部成立，无遗留待修项。真机端到端仍需用户自测（清单见 §6） |

> 本轮修正由验收方直接提交（`9878d3d`），非独立第三方复核。合并前建议过一眼 `src/dom/observer.ts` 与 `entrypoints/content.ts` 的 diff。

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P3-8 | `startObserver()` 初始扫描随嵌套深度指数增长，真实页面冻结主线程 | ✅ 已修 |
| P3-9 | popup 用 `frameId: 0` 后 iframe 收不到指令，DoD 4 回归 | ✅ 已修 |
| P3-10 | `shouldSkip()` 对全树每个元素做重活，采集耗时偏高 | ✅ 已修 |

### P3-8 的修法

`observer.ts` 的 `walk` 原本对 `querySelectorAll('*')` 的**每个后代**再递归一次，而该方法返回的本就是整棵子树，于是深度 k 的节点被沿 2^(k-1) 条祖先路径反复访问。改为每个 scope 只扫一遍，递归只发生在 shadow 边界（`querySelectorAll` 不穿透 shadow root，这是唯一需要递归的地方）：

```typescript
const walk = (scope: ParentNode) => {
  scope.querySelectorAll('*').forEach((el) => {
    if (attach(el)) walk(el.shadowRoot!);
  });
};
```

另外补了根节点分支 —— `querySelectorAll` 不含根自身，而 `flush()` 传进来的新增节点很可能本身就是 shadow host。

| 嵌套深度（均 1200 段） | 修复前 | 修复后 |
|---|---|---|
| 2 | 18 ms | 2 ms |
| 4 | 60 ms | 2 ms |
| 8 | 867 ms | 1 ms |
| 12 | **14,622 ms** | **1 ms** |
| 真实维基页面（7227 元素） | **> 120,000 ms 未完成** | **9 ms** |

### P3-9 的修法

回到全 frame 广播（popup 不再传 `frameId`），提示准确性改由 content script 侧保证：

```typescript
const isMainFrame = window.top === window;
const reply = isMainFrame ? sendResponse : () => {};
...
return isMainFrame ? true : undefined;   // 子 frame 不占用响应通道
```

子 frame 照常翻译自己的文档，但不调 `sendResponse` 也不返回 `true`，因此响应通道只由主文档占用 —— 既恢复了 iframe 翻译（DoD 4），又不会被空 iframe 抢答成「本页没有可翻译的内容」（P3-6 原本要解决的问题）。

### P3-10 的修法

`walker.ts` 判定顺序改为 `isTranslationUnit(el) && !shouldSkip(el)`。维基真实页面：**251 ms → 53 ms**，采集结果完全一致（376 个单元）。

---

## 2. DoD 结果总览

| # | DoD 项 | #1 | #2 | #3 | 依据 |
|---|---|---|---|---|---|
| 1 | Reddit 帖子与评论能翻译 → shadow 穿透 | ❌ | ✅ | ✅ | D1-1/2/3，单层、三层嵌套、混排 |
| 2 | YouTube 标题简介评论 → 自定义元素 | ❌ | ✅ | ✅ | D2-1/2，shadow 与 slot 分发两种形态 |
| 3 | X 时间线滚动自动补翻 → observer | ✅ | ⚠️ | ✅ | D3-1~4、P3-8 |
| 4 | 同源 iframe 内文本能翻译 → `all_frames` | ✅ | ❌ | ✅ | manifest + F-0~F-3 多 frame 桩测试 |
| 5 | Medium SPA 路由切换自动补翻 | ✅ | ⚠️ | ✅ | D5-1 |
| 6 | 嵌套结构只产生一份译文 | ✅ | ✅ | ✅ | D6-1~5、C-1，真实页面 376 容器零重复 |
| 7 | 悬浮球与按钮文字未被翻译 | ✅ | ✅ | ✅ | D7-1~3、C-2 |
| 8 | 纯数字文本未被翻译 | ✅ | ✅ | ✅ | D8-1~3 |
| 9 | 无限滚动并发不超过 6 | ✅ | ✅ | ✅ | 300 任务峰值恰为 6 |
| — | `typecheck` / `build` | ✅ | ✅ | ✅ | 0 error / 51.38 kB |

三轮累计修复 P3-1 ~ P3-10 共 10 项，本轮无新增待修项。

---

## 3. 本轮新增用例

### 3.1 多 frame 行为（DoD 4 的直接验证）

真实加载 `entrypoints/content.ts`（替身 `chrome` 与 `defineContentScript`），分别在主文档与子 frame 语境下装载并模拟 popup 广播：

| 编号 | 断言 | 结果 |
|---|---|---|
| F-0 | content script 声明 `allFrames: true`、`runAt: document_end` | ✅ |
| F-1 | 主文档收到广播后发起翻译、注入译文、应答 `translated`，返回 `true` 保持通道 | ✅ |
| F-2 | **子 frame 同样翻译自己的文档**，但不应答、返回 `undefined` | ✅ |
| F-3 | 空的子 frame 不发翻译请求、也不抢答 `no-elements` | ✅ |

F-2 是 DoD 4 回归的守门用例：上一轮的 `frameId: 0` 会让这条直接失败。

### 3.2 P3-8 / P3-10 回归

| 编号 | 断言 | 结果 |
|---|---|---|
| P3-8 | 深度 2/4/8/12 的 1200 段页面，初始扫描均 < 200 ms 且不随深度显著增长（实测 2/2/1/1 ms） | ✅ |
| P3-8b | 新增节点**自身即 shadow host** 时，插入时已有内容与后续新增都被观察到 | ✅ |
| P3-9 | popup 的 `sendMessage` 不再传 `frameId:` | ✅ |
| P3-10 | `walker.ts` 判定顺序为先 `isTranslationUnit` 后 `shouldSkip` | ✅ |

第一、二轮的 37 条全部沿用并复跑，结果不变。

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                        → 0 error
pnpm build                            → 51.38 kB
manifest.json  "version":"0.4.0"
               content_scripts[0].all_frames = true
               matches = ["<all_urls>"]，run_at = document_end
               permissions 仅 ["storage"]，无 host_permissions
```

### 4.2 真实页面（`en.wikipedia.org/wiki/Translation`，7227 个元素）

| 观察项 | #1 | #2 | #3 |
|---|---|---|---|
| 采集单元数 | 987 | 376 | 376 |
| 落在导航/页脚/侧栏/参考文献区 | 611 | 0 | 0 |
| 正文 `<p>` 保留率 | 167 / 175 | 167 / 175 | 167 / 175 |
| `collect()` 耗时 | — | 251 ms | **53 ms** |
| `startObserver()` 初始扫描 | — | > 120,000 ms 未完成 | **9 ms** |
| 注入 376 段 / `allTranslated()` | — | 33 / 18 ms | 73 / 17 ms |
| 重复译文异常容器 | 0 | 0 | 0 |
| 注入后立即再采集 | 0 | 0 | 0 |
| 还原后 `innerHTML` 与注入前逐字节一致 | ✅ | ✅ | ✅ |
| 还原后残留 `.pt-trans`（light / shadow） | 0 / 1 | 0 / 0 | 0 / 0 |

### 4.3 并发闸门（DoD 9）

模拟无限滚动 12 轮 flush × 每轮 25 段 = 300 个任务经同一闸门：

```
总任务: 300 | 完成: 300 | 并发峰值: 6  ✔ ≤6
```

闸门是 `google-web.ts` 的模块级单例，所有 frame 的 content script 汇聚到同一个 background service worker，因此 `all_frames` 下多 frame 并行仍共用这一个闸门，全局上限就是 6。

### 4.4 唯一失败项：D8-4（环境限制，非代码缺陷）

`.notranslate` 与 `pre` 两条成立，漏网的是 `contenteditable`。jsdom 未实现 `HTMLElement.isContentEditable`（实测为 `undefined`），真实浏览器中该属性对 `contenteditable` 的子孙元素返回 `true`，`classify.ts:36` 的判断本身是对的。三轮结论一致，需真机复核（§6 第 7 条）。

### 4.5 测试环境的一处替身，需知悉

`classify.ts` 新增的可见性判断依赖 `getBoundingClientRect()`，而 jsdom 不做布局、该方法恒返回全零矩形 —— 原样跑会把所有元素判为不可见。测试环境为此装了可控替身：默认返回 100×20，标了 `data-invisible` 的子树返回零矩形。因此 P3-4b 验证的是**判断逻辑接线正确**，真实布局下的表现（如折叠面板、`visibility: hidden`、屏幕外元素）仍需真机确认。

### 4.6 未覆盖

- 装入浏览器后的端到端链路（popup → content → background → 引擎）本环境无法执行；多 frame 行为是用 `chrome` 替身在 jsdom 里验证的，真实的跨 frame 消息分发未实测。
- 真实站点（Reddit / YouTube / X / Medium）的实际 DOM，按 [TESTING.md](../../TESTING.md) 的分线策略本就不进自动化主线。
- `contenteditable`、CSS 可见性、跨源 iframe 注入 —— 均依赖真实渲染引擎。
- jsdom 不支持 `closed` 模式 shadow root，该分支未测（真实浏览器中 `el.shadowRoot` 对 closed 返回 `null`，属已知盲区，阶段 8 域名补丁兜底）。

---

## 5. 遗留（不阻塞，建议并入阶段 4）

| 项 | 说明 |
|---|---|
| 多 frame 状态各自独立 | `translated` 标志每个 frame 一份。若主文档翻译成功而某个 iframe 失败，两者状态会分叉，下次点击时表现不一致。`all_frames` 架构的固有代价，阶段 5 做悬浮球时需要正视 |
| 缓存写入串行 | `router.ts:78` 每段文本 `await cacheSet`；376 段即 376 次串行读-改-写（阶段 2 遗留） |
| Google 单段一请求 | 整页 376 段 = 376 个 HTTP 请求；Bing 按批约 3 个。分批合并仍未做（阶段 2 遗留） |
| `onSettingsChanged` 在模块顶层 | `google-web.ts:49` import 即触碰 `chrome.storage`，非扩展上下文一 import 就抛（阶段 2 遗留） |

---

## 6. 用户自测清单（约 8 分钟，决定阶段 3 能否判定通过）

```bash
pnpm dev
```

1. **P3-8 回归（必测）**：打开维基百科任一英文条目 → 点「翻译本页」→ 译文出现后页面应立即可滚动、可交互，无卡顿。修复前此处会冻结数十秒到数分钟。
2. **P3-9 / DoD 4 回归（必测）**：找一个嵌入 CodePen 或 YouTube 播放器的英文页 → 翻译 → 确认 **iframe 内**文本也出现译文，且 popup 不误报「本页没有可翻译的内容」。
3. **shadow 穿透（DoD 1）**，`sh.reddit.com` 任一英文帖，Console：

   ```javascript
   let n = 0;
   const visit = (root) => root.querySelectorAll('*').forEach(el => {
     if (el.shadowRoot) { n += el.shadowRoot.querySelectorAll('.pt-trans').length; visit(el.shadowRoot); }
   });
   visit(document); console.log('shadow 内译文数:', n);   // 预期 > 0
   ```
4. **shadow 内增量（DoD 1 × 3）**：Reddit 上翻译后向下滚动，新出现的帖子与评论自动补翻。
5. **还原**：再点一次，light DOM 与 shadow 内的译文同时消失，页面结构无残留。
6. **DoD 2 / 3 / 5**：YouTube 标题简介评论、X 时间线滚动补翻、Medium 站内跳转补翻。
7. **contenteditable（D8-4 真机补测）**：打开带富文本编辑器的页面，确认编辑区内文字未被翻译。
8. **重复译文自查**（任一页面 Console）：

   ```javascript
   const dup = [...document.querySelectorAll('[data-pt="done"]')]
     .filter(el => el.querySelectorAll(':scope > .pt-trans').length !== 1);
   console.log('异常容器数:', dup.length);   // 预期 0
   ```
9. **自翻译自查**：`document.querySelectorAll('[data-pt-ui="1"] .pt-trans').length` → 预期 0。
10. **死循环自查**：翻译完成后静置 10 秒，Network 面板无持续新增的翻译请求。
11. **并发（DoD 9）**：整页翻译时 Waterfall 同时 pending ≤ 6。

第 1、2、3 条通过即可判定阶段 3 通过，进入阶段 4。
