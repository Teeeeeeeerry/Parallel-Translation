# Parallel-Translation

对照式网页翻译浏览器扩展。原文与译文并排呈现，让阅读外语内容不必在两个界面之间来回切换。

> **当前进度：功能开发已完成（阶段 0–8），版本 v0.6.1。上架推迟，仍在继续开发。** 扩展已能从悬浮球、工具栏 popup、快捷键、段落悬停按钮、划词右键菜单、修饰键拖光标六个入口触发翻译；三种显示模式与六种译文样式即时切换、不产生任何额外请求；shadow DOM、同源 iframe、无限滚动与 SPA 路由切换的新内容均已覆盖；六分区设置页、三个 BYOK 引擎、三语界面与 Chrome / Edge / Firefox 三目标构建均已就绪。
> 商店上架材料（隐私政策、商店文案、截图规格）已备在 [`store/`](store/)，但**提交审核不在当前计划内** —— 待功能与真机验证稳定后再启动。

## 项目状态

- [x] **阶段 0** — 骨架与设计系统
- [x] **阶段 1** — 设置与存储层
- [x] **阶段 2** — 翻译引擎与最短闭环
- [x] **阶段 3** — DOM 采集完备化
- [x] **阶段 4** — 显示模式与译文样式
- [x] **阶段 5** — 注入式 UI
- [x] **阶段 6** — 快捷键与划词交互
- [x] **阶段 7** — 设置页完整化与 BYOK
- [x] **阶段 8** — 兼容补丁与多浏览器适配（上架材料已备，提交审核推迟）

每个阶段都有可机械判定的 DoD 验收标准，验收结果归档在 [`docs/DoD-report/`](docs/DoD-report/)。

**阶段 0 已交付：** MV3 manifest、WXT + TypeScript 构建链、设计令牌体系、popup 静态界面、options 空壳、background service worker 空实现。

**阶段 1 已交付：** 全局 `Settings` schema 与默认值、`chrome.storage.sync` 设置读写与跨上下文变更订阅、带 LRU 淘汰的翻译缓存、与设置隔离的 BYOK 密钥存储；popup 从静态页改为读写真实设置。

**阶段 2 已交付：** 统一的 `TranslateEngine` 接口、两个免 key 引擎（Google Web / Bing Edge）、按优先级故障切换的路由器、可动态调上限的并发闸门、简版 DOM 采集与对照注入；`popup → content → background → 引擎 → 注入` 全链路打通，仍无需 `host_permissions`。

**阶段 3 已交付：** 节点分类三集合与翻译单元判定、递归穿透 shadow DOM 的 TreeWalker 采集、主文档与各 shadowRoot 分别挂载的 MutationObserver 增量补翻、`all_frames` 覆盖同源 iframe；数字内容、非正文区域与不可见元素在采集阶段即被过滤，不消耗翻译额度。

**阶段 4 已交付：** 三种显示模式与六种译文样式全部由挂在 `<html>` 上的类名 + CSS 表达，切换零 DOM 操作、零请求；原文包进 `.pt-origin` 时用 DOM 搬移而非 `innerHTML`，宿主页面的事件监听器不丢失；自定义 CSS 只收声明块并限定在 `.pt-trans` 作用域，改不动宿主页面也改不动扩展自身 UI。

**阶段 5 已交付：** 经 shadow DOM 双向隔离的悬浮球、段落悬停按钮与 toast，令牌随之注入各 shadow root，在激进 reset 的站点上外观不变；悬浮球四态状态机、位移阈值区分拖动与点击、位置持久化；段落按钮带悬停意图判定（停住才浮出，划过不打扰）、定位钳制在视口内并随滚动重新贴合；注入 UI 一律带 `data-pt-ui="1"`，不会被自己翻译。

**阶段 7 已交付：** 六分区设置页（通用 / 引擎 / 外观 / 快捷键 / 站点 / 高级），`Settings` 每个字段都有对应控件、改完即时持久化无需保存；引擎优先级拖拽排序并可启用停用，顺序即故障切换顺序；三个 BYOK 引擎（OpenAI / DeepL / Gemini）带「测试连接」与自定义模型名，密钥走请求头、不进 URL 也不参与云端同步；LLM 引擎编号批量请求并按编号回填，漏行时缺失留空而非整体错位；简中 / 繁中 / 英文三语界面覆盖设置页、popup、悬浮球、段落按钮、toast 与右键菜单。

**阶段 8 已交付：** YouTube 与 GitHub 的域名级采集补丁（纯增量，补丁表为空时行为与阶段 3 完全一致）、Chrome / Edge / Firefox 三目标构建、Firefox 的 gecko id 与最低版本声明、四尺寸图标。最终产物只申请 `storage` 与 `contextMenus` 两项权限，无 `host_permissions`。

上架材料（隐私政策、中英文商店文案、截图规格）一并写在 [`store/`](store/)，与代码同步维护，但**提交商店审核推迟**：5 张 1280×800 实拍截图未补，两份 DoDR-2 列的真机走查项也未走完。这条线不阻塞后续开发。

