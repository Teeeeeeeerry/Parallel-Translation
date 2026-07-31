# 阶段 3 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 3 — DOM 采集完备化 |
| 验收依据 | `docs/phases/phase-3-dom.md` |
| 被测提交 | `f8b6ff5` feat: 阶段 3 —— DOM 采集完备化 (v0.4.0)（分支 `v0.4-dom`） |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 27（shadow DOM + TreeWalker + MutationObserver 均为真实实现） |
| 验收方式 | `pnpm typecheck` + `pnpm build` + manifest 审计 + jsdom 真实 DOM 用例 27 条 + 闸门专项 + `en.wikipedia.org/wiki/Translation` 真实页面 |
| **结论** | **未通过** — 存在 1 项阻塞缺陷（P3-1）：`walker.ts` 遇到任何 open shadow root 即抛 `TypeError`，shadow 穿透（DoD 1、2）完全不成立，且异常会逃出 `collect()` 导致**整页翻译失败**。另有 2 项高优先级功能缺口（P3-2、P3-3）。修复方案已在补丁副本上验证有效 |

---

## 1. 结果总览

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | Reddit 帖子与评论能翻译 → shadow 穿透 | ❌ | P3-1，采集直接抛异常 |
| 2 | YouTube 标题/简介/评论能翻译 → 自定义元素 | ❌ | P3-1（带 shadow 的自定义元素）；无 shadow 的自定义元素 ✅ |
| 3 | X 时间线滚动自动补翻 → observer | ✅ | light DOM 场景代码层成立（D3-1/2/3、D5-1）；shadow 内新增不覆盖，见 P3-2 |
| 4 | 同源 iframe 内文本能翻译 → `all_frames` | ✅ | 产物 manifest `"all_frames":true` |
| 5 | Medium SPA 路由切换自动补翻 | ✅ | D5-1 |
| 6 | 嵌套结构只产生一份译文 | ✅ | D6-1 ~ D6-5、C-1（真实页面 987 个容器零重复） |
| 7 | 悬浮球与按钮文字未被翻译 | ✅ | D7-1 ~ D7-3、C-2 |
| 8 | 纯数字文本未被翻译 | ✅ | D8-1 ~ D8-3 |
| 9 | 无限滚动时并发不超过 6 | ✅ | 12 轮 × 25 段共 300 任务，峰值恰为 6 |
| — | `pnpm typecheck` / `pnpm build` | ✅ | 0 error / 50.22 kB |

自动化用例：**24 / 27 通过**（修复 P3-1 后的补丁副本）；被测提交原样为 **20 / 27**。

---

## 2. 阻塞缺陷

### P3-1 `walk()` 进入 shadowRoot 后立刻抛 TypeError（阻塞）

`src/dom/walker.ts:36-48`。`walker.currentNode` 初值是 root 本身，而 `TreeWalker` 的 `acceptNode` **不作用于根节点**。递归下沉时 root 是 `ShadowRoot`（`DocumentFragment`，没有 `tagName`），循环体直接把它交给 `shouldSkip()`：

```typescript
// classify.ts:33
const tag = el.tagName.toLowerCase();   // ShadowRoot.tagName === undefined → TypeError
```

实测：

```
单层 shadow / 三层嵌套 shadow / 自定义元素 + shadow / 混排  → 全部 TypeError
空的 shadowRoot（attachShadow 后不写内容）                  → 同样 TypeError
```

影响面比 DoD 1、2 更大。异常从 `walk()` 一路逃到 `collect()` 的调用方，**同一页面的 light DOM 段落一并丢失**：

```
<p>Plain light paragraph one.</p><div id="h"><!--#shadow-root--></div><p>Plain light paragraph two.</p>
→ 整页采集抛错，0 段被翻译
```

即：只要页面上存在任意一个 open shadow root（现代站点普遍存在），扩展就从"翻不全"退化为"完全翻不了"，popup 收到 `ok:false`。`observer.ts:28` 的 `collect(n)` 同样会抛，异常逃出 MutationObserver 回调，整批 pending 节点静默丢弃。

**修复**（`walker.ts` 循环体首行，一行）：

