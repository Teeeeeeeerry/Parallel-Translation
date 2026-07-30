# 阶段 2 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md`（用户所指 `phase-2-storage.md` 不存在，storage 为阶段 1） |
| 被测提交 | `91eab65`（分支 `v0.3-engines`） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 构建产物 manifest 检查 + Node 桩测试（真实 `router`/`engines`/`gate` 源码，替身 `chrome.storage` 与 `fetch`）27 条断言，通过 25 / 失败 2 + 两个端点实网连通 + 在 `en.wikipedia.org/wiki/Translation` 真实 DOM 上运行 `collect`/`inject` |
| **结论** | **未通过** — 8 项 DoD 中 6 项满足，2 项部分满足（工具栏入口、还原保真）；另有 1 个接口失真缺陷与 1 个 HTML 注入面 |

---

## 1. 结果总览

| # | DoD 项 | 结果 |
|---|---|---|
| 1 | Wikipedia 英文页点工具栏图标，段落下方出现中文译文 | ⚠️ 引擎与注入均可用，但**点图标不会触发翻译** |
| 2 | 再次点击，译文消失（还原原文） | ⚠️ 文本还原，**页面结构不还原**（链接/格式永久丢失） |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ✅ |
| 4 | 屏蔽 `translate.googleapis.com` 后自动切 Bing，用户无感 | ✅ |
| 5 | 两引擎均不可用时给出可读错误，非静默失败 | ✅（原文亦不受损） |
| 6 | 同一页面二次翻译命中缓存，无新请求 | ✅ |
| 7 | 并发请求数不超过 6 | ✅ 当前调用形态成立，阶段 3 分批后会破（见 P2-5） |
| 8 | `manifest.json` 中无 `host_permissions` | ✅ |
| — | `pnpm typecheck` / `pnpm build` | ✅ |
| — | 译文顺序与 `texts` 严格对应（含部分缓存命中回填） | ✅ |
| — | `route()` 尊重 `TranslateRequest.from/to` | ❌ 见 P2-1 |

实网连通（真实端点，非替身）：

```
google → ["你好世界","早上好"]
bing   → ["你好，世界","早上好"]  detectedFrom=en
```

---

## 2. 待修问题

### P2-1 `route()` 丢弃入参的 `from` / `to`（P0，接口失真）

`src/engines/router.ts:19` 从设置里取 `from` / `to`，`:64` 构造 `subReq` 时用的是设置值，`req.from` / `req.to` 从未被使用；而同一函数 `:33` 的语言支持判断又读 `req.to`。同一次调用里"用来筛引擎的目标语言"和"实际发出的目标语言"可以是两个值。

桩测断言（失败）：

```
patchSettings({ from: 'auto', to: 'zh-CN' })
route({ texts: ['w'], from: 'en', to: 'ja' })
→ 实际请求 sl=auto&tl=zh-CN     期望 sl=en&tl=ja
```

现在不显现，是因为唯一调用方 `entrypoints/content.ts:27` 恰好传的就是同样的设置值。阶段 6「翻译光标所在段」与阶段 7 的按域名语言对一旦出现"这一次用别的语言对"，参数会被静默吞掉。修法二选一，不要两者并存：

- 以入参为准：`const { from, to } = req;`，设置只在调用方读取（推荐，接口才有意义）；
- 或从 `TranslateRequest` 删掉 `from`/`to`，明确声明语言对由设置单一决定。

### P2-2 `injectSimple` 用 `innerHTML` 拼接，还原丢结构且可执行注入（P0，阻塞 DoD 2）

`src/dom/inject.ts:14` 把原文当字符串拼进 `innerHTML`，而 `content.ts:22` 传入的原文是 `textContent`。在 Wikipedia 正文段（含 11 个链接）上实测：

| 观察项 | 注入后 | 还原后 |
|---|---|---|
| `<a>` 数量 | 0 | 0（原为 11） |
| `innerHTML` 与注入前一致 | — | 否 |
| `textContent` 与注入前一致 | — | 是 |
| `data-pt` 已清除 | — | 是 |