**阶段 6 已交付：** 平台无关的组合键表示（`Mod` 与 `Ctrl` 分开建模）、Mac/Windows 各自的显示映射与修饰键顺序、捕获阶段监听以抢在吞按键的页面之前、录制组件与保留组合/重复绑定的冲突检测；另有划词右键菜单与修饰键拖光标两个划词入口。

## 特性

- **三种显示模式** — 全页对照、全页仅译文、单段翻译
- **六个触发入口** — 悬浮球、工具栏按钮、快捷键、段落悬停按钮、划词右键菜单、修饰键拖光标
- **多引擎与故障切换** — 免 key 引擎为主，支持自带 API key 接入 OpenAI / DeepL / Gemini，主引擎不可用时自动切换
- **跨平台快捷键** — 自动识别系统，Mac 显示 `⇧⌘Y`、Windows 显示 `Ctrl+Shift+Y`，全部可自定义
- **六种译文样式** — 默认、弱化显示（悬停才显）、实线下划线、加粗、斜体、半透明，另支持自定义 CSS
- **完备的 DOM 覆盖** — 穿透 shadow DOM、覆盖 iframe、动态加载内容自动补翻
- **三语界面** — 简体中文、繁体中文、English，随浏览器界面语言自动切换
- **最小权限** — 只申请 `storage` 与 `contextMenus`，无 `host_permissions`

## 技术栈

WXT + TypeScript + Vite，Manifest V3。目标浏览器 Chrome / Edge / Firefox。

包管理器为 pnpm，已通过 `packageManager` 字段锁定 —— 请勿使用 npm 或 yarn。

## 本地开发

```bash
pnpm install
pnpm dev
```

产物在 `.output/chrome-mv3/`。装进浏览器：

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择 `.output/chrome-mv3/`
   —— 注意选构建产物目录而非项目根目录；`.output` 是隐藏目录，在选择框内按 `Cmd+Shift+.` 显示
3. 点击工具栏图标即可看到 popup

### 可用脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式，带热重载 |
| `pnpm dev:firefox` | 同上，目标 Firefox |
| `pnpm build` | 生产构建 |
| `pnpm build:firefox` | 生产构建，目标 Firefox |
| `pnpm build:edge` | 生产构建，目标 Edge |
| `pnpm zip` | 打包上架用 zip |
| `pnpm zip:firefox` / `pnpm zip:edge` | 同上，对应目标 |
| `pnpm typecheck` | TypeScript 类型检查 |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/phases/README.md](docs/phases/README.md) | 分阶段实施索引与依赖图 |
| [docs/phases/](docs/phases/) | 9 份阶段实施手册，含代码骨架、取舍理由、验收标准 |
| [docs/DoD-report/](docs/DoD-report/) | 各阶段 DoD 验收报告 |
| [docs/TESTING.md](docs/TESTING.md) | 自动化测试体系：集成、性能与内存、异常与边界、隐私与合规 |
| [store/](store/) | 上架材料：隐私政策、中英文商店文案、截图规格（提交审核推迟） |

## 实施路线

```
0 骨架与设计系统  →  1 设置与存储层  →  2 翻译引擎与最短闭环  →  3 DOM 采集完备化
    [已完成]            [已完成]              [已完成]              [已完成]
                                                                     │
                        ┌────────────────────────────────────────────┤
                        ▼              ▼              ▼
                   4 显示模式      5 注入式 UI     6 快捷键与划词
                    [已完成]        [已完成]         [已完成]
                        └──────────────┴──────────────┘
                                       ▼
                          7 设置页完整化与 BYOK  →  8 兼容补丁与多浏览器适配
                                [已完成]                    [已完成]
                                                       （上架推迟，见 store/）
```

`0 → 1 → 2 → 3` 硬串行；`4`、`5`、`6` 互不依赖可并行；`7`、`8` 收尾。排期理由见 [阶段索引](docs/phases/README.md#排期原则)。

## 其它

- `main` 分支要求线性历史，禁止 merge commit，所有改动通过 PR 合入（squash 或 rebase）
- CSS 类、DOM `data-` 属性、storage key 一律用 `pt-` / `pt` 前缀
- 颜色与排版一律引用 [`src/styles/tokens.css`](src/styles/tokens.css) 中的设计令牌，**不得在组件内硬编码色值**

完整要求见 [阶段索引的全局要求](docs/phases/README.md#全局要求)。

## 隐私

不收集任何个人信息，无分析、无埋点、无远程日志。待翻译文本会发送至用户所选的翻译服务提供方。设置存于浏览器同步存储；翻译缓存与 API 密钥存于本地存储，密钥不参与云端同步。

内容脚本在所有页面静态注入，但在用户主动触发翻译之前不读取、不发送任何页面内容。完整说明见 [`store/privacy-policy.md`](store/privacy-policy.md)。

## 许可

尚未确定。在选定许可证之前，本仓库保留所有权利。