```typescript
let node: Node | null = walker.currentNode;
while (node) {
  const el = node as Element;

  if (el.nodeType !== Node.ELEMENT_NODE) { node = walker.nextNode(); continue; }
  ...
```

在补丁副本上复跑：D1-1、D1-2（三层嵌套）、D1-3、D2-1 全部通过，`27 条中 24 条通过`。

---

## 3. 高优先级缺口

### P3-2 MutationObserver 不覆盖 shadow root 内的新增节点

`src/dom/observer.ts:53` 只 `mo.observe(document.body, …)`。MutationObserver 与 TreeWalker 一样不穿透 shadow 边界 —— shadow root 内部的新增节点不产生任何 record。

实测（D3-4）：向已存在的 shadow root 追加 `<p>`，等待 500ms，回调**零次**。

后果：Reddit / YouTube 这类把内容放进 shadow 的站点，首屏之后的无限滚动与懒加载内容永远不补翻。DoD 1、2 与 DoD 3 的交集场景失效。修 P3-1 只解决首屏，这条要单独修（下沉时对每个 shadowRoot 各挂一个 observe，并在 `walk()` 里登记新出现的 host）。

### P3-3 `allTranslated()` 不穿透 shadow，shadow 内译文无法还原

`src/dom/inject.ts:54` 用 `document.querySelectorAll('[data-pt="done"]')`，取不到 shadow 内的容器。

实测（R-2）：向 shadow 内 `<p>` 注入译文后调 `allTranslated().forEach(removeSimple)` —— 返回 **0** 个容器，shadow 内 `.pt-trans` 残留 **1** 份。

后果是双重的：还原后 shadow 部分仍显示译文；且残留容器保留着 `data-pt="done"`，`shouldSkip()` 会永久跳过它，重新翻译也不会修正。light DOM 的还原是干净的（R-1：真实页面 987 个容器还原后 `innerHTML` 与注入前逐字节一致）。

---

## 4. 其他发现

### P3-4 丢失可见性与非正文区域过滤，翻译额度显著上涨（中）

阶段 2 的 `collectSimple()` 带两道过滤，`walker.ts` 都没保留：渲染尺寸为 0 的不可见元素（`getBoundingClientRect`），以及 `nav / footer / aside / .reflist / .navbox / .toc / #catlinks …` 等非正文区域。

`en.wikipedia.org/wiki/Translation` 实测：

| 指标 | 值 |
|---|---|
| 采集单元数 | 987（`li` 758 / `p` 167 / `h*` 37 / `figcaption` 25） |
| 其中落在导航/页脚/侧栏/参考文献区 | **611 个（62%）**，占总字符 **27.1%** |
| 正文 `<p>` 保留率 | 167 / 175 |
| 重复译文异常容器 | 0 |

阶段 3 文档的 `classify.ts` 骨架本身就没写这两道过滤，因此不算实现偏离规格；但 Google 引擎是单段一请求，611 个额外单元等于每页多发 611 个 HTTP 请求。建议在阶段 4 之前把可见性判断加回 `shouldSkip()`。

### P3-5 增量补翻的 rejection 无人接管（低）

`entrypoints/content.ts:97-100` 的 observer 回调是 `async (els) => { await doTranslate(els); }`，返回的 Promise 没有 `.catch`。网络失败或 P3-1 抛错时变成未处理拒绝。

### P3-6 iframe 广播的响应竞争（低）

`chrome.tabs.sendMessage(tabId, …)` 会广播到所有 frame，`all_frames` 下每个 iframe 各自应答，popup 只取第一个返回。若某个空 iframe 先应答 `no-elements`，popup 会误报"本页没有可翻译的内容"，而主文档其实已翻译。

### P3-7 `src/dom/collect.ts` 已无任何引用（记录）

阶段 3 交付清单写的是"替换 `collect.ts`"，文件仍留在仓库，`collectSimple` 全仓零引用。是否保留作对照基准请明确。

---

## 5. 验证明细

### 5.1 静态与产物

