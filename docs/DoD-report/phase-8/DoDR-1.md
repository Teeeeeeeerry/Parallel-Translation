# 阶段 8 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 8 — 兼容补丁、多浏览器与上架 |
| 验收依据 | `docs/phases/phase-8-compat-release.md` |
| 被测提交 | `f79f257` feat: 阶段 7/8 —— 设置页完整化 + BYOK 引擎 + 兼容补丁 + 多浏览器适配（分支 `v0.6-options/compat-release`） |
| 同批报告 | [阶段 7 DoDR-1](../phase-7/DoDR-1.md) |
| 验收日期 | 2026-08-01 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | 补丁逻辑断言 15 条（F 组）+ 三目标构建 + 产物 manifest 终检（J 组）+ 隐私政策一致性核查（K 组） |
| **结论** | **不通过** — 补丁层与多浏览器构建全绿，但上架材料有 3 项缺陷，其中 1 项为隐私政策与实际行为不符 |

---

## 1. 缺陷

### P8-1 版本号仍停在 `0.5.4`

`package.json` 是 `0.5.4`，三个目标的产物 manifest 也都是 `0.5.4`，但被测提交 `f79f257` 的标题声称 v0.6.0。阶段 7/8 的全部功能都挂在一个未提升的版本号上，上架后无法与 0.5.4 区分，用户端也不会收到更新。

```
$ python3 -c "import json;print(json.load(open('.output/chrome-mv3/manifest.json'))['version'])"
0.5.4
```

（J-3 断言「manifest.version 与 package.json 一致」是通过的 —— 阶段 6 [DoDR-2 X-1](../phase-6/DoDR-2.md) 建立的运行时读取机制没有退化，问题出在源头没 bump。）

### P8-2 隐私政策的注入时机描述与 manifest 不符

`store/privacy-policy.md` 权限一节写：

> 内容脚本仅在用户主动点击翻译按钮后注入当前页面。

而产物 manifest 是静态声明的全站注入：

```json
"content_scripts": [{ "matches": ["<all_urls>"], "all_frames": true, "run_at": "document_end" }]
```

内容脚本在**每个页面的每个 frame** 上自动运行，不需要用户点任何东西。这一条是审核方会逐字核对的项目，描述与实际行为不符比描述得保守要严重得多。

正确的写法是承认全站注入，同时说明「注入的脚本在用户主动触发翻译前不会读取或外发任何页面内容」—— 这与代码实际行为一致（`content.ts` 只在收到指令后才调 `collect()`）。

失败断言：K-6。

### P8-3 `store/screenshots/` 目录不存在

DoD 要求 5 张 1280×800 截图就位，`store/` 下只有三份 markdown：

```
$ ls store
description-en.md  description-zh.md  privacy-policy.md
```

截图无法由代码生成，需要在真实浏览器里按 DoD 列的五个主题（对照模式全貌 / 仅译文模式 / 6 种样式对比 / 设置页 / 划词翻译）实拍。

失败断言：J-7。

---

## 2. 通过项

DoD 十二项逐条：

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | YouTube 时长、播放量等元数据不再被翻译 | ✅ | F-5、F-6（F-7 确认正常标题仍交回通用逻辑） |
| 2 | GitHub 代码块、文件名、commit hash 不再被翻译 | ✅ | F-8 ~ F-13（F-14 确认 PR 描述正文不受影响） |
| 3 | 补丁表为空时行为与阶段 3 完全一致 | ✅ | F-15：未命中域名下，即便元素同时满足 YouTube 与 GitHub 的全部选择器，`applyCompat` 也恒返回 `null` |
| 4 | 三个构建目标均成功 | ✅ | chrome-mv3 98.74 kB / firefox-mv2 98.81 kB / edge-mv3 98.74 kB，均 0 error |
| 5 | Firefox 中扩展可加载，核心流程正常 | ⏳ | 见 §3（且受阶段 7 P7-1 阻断） |
| 6 | Edge 中扩展可加载，核心流程正常 | ⏳ | 见 §3（且受阶段 7 P7-1 阻断） |
| 7 | `permissions` 仅含 storage 与 contextMenus | ✅ | J-1，三目标一致 |
| 8 | 无 `host_permissions` | ✅ | J-2，三目标一致 |
| 9 | 图标四种尺寸齐备 | ✅ | J-6（16/32/48/128 均在 manifest 与产物中）；深浅色工具栏观感需人眼判断 |
| 10 | 隐私政策覆盖全部要点 | ❌ | P8-2 |
| 11 | 5 张 1280×800 截图就位 | ❌ | P8-3 |
| 12 | 全量回归 5 站 × 6 入口 × 3 模式 | ⏳ | 见 §3 |

`mainDomain()` 的四条边界断言（F-1 ~ F-4）通过，含单段主机 `localhost` 与四级域 `a.b.c.youtube.com`。

Firefox 产物的 `browser_specific_settings.gecko.id` 与 `strict_min_version` 均已生成（J-4、J-5），AMO 的硬性要求满足。

---

## 3. 待真机自测项

- Firefox / Edge 实机加载与核心流程回归（**前置**：阶段 7 的 P7-1 修复，否则 Chrome 系产物根本装不上）
- Firefox 的三项已知差异点：background 脚本生命周期、`storage.sync` 配额、shadow DOM 隔离
- 图标在浅色 / 深色工具栏下的清晰度
- 全量回归矩阵（5 站点 × 6 入口 × 3 模式）
- 补丁在真实 YouTube / GitHub 页面上的命中情况 —— 本轮用的是选择器替身，验证的是判定逻辑而非选择器是否仍匹配对方当前的 DOM
