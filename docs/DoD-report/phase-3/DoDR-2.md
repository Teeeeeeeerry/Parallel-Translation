# 阶段 3 DoD 验收报告 #2（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 3 — DOM 采集完备化 |
| 验收依据 | `docs/phases/phase-3-dom.md` |
| 被测提交 | `fdf32e4` fix: DoDR-1 验收缺陷修复 (P3-1~P3-7)（分支 `v0.4-dom`） |
| 上一轮 | [DoDR-1](DoDR-1.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 27 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + manifest 审计 + jsdom 用例 37 条 + 闸门专项 + 性能剖析 + `en.wikipedia.org/wiki/Translation` 真实页面 |
| **结论** | **未通过** — 上轮 7 项缺陷（P3-1 ~ P3-7）**全部修复且复测通过**，功能面 36/37 绿。但本轮修复引入 2 项新阻塞缺陷：**P3-8** `startObserver()` 初始扫描代价随嵌套深度指数增长，真实页面上冻结主线程 2 分钟以上未完成；**P3-9** popup 改用 `frameId: 0` 后 iframe 不再收到翻译指令，DoD 4 回归。两者修法均已验证 |

---

## 1. 上轮问题复测：7/7 通过

| 编号 | 上轮问题 | 本轮 | 复测依据 |
|---|---|---|---|
| P3-1 | `walk()` 进 shadowRoot 抛 `TypeError`，整页采集被拖垮 | ✅ | `walker.ts:40` 加 `nodeType` 守卫；含 shadow host 的页面正常采集，空 shadowRoot 亦不抛 |
| P3-2 | observer 不覆盖 shadow root 内新增节点 | ✅ | 每个 shadowRoot 各挂一个 observer；三层嵌套各层新增、翻译后才出现的 host 均被补翻 |
| P3-3 | `allTranslated()` 不穿透 shadow，译文还原不掉 | ✅ | 改为递归收集；两层 shadow + light 共 3 个容器全部还原，零残留 |
| P3-4 | 丢失可见性与非正文区域过滤 | ✅ | 维基页面采集单元 **987 → 376**，落在导航/页脚/侧栏/参考文献区的 **611 → 0** |
| P3-5 | 增量补翻 rejection 无人接管 | ✅ | `content.ts:97` 补 `.catch`，且改为不 `await`、不阻塞防抖计时器 |
| P3-6 | iframe 广播的响应竞争 | ⚠️ | 提示误报已消除，但引入 P3-9（见 §2.2） |
| P3-7 | `collect.ts` 无引用 | ✅ | 文件已删除 |

---

## 2. 本轮新增阻塞缺陷

### P3-8 `startObserver()` 初始扫描的代价随嵌套深度指数增长（阻塞）

`src/dom/observer.ts:23-38`，`observeShadowRoots` 内的 `walk`：

```typescript
const walk = (node: Node) => {
  ...
  el.querySelectorAll?.('*')?.forEach((child) => walk(child));   // ← 问题在这一行
};
```

`querySelectorAll('*')` 返回的是**整棵子树**而不是直接子节点，却又对其中每个后代再次调用 `walk`。于是深度为 k 的节点会沿 2^(k-1) 条祖先路径被重复访问，每次访问还各自做一遍 `querySelectorAll`。

实测（1200 个段落，只改嵌套深度）：

| 嵌套深度 | 元素数 | `startObserver()` 耗时 |
|---|---|---|
| 2 | 1205 | 18 ms |
| 4 | 1207 | 60 ms |
| 8 | 1211 | 867 ms |
| 12 | 1215 | **14,622 ms** |

真实页面（`en.wikipedia.org/wiki/Translation`，7227 个元素）：**跑满 2 分钟仍未返回**；插桩计数显示 959 ms 内已发出 `querySelectorAll('*')` **20 万次**、累计遍历 20.7 万个节点，仍在继续。

触发路径是首次翻译成功后的 `content.ts:97` → `startObserver()`，运行在页面主线程上，且 `flush()` 里对每个新增节点还会再跑一次同样的扫描。后果是**翻译刚成功页面就卡死**，DoD 3、5 的 observer 能力实际不可用。真实浏览器的 DOM 实现比 jsdom 快，但指数复杂度不会因此消失。

**修复**（只对 shadow 边界递归，light DOM 交给一次 `querySelectorAll` 即可）：

```typescript
const walk = (scope: ParentNode) => {
  scope.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot && !seen.has(el.shadowRoot)) {
      seen.add(el.shadowRoot);
      const mo = new MutationObserver(onMutation);
      mo.observe(el.shadowRoot, { childList: true, subtree: true });
      observers.push(mo);
      walk(el.shadowRoot);        // 只在 shadow 边界处递归
    }
  });
};
```

补丁副本实测：深度 12 由 14,622 ms 降至 **1 ms**；维基真实页面 **7 ms** 完成；P3-2 全组（含三层嵌套、后挂 host、`stop()` 断开）仍全部通过。

### P3-9 `frameId: 0` 使 iframe 不再被翻译，DoD 4 回归（阻塞）

`entrypoints/popup/main.ts:95-99` 为修 P3-6 把广播改成定向：

```typescript
const resp = await chrome.tabs.sendMessage(tabId, { type: 'pt:toggle-translate' }, { frameId: 0 });
```

代码注释写的是「其余 frame 由 background 的工具栏图标点击负责广播切换」，但**这个广播并不存在**：全仓 `pt:toggle-translate` 的发送方只有这一处，background 里没有 `action.onClicked` 监听器，而且 `manifest.action` 配了 `default_popup`，`onClicked` 本就永远不会触发。

结果：`all_frames: true` 依然把 content script 注入每个 iframe，但没有任何消息送达它们，iframe 内文本不会被翻译。DoD 4「含同源 iframe 的页面，iframe 内文本能翻译」从上一轮的通过退回不通过。

**建议修法**：仍向所有 frame 广播，只是 UI 提示改为按主文档结果决定 —— 例如先 `chrome.webNavigation.getAllFrames` / 或对广播结果取「任一 frame 返回 `translated`」为准，而不是取第一个应答者。或保留广播，把 `no-elements` 提示条件收紧为「所有 frame 都返回 `no-elements`」。

---

## 3. DoD 结果总览

| # | DoD 项 | #1 | #2 | 说明 |
|---|---|---|---|---|
| 1 | Reddit 帖子与评论能翻译 → shadow 穿透 | ❌ | ✅ | 单层 / 三层嵌套 / 混排全部通过 |
| 2 | YouTube 标题、简介、评论 → 自定义元素 | ❌ | ✅ | 带 shadow 与 slot 分发两种形态均通过 |
| 3 | X 时间线滚动自动补翻 → observer | ✅ | ⚠️ | 功能逻辑成立，但被 P3-8 阻断 |
| 4 | 同源 iframe 内文本能翻译 → `all_frames` | ✅ | ❌ | P3-9 回归 |
| 5 | Medium SPA 路由切换自动补翻 | ✅ | ⚠️ | 同 DoD 3 |
| 6 | 嵌套结构只产生一份译文 | ✅ | ✅ | 真实页面 376 个容器零重复 |
| 7 | 悬浮球与按钮文字未被翻译 | ✅ | ✅ | |
| 8 | 纯数字文本未被翻译 | ✅ | ✅ | |
| 9 | 无限滚动并发不超过 6 | ✅ | ✅ | 300 任务峰值恰为 6 |
| — | `typecheck` / `build` | ✅ | ✅ | 0 error / 51.32 kB |

自动化用例 **36 / 37 通过**，唯一失败项为环境限制（见 §4.3）。

---

## 4. 验证明细

### 4.1 新增用例（针对上轮 7 项修复）

| 编号 | 断言 | 结果 |
|---|---|---|
| P3-1 | 含 shadow host 的页面，light DOM 段落不受牵连 | ✅ |
| P3-1b | 空 `attachShadow()` 不抛异常 | ✅ |
| P3-2 | 已存在 shadow root 内追加 `<p>` 被补翻 | ✅ |
| P3-2b | 三层嵌套 shadow，各层各追加一段全部被补翻 | ✅ |
| P3-2c | 翻译后新出现的 shadow host，其 shadow 内新增也被补翻 | ✅ |
| P3-2d | `stop()` 后主文档与所有 shadow observer 一并断开 | ✅ |
| P3-3 | `allTranslated()` 覆盖两层 shadow，还原后 light 与 shadow 零残留 | ✅ |
| P3-4 | `nav` / `aside` / `footer` / `.references` 内容不被采集 | ✅ |
| P3-4b | 零矩形（不可见）子树不被采集 | ✅ |
| P3-7 | `src/dom/collect.ts` 已删除 | ✅ |

第一轮的 27 条全部沿用并复跑，除 D8-4 外均通过。

### 4.2 真实页面（`en.wikipedia.org/wiki/Translation`，7227 个元素）

| 观察项 | #1 | #2 |
|---|---|---|
| 采集单元数 | 987 | **376** |
| 落在导航/页脚/侧栏/参考文献区 | 611（27.1% 字符） | **0** |
| 正文 `<p>` 保留率 | 167 / 175 | 167 / 175 |
| 总字符数 | 131,116 | 95,553 |
| `collect()` 耗时 | — | 249 ms |
| `startObserver()` 耗时 | — | **> 120,000 ms 未完成**（修 P3-8 后 7 ms） |
| 注入 376 段耗时 / `allTranslated()` | — | 33 ms / 18 ms |
| 重复译文异常容器 | 0 | 0 |
| 注入后立即再采集 | 0 | 0 |
| 还原后 `innerHTML` 与注入前逐字节一致 | ✅ | ✅ |
| 还原后 light / shadow 内残留 `.pt-trans` | 0 / **1** | 0 / **0** |

### 4.3 未通过项：D8-4（环境限制，非代码缺陷）

`.notranslate` 与 `pre` 两条成立，漏网的是 `contenteditable`。jsdom 未实现 `HTMLElement.isContentEditable`（实测为 `undefined`），真实浏览器中该属性对 `contenteditable` 的子孙元素返回 `true`，`classify.ts:36` 的判断本身是对的。此条需真机复核，与上轮结论一致。

### 4.4 并发闸门（DoD 9）

模拟无限滚动 12 轮 flush × 每轮 25 段 = 300 个任务经同一闸门：

```
总任务: 300 | 完成: 300 | 并发峰值: 6  ✔ ≤6
```

### 4.5 产物审计

```
pnpm typecheck                        → 0 error
pnpm build                            → 51.32 kB
manifest.json  "version":"0.4.0"，content_scripts[0].all_frames = true
               matches = ["<all_urls>"]，run_at = document_end
               permissions 仅 ["storage"]，无 host_permissions
```

`all_frames` 在 manifest 层仍然成立，DoD 4 的失效发生在消息分发层（P3-9），不是注入层。

---

## 5. 性能建议（非阻塞）

### P3-10 `shouldSkip()` 对全树每个元素都做重活，可减少 4/5 的采集耗时

`walker.ts:51` 的判定顺序是 `!shouldSkip(el) && isTranslationUnit(el)`。`shouldSkip()` 对**每一个元素**（不只是候选块级元素）都会计算 `textContent`、拼出完整 `outerHTML` 字符串、调 `getBoundingClientRect()`（真实浏览器中会强制同步布局）、以及一次 `closest(NON_CONTENT)` 选择器匹配。而 `isTranslationUnit()` 第一步只是一次 `DIRECT_SET.has(tag)` 的哈希查表。

把两者调序（先便宜的标签判定，再做重活），维基页面实测：

```
现状 shouldSkip → isTranslationUnit : 251 ms，采集 376 个
调序 isTranslationUnit → shouldSkip : 53 ms，采集 376 个
```

输出完全一致，耗时降至 1/5。`getBoundingClientRect` 引发的强制回流在真实浏览器上的收益会比这里更明显。

---

## 6. 修复建议（按优先级）

| 编号 | 位置 | 动作 |
|---|---|---|
| P3-8 | `src/dom/observer.ts:33` | `walk` 只对 shadow 边界递归，删掉对 light DOM 后代的重复递归（已验证：14.6 s → 1 ms） |
| P3-9 | `entrypoints/popup/main.ts:95` | 恢复全 frame 广播，改为按结果聚合决定提示文案，而非取第一个应答者 |
| P3-10 | `src/dom/walker.ts:51` | 判定顺序改为 `isTranslationUnit(el) && !shouldSkip(el)`（251 ms → 53 ms） |

修完后需复跑本报告 §4.1 全组 + §4.2 的真实页面剖析，并补一条 iframe 广播的用例。

---

## 7. 用户自测清单（修完 P3-8、P3-9 后，约 8 分钟）

```bash
pnpm dev
```

1. **P3-8 回归（必测）**：打开一个正常长度的英文页（维基百科任一条目）→ 点「翻译本页」→ 译文出现后页面应立即可滚动、可交互。修复前此处会卡住数十秒到数分钟。
2. **P3-9 回归（必测）**：找一个嵌入 CodePen / YouTube 播放器的英文页 → 翻译 → 确认 **iframe 内**文本也出现译文。
3. **shadow 穿透**（`sh.reddit.com` Console）：

   ```javascript
   let n = 0;
   const visit = (root) => root.querySelectorAll('*').forEach(el => {
     if (el.shadowRoot) { n += el.shadowRoot.querySelectorAll('.pt-trans').length; visit(el.shadowRoot); }
   });
   visit(document); console.log('shadow 内译文数:', n);   // 预期 > 0
   ```
4. **shadow 内增量**（Reddit）：翻译后向下滚动，shadow 内新出现的帖子/评论也应自动补翻。
5. **还原**（Reddit）：再点一次，light DOM 与 shadow 内的译文应同时消失。
6. **YouTube / X / Medium**：分别验证标题简介评论、滚动补翻、SPA 跳转补翻。
7. **contenteditable**（D8-4 真机补测）：打开任一带富文本编辑器的页面，确认编辑区内文字未被翻译。
8. **死循环自查**：翻译完成后静置 10 秒，Network 面板无持续新增的翻译请求。
9. **并发**：整页翻译时 Waterfall 同时 pending ≤ 6。

第 1、2 条通过是阶段 3 判定通过的下限。