```
pnpm typecheck                        → 0 error
pnpm build                            → 50.22 kB（content.js 19.56 kB）
manifest.json  "version":"0.4.0"
               content_scripts[0].all_frames = true      ← DoD 4
               matches = ["<all_urls>"]，run_at = document_end
               permissions 仅 ["storage"]，无 host_permissions
```

### 5.2 采集与分类（jsdom 真实 DOM）

| 编号 | 断言 | 结果 |
|---|---|---|
| D6-1 | `<div><p>text</p></div>` 只产生 1 个单元，且是 `p` | ✅ |
| D6-2 | `<li><p>…</p></li>` 只取更深的 `p` | ✅ |
| D6-3 | `p` 内含 `<a>` / `<strong>` 仍算 1 个单元 | ✅ |
| D6-4 | 多层 div 包裹的 `h2` + 2 个 `p` 各一份，无重复 | ✅ |
| D6-5 | 注入译文后重新采集，已翻译容器被跳过 | ✅ |
| D7-1 | `data-pt-ui="1"` 子树整体不被采集 | ✅ |
| D7-2 | `data-pt-ui="1"` 宿主的 shadowRoot 不被下沉 | ✅ |
| D7-3 | `shouldSkip()` 对 UI 内元素直接为 true | ✅ |
| D8-1 | `1.2k` / `2026-07-30` / `$99.00` / `12,345` / `(42)` / `+15%` 全部不采集 | ✅ |
| D8-2 | `In 2026 the price rose by 15% to $99.` 不被误杀 | ✅ |
| D8-3 | 2 字符与 3100 字符段落被跳过 | ✅ |
| D8-4 | `.notranslate` / `contenteditable` / `pre` 被跳过 | ⚠️ 见下 |
| D1-1 | 单层 shadow root 内的 `p` 被采集 | ❌ → 修 P3-1 后 ✅ |
| D1-2 | 三层嵌套 shadow root 全部穿透（Reddit 形态） | ❌ → ✅ |
| D1-3 | light 与 shadow 混排 4 段全采 | ❌ → ✅ |
| D2-1 | 自定义元素 + shadow（YouTube 形态） | ❌ → ✅ |
| D2-2 | 自定义元素的 light 子节点（slot 分发内容） | ✅ |

**D8-4 说明**：`.notranslate` 与 `pre` 两条成立，漏网的是 `contenteditable`。归因为环境限制而非代码缺陷 —— jsdom 未实现 `HTMLElement.isContentEditable`（实测为 `undefined`），真实浏览器中该属性对 `contenteditable` 子孙元素返回 `true`，`shouldSkip()` 的判断是正确的。此条需真机复核。

### 5.3 增量补翻与死循环

| 编号 | 断言 | 结果 |
|---|---|---|
| D3-1 | 新增 2 个 `p`，防抖窗口后被采集 | ✅ |
| D3-2 | 300ms 内分 20 批新增，合并为**一次**回调、聚合 20 个节点 | ✅ |
| D3-3 | `stop()` 后新增节点不再触发回调（observer 正确 disconnect） | ✅ |
| D3-4 | shadow root 内新增节点被补翻 | ❌ P3-2 |
| D5-1 | SPA 整体替换视图后新内容被补翻（`h1` + `p`） | ✅ |
| D5-2 | **死循环自查**：回调内注入译文，静置 1.2s，回调仅触发 1 轮、译文恰 1 份 | ✅ |

D5-2 是关键项：`injectSimple` 插入的 `.pt-origin` / `.pt-trans` 会产生新的 childList mutation，靠 `.pt-trans` 类名过滤 + `shouldSkip()` 里的 `closest('[data-pt="done"]')` 双重拦截，未观察到自激。

### 5.4 并发闸门（DoD 9）

模拟无限滚动：12 轮 flush × 每轮 25 段 = 300 个任务经同一闸门。

```
总任务: 300 | 完成: 300 | 并发峰值: 6  ✔ ≤6
```

`createGate` 是 `google-web.ts` 的模块级单例，所有 frame 的 content script 都把请求汇聚到同一个 background service worker，因此 `all_frames` 下多 frame 并行也共用这一个闸门，全局上限仍是 6。

### 5.5 真实页面（`en.wikipedia.org/wiki/Translation`，含人工挂载的 shadow host）

