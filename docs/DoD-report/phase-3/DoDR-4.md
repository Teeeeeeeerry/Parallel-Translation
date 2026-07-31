# 阶段 3 DoD 验收报告 #4（版本号变更后回归）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 3 — DOM 采集完备化 |
| 验收依据 | `docs/phases/phase-3-dom.md` |
| 被测提交 | `73c0656` chore: 版本号统一至 0.4.1（分支 `v0.4-dom`） |
| 前三轮 | [DoDR-1](DoDR-1.md)、[DoDR-2](DoDR-2.md)、[DoDR-3](DoDR-3.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 27 |
| 验收方式 | 版本号一致性专项 3 条 + DoDR-3 全套回归（jsdom 41 条 + 多 frame 4 条 + 闸门专项 + 真实页面剖析） |
| **结论** | **通过（代码与产物层面）** — 版本号变更未触及任何逻辑，48 条断言中 47 条通过，与 DoDR-3 逐项一致，无漂移。唯一失败项仍是 jsdom 环境限制。真机端到端仍需用户自测（清单见 [DoDR-3 §6](DoDR-3.md)） |

---

## 1. 本轮变更

`73c0656` 只动两个文件，无逻辑改动：

| 位置 | 变更前 | 变更后 |
|---|---|---|
| `package.json` | `0.4.0` | `0.4.1` |
| `entrypoints/popup/index.html` 页脚 | `v0.3.1` | `v0.4.1` |

版本号取补丁级递增：`0.4.0` 是阶段 3 功能提交（`f8b6ff5`）的版本，其后三轮验收共修复 P3-1 ~ P3-10 十项缺陷（`fdf32e4`、`9878d3d`），均为该功能的缺陷修复而非新增能力，故 `0.4.0 → 0.4.1`。

顺带修正了一处漂移：popup 页脚此前仍停在 `v0.3.1`，与 `package.json` 的 `0.4.0` 已不同步。这与阶段 2 [DoDR-6](../phase-2/DoDR-6.md) 修过的是同一类问题，说明手工同步靠不住 —— 建议阶段 8 打包前把页脚改为从 `manifest.version` 读取，或加一条构建期断言。

---

## 2. 版本号一致性专项

| 编号 | 断言 | 结果 |
|---|---|---|
| V-1 | `package.json` / 产物 `manifest.json` / `popup/index.html` 页脚 / 产物 `popup.html` 页脚 四处一致且为 `0.4.1` | ✅ |
| V-2 | `permissions` 仍为 `["storage"]`，无 `host_permissions` | ✅ |
| V-3 | `content_scripts[0].all_frames` 仍为 `true` | ✅ |

```
package.json             0.4.1
manifest.json（产物）      0.4.1
popup/index.html 页脚      0.4.1
popup.html（产物）页脚      0.4.1
```

---

## 3. 回归结果：与 DoDR-3 逐项一致

```
pnpm typecheck   → 0 error
pnpm build       → 51.38 kB（与上轮同）
```

| 套件 | DoDR-3 | 本轮 |
|---|---|---|
| jsdom 采集 / 分类 / observer / 还原 | 40 通过 / 1 失败 | 40 通过 / 1 失败 |
| content script 多 frame（F-0 ~ F-3） | 4 / 4 | 4 / 4 |
| 并发闸门（300 任务） | 峰值 6 | 峰值 6 |
| 版本号专项 | — | 3 / 3 |
| **合计** | 44 / 45 | **47 / 48** |

真实页面（`en.wikipedia.org/wiki/Translation`，7227 个元素）：

| 观察项 | DoDR-3 | 本轮 |
|---|---|---|
| `collect()` 耗时 / 采集单元 | 53 ms / 376 | 54 ms / 376 |
| `startObserver()` 初始扫描 | 9 ms | 8 ms |
| 注入 376 段 / `allTranslated()` | 73 / 17 ms | 78 / 15 ms |
| 重复译文异常容器 / 注入后再采集 | 0 / 0 | 0 / 0 |
| 还原后 `innerHTML` 逐字节一致 | ✅ | ✅ |
| 还原后残留 `.pt-trans`（light / shadow） | 0 / 0 | 0 / 0 |

耗时差异在同机多次运行的正常抖动范围内，无性能漂移。

---

## 4. DoD 结果总览

| # | DoD 项 | 结果 |
|---|---|---|
| 1 | Reddit 帖子与评论能翻译 → shadow 穿透 | ✅ |
| 2 | YouTube 标题简介评论 → 自定义元素 | ✅ |
| 3 | X 时间线滚动自动补翻 → observer | ✅ |
| 4 | 同源 iframe 内文本能翻译 → `all_frames` | ✅ |
| 5 | Medium SPA 路由切换自动补翻 | ✅ |
| 6 | 嵌套结构只产生一份译文 | ✅ |
| 7 | 悬浮球与按钮文字未被翻译 | ✅ |
| 8 | 纯数字文本未被翻译 | ✅ |
| 9 | 无限滚动并发不超过 6 | ✅ |

四轮累计修复 P3-1 ~ P3-10 共 10 项，本轮无新增待修项。

---

## 5. 唯一失败项与未覆盖

- **D8-4（环境限制，非代码缺陷）**：`.notranslate` 与 `pre` 成立，漏网的是 `contenteditable`。jsdom 未实现 `HTMLElement.isContentEditable`（实测 `undefined`），真实浏览器中该属性对 `contenteditable` 的子孙元素返回 `true`，`classify.ts:36` 的判断本身是对的。四轮结论一致，需真机复核。
- **可见性判断用了替身**：jsdom 不做布局，`getBoundingClientRect()` 恒返回零矩形，测试环境装了可控替身（默认 100×20，`data-invisible` 子树返回零）。因此验证的是判断接线正确，真实布局下的表现仍需真机确认。
- **端到端链路**：popup → content → background → 引擎的实际串联、以及真实的跨 frame 消息分发，本环境无法执行。
- **真实站点**：Reddit / YouTube / X / Medium 按 [TESTING.md](../../TESTING.md) 的分线策略不进自动化主线。

真机自测清单沿用 [DoDR-3 §6](DoDR-3.md) 的 11 条，本轮版本号变更不影响其中任何一条；额外补一条：打开 popup 确认页脚显示 **v0.4.1**。