即 DoD 第 2 条只在纯文本层面成立：链接、`<i>`/`<sup>`、引用角标在第一次翻译时就被拍平，再次点击也拿不回来——用户在 Wikipedia 上翻译一次，全页引文链接就没了。

同一行还是一条注入路径。探针（真实页面）：

```js
injectSimple(p, 'a < b and <img src=x onerror="...">', 'T')
→ 页面里真的多出一个 <img>；原文文本被截断成 "a < b and "
```

原文来自页面自身，但**译文来自远端引擎**，且 `bing-edge.ts:52` 声明 `textType: 'html'`，远端返回值会带标签。content script 里插入的元素其事件处理器照常执行。

修法：不要拼 HTML。原文用 `el.childNodes` 整体搬进 `<span class="pt-origin">`（保留节点，还原时搬回），译文节点用 `textContent` 赋值：

```typescript
const origin = document.createElement('span');
origin.className = ORIGIN;
while (el.firstChild) origin.appendChild(el.firstChild);   // 保留原节点
const trans = document.createElement('span');
trans.className = TRANS;
trans.textContent = transText;                             // 不解析标签
el.append(origin, trans);
```

阶段 4 要做三模式渲染器，这个结构是前提，现在改比那时改便宜。

### P2-3 工具栏图标点击不触发翻译（P1，阻塞 DoD 1）

DoD 与文档骨架（`phase-2-engines.md:217`）都要求 `chrome.action.onClicked` → 通知 content script。`entrypoints/background.ts` 里没有这个监听器；且构建产物 `manifest.json` 含 `"default_popup": "popup.html"`——**只要声明了 default_popup，`action.onClicked` 永远不会触发**，两者互斥。

实际入口是 popup 的「翻译开关」按钮（`popup/main.ts:71`），它同时做两件事：写 `settings.enabled`，再给当前标签页发 `pt:toggle-translate`。于是"扩展总开关"和"本页翻译开关"被绑成一个控件：关掉总开关反而会触发一次翻译，`enabled` 与页面实际状态可以完全相反。

建议：popup 里拆成「总开关（enabled）」与「翻译本页」两个控件，DoD 第 1 条改以「翻译本页」按钮验收；若要保留点图标即翻译，则去掉 `default_popup` 并加 `onClicked` 监听——不能既要 popup 又要 onClicked。

### P2-4 采集范围过宽，长页面请求量千级（P1）

在 `en.wikipedia.org/wiki/Translation` 上 `collectSimple()` 返回 **1030** 个元素：

```
LI 783 | P 173 | FIGCAPTION 25 | H2 14 | H3 17 | H4 5 | BLOCKQUOTE 12 | H1 1
其中 96 个位于 nav / 侧边目录 / footer 内
```

Google 端点单段一请求，闸门 6 并发 → 一次全页翻译约 1030 个 HTTP 请求，导航与参考文献列表项占了大头。功能上不违反任何 DoD 项，但这是 DoD「翻译一个长页面」的实际成本，也容易先撞限流。阶段 3 的 walker 需要把 `nav/footer/aside/.reflist` 与纯链接列表项排除，并按字符数合并批次（Bing 原生批量正好吃得下）。

---

## 3. 风险记录（不阻塞本阶段）

**P2-5 闸门在引擎内部按调用新建。** `google-web.ts:48` 每次 `translate()` 都 `createGate(maxConcurrency)`。阶段 2 只有一次 `route()` 调用，所以峰值实测 ≤6（30 段文本，峰值 6）；一旦阶段 3 改成分批并行调用 `route()`，N 个批次就是 N 个独立闸门，总并发 = 6N，DoD 第 7 条随即失效。闸门应提到模块级单例、按引擎（或按域名）共享。

**P2-6 缓存写入串行 + 键含引擎 id。** `router.ts:78` 对每段文本 `await cacheSet`，而 `cache.ts` 把所有 index 操作串在一条 Promise 链上——1030 段即 1030 次串行的读-改-写。另外缓存键含引擎 id（阶段 1 的既有设计），故障切换到 Bing 后同一段文本要重翻一次，属预期取舍，记录备查。