| 观察项 | 结果 |
|---|---|
| 采集元素数 / 总字符数 | 987 / 131,116 |
| shadow root 内被采集 | 1（修 P3-1 后） |
| 重复译文异常容器数（`:scope > .pt-trans !== 1`） | 0 |
| 注入后再次采集 | 0（已翻译容器全部跳过） |
| 还原后 `innerHTML` 与注入前一致 | ✅ 逐字节相同 |
| 还原后 light DOM 残留 `.pt-trans` | 0 |
| 还原后 shadow 内残留 `.pt-trans` | **1** ← P3-3 |

### 5.6 未覆盖

- 装入浏览器后的端到端链路（popup → content → background → 引擎）本环境无法执行。
- 真实站点（Reddit / YouTube / X / Medium）的实际 DOM 结构，按 [TESTING.md](../../TESTING.md) 的分线策略本就不进自动化主线。
- `contenteditable`（D8-4）、CSS 可见性、跨源 iframe 注入行为 —— 均依赖真实渲染引擎。
- jsdom 不支持 `closed` 模式 shadow root，该分支未测（真实浏览器中 `el.shadowRoot` 对 closed 返回 `null`，属已知盲区，阶段 8 域名补丁兜底）。

---

## 6. 修复建议（按优先级）

| 编号 | 位置 | 动作 |
|---|---|---|
| P3-1 | `src/dom/walker.ts:37` | 循环体加 `nodeType !== ELEMENT_NODE` 守卫（一行，已验证） |
| P3-2 | `src/dom/observer.ts:53` | 下沉时为每个 shadowRoot 单独 `observe`，并在 walker 发现新 host 时补挂 |
| P3-3 | `src/dom/inject.ts:54` | `allTranslated()` 改为递归穿透 shadow 收集 `[data-pt="done"]` |
| P3-4 | `src/dom/classify.ts:32` | 把可见性判断（`getBoundingClientRect` 全零）加回 `shouldSkip()` |
| P3-5 | `entrypoints/content.ts:97` | 增量回调补 `.catch` |
| P3-6 | `entrypoints/popup/main.ts:91` | 广播应答按 `frameId === 0` 或聚合多帧结果后再决定提示 |
| P3-7 | `src/dom/collect.ts` | 确认保留或删除 |

P3-1 修复后请重跑本报告 §5.2 的 D1/D2 组；P3-2、P3-3 需要新增用例，建议一并纳入阶段 3 的第二轮验收。

---

## 7. 用户自测清单（修完 P3-1 后，约 8 分钟）

```bash
pnpm dev
```

1. **P3-1 回归（必测）**：打开任一含 Web Component 的页面（`sh.reddit.com` 即可）→ 点「翻译本页」→ 不应报错，正文出现译文。修复前此处整页失败。
2. **shadow 穿透自查**（Reddit 页面 Console）：

   ```javascript
   let n = 0;
   const visit = (root) => root.querySelectorAll('*').forEach(el => {
     if (el.shadowRoot) { n += el.shadowRoot.querySelectorAll('.pt-trans').length; visit(el.shadowRoot); }
   });
   visit(document); console.log('shadow 内译文数:', n);   // 预期 > 0
   ```
3. **YouTube**：任一英文视频，确认标题、简介、评论均出现译文。
4. **X 时间线**：翻译后向下滚动，新推文自动出现译文（验证 observer）。
5. **iframe**：找一个嵌入 CodePen / YouTube 播放器的英文页，确认 iframe 内文本也被翻译。
6. **P3-3 回归**：Reddit 上翻译 → 再点一次还原 → 确认 shadow 内的译文也消失（当前预期**不会**消失）。
7. **死循环自查**：翻译完成后静置 10 秒，Network 面板无持续新增的翻译请求。
8. **并发**：整页翻译时 Waterfall 同时 pending ≤ 6。
9. **自翻译自查**：`document.querySelectorAll('[data-pt-ui="1"] .pt-trans').length` → 预期 0。

第 1、2 条通过是阶段 3 判定通过的下限；P3-2、P3-3 若不在本阶段修，需明确记为阶段 4 的入口条件。
