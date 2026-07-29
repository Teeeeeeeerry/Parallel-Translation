# Parallel-Translation

对照式网页翻译浏览器扩展。原文与译文并排呈现，让阅读外语内容不必在两个界面之间来回切换。

> **当前进度：阶段 0 / 9 完成。** 扩展骨架已可加载进 Chrome，popup 按设计稿渲染，尚无翻译功能。
> 后续阶段见 [实施路线](#实施路线)。

## 项目状态

- [x] **阶段 0** — 骨架与设计系统
- [ ] **阶段 1** — 设置与存储层
- [ ] **阶段 2** — 翻译引擎与最短闭环
- [ ] **阶段 3** — DOM 采集完备化
- [ ] **阶段 4** — 显示模式与译文样式
- [ ] **阶段 5** — 注入式 UI
- [ ] **阶段 6** — 快捷键与划词交互
- [ ] **阶段 7** — 设置页完整化与 BYOK
- [ ] **阶段 8** — 兼容补丁、多浏览器与上架

每个阶段都有可机械判定的 DoD 验收标准，验收结果归档在 [`docs/DoD-report/`](docs/DoD-report/)。

**阶段 0 已交付：** MV3 manifest、WXT + TypeScript 构建链、设计令牌体系、popup 静态界面、options 空壳、background service worker 空实现。

**尚未实现：** 翻译引擎、DOM 采集、译文渲染、注入式 UI、快捷键 —— 即产品的全部核心功能。

## 计划特性

- **三种显示模式** — 全页对照、全页仅译文、单段翻译
- **六个触发入口** — 悬浮球、工具栏按钮、快捷键、段落悬停按钮、划词右键菜单、修饰键拖光标
- **多引擎与故障切换** — 免 key 引擎为主，支持自带 API key 接入 OpenAI / DeepL / Gemini，主引擎不可用时自动切换
- **跨平台快捷键** — 自动识别系统，Mac 显示 `⇧⌘Y`、Windows 显示 `Ctrl+Shift+Y`，全部可自定义
- **六种译文样式** — 默认、弱化显示（悬停才显）、实线下划线、加粗、斜体、半透明，另支持自定义 CSS
- **完备的 DOM 覆盖** — 穿透 shadow DOM、覆盖 iframe、动态加载内容自动补翻

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
| `pnpm zip` | 打包上架用 zip |
| `pnpm typecheck` | TypeScript 类型检查 |

## 文档

| 文档 | 内容 |
|---|---|
| [docs/phases/README.md](docs/phases/README.md) | 分阶段实施索引与依赖图 |
| [docs/phases/](docs/phases/) | 9 份阶段实施手册，含代码骨架、取舍理由、验收标准 |
| [docs/DoD-report/](docs/DoD-report/) | 各阶段 DoD 验收报告 |
| [docs/TESTING.md](docs/TESTING.md) | 自动化测试体系：集成、性能与内存、异常与边界、隐私与合规 |

## 实施路线

```
0 骨架与设计系统  →  1 设置与存储层  →  2 翻译引擎与最短闭环  →  3 DOM 采集完备化
    [已完成]                                                          │
                        ┌─────────────────────────────────────────────┤
                        ▼              ▼              ▼
                   4 显示模式      5 注入式 UI     6 快捷键与划词
                        └──────────────┴──────────────┘
                                       ▼
                          7 设置页完整化与 BYOK  →  8 兼容补丁、多浏览器与上架
```

`0 → 1 → 2 → 3` 硬串行；`4`、`5`、`6` 互不依赖可并行；`7`、`8` 收尾。排期理由见 [阶段索引](docs/phases/README.md#排期原则)。

## 贡献约定

- `main` 分支要求线性历史，禁止 merge commit，所有改动通过 PR 合入（squash 或 rebase）
- CSS 类、DOM `data-` 属性、storage key 一律用 `pt-` / `pt` 前缀
- 颜色与排版一律引用 [`src/styles/tokens.css`](src/styles/tokens.css) 中的设计令牌，**不得在组件内硬编码色值**
- 不复用任何第三方 GPL 代码；文档与代码中不出现同类产品的名称、标识符或归因措辞

完整约定见 [阶段索引的全局约定](docs/phases/README.md#全局约定)。

## 隐私

不收集任何个人信息，无分析、无埋点、无远程日志。待翻译文本会发送至用户所选的翻译服务提供方。设置存于浏览器同步存储；翻译缓存与 API 密钥存于本地存储，密钥不参与云端同步。

## 许可

尚未确定。在选定许可证之前，本仓库保留所有权利。