**P2-7 `translated` 状态与响应值不同步。** `content.ts:69` 的 `sendResponse({ ok: true, translated })` 读的是 `doTranslate()` 执行前的旧值，回给 popup 的状态恒为反的。当前无人使用该字段。另外若 `chrome.runtime.sendMessage` 本身抛错（SW 未就绪、通道关闭），错误只回给 popup，页面上没有提示——DoD 第 5 条覆盖的是"引擎全失败"路径（该路径已验证会弹出 `⚠ Parallel-Translation: …` 且不改动原文），消息层失败未覆盖。

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                                     → 0 error
pnpm build                                         → 45.5 kB，chrome-mv3 产物完整
grep -n host_permissions .output/chrome-mv3/manifest.json → 无输出（DoD 8 ✅）
permissions: ["storage"]                             仅此一项
```

### 4.2 桩测试（真实源码，替身 `fetch` / `chrome.storage`）

| 编号 | 断言 | 结果 |
|---|---|---|
| T1.1–1.3 | `createGate(6)`：50 任务峰值 ≤6、保序返回、全部完成 | ✅ |
| T2.1–2.4 | Google 链路：30 段顺序严格对应、峰值 6、请求数=文本数、`sl=auto` 透传 | ✅ |
| T3.1–3.5 | Google `fetch` 抛错 → 自动切 Bing；出现 auth+translate 请求；`detectedFrom` 透出；`from=auto` 传空串；3 段仅 1 次 POST | ✅ |
| T4.1–4.2 | 优先级 `['bing-edge','google-web']` → 走 Bing，无任何 Google 请求 | ✅ |
| T5.1–5.2 | 401 清空令牌后重取且两次翻译共用一枚；`exp` 已过期则每次重取 | ✅ |
| T6.1–6.5 | 首次 3 请求 / 二次 0 请求 / 结果一致；部分命中只请求未命中项且槽位顺序正确 | ✅ |
| T7.1–7.2 | 全引擎失败抛「所有引擎均失败」，含两个引擎标识 | ✅ |
| T8.1–8.2 | `route()` 应把 `req.from`/`req.to` 传给引擎 | ❌ P2-1 |
| T9.1–9.2 | 优先级全为未注册引擎 → 报错而非静默，且不发请求 | ✅ |

对应 DoD 的验证步骤映射：「故障切换」= T3，「引擎优先级」= T4，「缓存命中」= T6，「并发上限」= T1/T2.2，「全引擎失败」= T7。

### 4.3 真实 DOM（`en.wikipedia.org/wiki/Translation`）

| 观察项 | 结果 |
|---|---|
| `collectSimple()` 元素数 | 1030（见 P2-4） |
| 注入后 `data-pt="done"` 与 `.pt-trans` 就位 | ✅ |
| 重新采集跳过已翻译容器 | ✅ |
| `allTranslated()` 定位准确 | ✅ |
| 还原后 `textContent` 一致 | ✅ |
| 还原后 `innerHTML` / 链接数一致 | ❌ 11 → 0（P2-2） |
| 原文含 `<img onerror>` 时是否被解析 | ❌ 生成真实 `<img>`（P2-2） |

未覆盖：扩展加载到浏览器后的端到端点击链路（消息层 `background ↔ content` 未实测），本次以代码走查 + 分段验证替代。P2-3 修好后应补一次真机复测。

---

## 5. 复测清单

修完后按此复测，全绿方可判定阶段 2 通过：

1. `route({ texts, from: 'en', to: 'ja' })` 在设置为 `auto/zh-CN` 时，实际请求为 `sl=en&tl=ja`（T8）。
2. Wikipedia 正文段翻译后再还原，`innerHTML` 与翻译前逐字节一致，链接数不变。
3. 译文形如 `<img src=x onerror=...>` 时页面不生成该元素，按纯文本显示。
4. 点工具栏图标（或明确的「翻译本页」按钮）能翻译；总开关与本页开关互不串味。
5. 分两批并行调用 `route()`，Network 同时 pending 的翻译请求仍 ≤6。
6. `collectSimple()` 在同一 Wikipedia 页返回的元素中，`nav`/`footer`/侧边目录内的数量为 0。
