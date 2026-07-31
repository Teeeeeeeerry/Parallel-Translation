# Parallel-Translation

对照式网页翻译浏览器扩展。原文与译文并排呈现，让阅读外语内容不必在两个界面之间来回切换。

Chrome / Edge / Firefox，Manifest V3，当前 v0.6.1。

## 特性

**三种显示模式** —— 全页对照、全页仅译文、单段翻译。模式与样式全部由挂在 `<html>` 上的类名 + CSS 表达，切换时零 DOM 操作、零请求。

**六个触发入口** —— 悬浮球、工具栏 popup、快捷键、段落悬停按钮、划词右键菜单、修饰键拖光标。

**六种译文样式** —— 默认、弱化显示（悬停才显）、实线下划线、加粗、斜体、半透明，另可写自定义 CSS。自定义 CSS 只收声明块并限定在 `.pt-trans` 作用域内，改不动宿主页面，也改不动扩展自身 UI。

**多引擎与故障切换** —— 免 key 的 Google / Bing 引擎开箱即用；可自带 API key 接入 OpenAI、DeepL、Gemini。引擎优先级可拖拽排序，顺序即故障切换顺序；引擎不支持目标语言时自动跳过，key 无效则直接报错而不是把所有引擎试一遍。

**LLM 引擎不会错位** —— OpenAI 与 Gemini 编号批量请求、按编号回填。模型漏行时缺失段落留空，而不是整篇译文整体偏移一行挂到错误的原文上。

**完备的 DOM 覆盖** —— 递归穿透 shadow DOM、覆盖同源 iframe，无限滚动与 SPA 路由切换的新内容自动补翻。数字、非正文区域与不可见元素在采集阶段就被过滤，不消耗翻译额度。

**跨平台快捷键** —— 自动识别系统，Mac 显示 `⇧⌘Y`、Windows 显示 `Ctrl+Shift+Y`，全部可自定义，录制时会提示浏览器保留组合与重复绑定。

**不被宿主页面影响** —— 注入 UI 经 shadow DOM 双向隔离，在 CSS reset 激进的站点上外观不变；也不会被扩展自己翻译。

**三语界面** —— 简体中文、繁体中文、English，随浏览器界面语言自动切换。

**最小权限** —— 只申请 `storage` 与 `contextMenus`，无 `host_permissions`。

## 安装与开发

```bash
pnpm install
pnpm dev
```

产物在 `.output/chrome-mv3/`。装进浏览器：

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择 `.output/chrome-mv3/`
   —— 注意选构建产物目录而非项目根目录；`.output` 是隐藏目录，在选择框内按 `Cmd+Shift+.` 显示
3. 点击工具栏图标即可看到 popup

技术栈为 WXT + TypeScript + Vite。包管理器是 pnpm，已通过 `packageManager` 字段锁定 —— 请勿使用 npm 或 yarn。

| 命令 | 说明 |
|---|---|
| `pnpm dev` / `pnpm dev:firefox` | 开发模式，带热重载 |
| `pnpm build` / `build:firefox` / `build:edge` | 生产构建 |
| `pnpm zip` / `zip:firefox` / `zip:edge` | 打包上架用 zip |
| `pnpm typecheck` | TypeScript 类型检查 |

## 隐私

不收集任何个人信息，无分析、无埋点、无远程日志。待翻译文本会发送至用户所选的翻译服务提供方。设置存于浏览器同步存储；翻译缓存与 API 密钥存于本地存储，**密钥不参与云端同步**，导出配置也不含密钥。

内容脚本在所有页面静态注入，但在用户主动触发翻译之前不读取、不发送任何页面内容。完整说明见 [`store/privacy-policy.md`](store/privacy-policy.md)。

## 项目状态

九个阶段的功能开发已全部完成。每个阶段都有可机械判定的 DoD 验收标准，验收结果归档在 [`docs/DoD-report/`](docs/DoD-report/)。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 骨架与设计系统 | ✅ |
| 1 | 设置与存储层 | ✅ |
| 2 | 翻译引擎与最短闭环 | ✅ |
| 3 | DOM 采集完备化 | ✅ |
| 4 | 显示模式与译文样式 | ✅ |
| 5 | 注入式 UI | ✅ |
| 6 | 快捷键与划词交互 | ✅ |
| 7 | 设置页完整化与 BYOK | ✅ |
| 8 | 兼容补丁与多浏览器适配 | ✅ |

**商店上架推迟。** 材料（隐私政策、中英文商店文案、截图规格）已备在 [`store/`](store/) 并与代码同步维护，但 5 张实拍截图与真机走查项尚未完成 —— 详见 [阶段 8 DoDR-2](docs/DoD-report/phase-8/DoDR-2.md)。这条线不阻塞后续开发。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/phases/README.md](docs/phases/README.md) | 分阶段实施索引与依赖图 |
| [docs/phases/](docs/phases/) | 9 份阶段实施手册，含代码骨架、取舍理由、验收标准 |
| [docs/DoD-report/](docs/DoD-report/) | 各阶段 DoD 验收报告 |
| [docs/TESTING.md](docs/TESTING.md) | 自动化测试体系：分层策略、性能与内存、异常与边界、隐私与合规 |
| [store/](store/) | 上架材料（提交审核推迟） |

## 约定

- `main` 分支要求线性历史，禁止 merge commit，所有改动通过 PR 合入（squash 或 rebase）
- CSS 类、DOM `data-` 属性、storage key 一律用 `pt-` / `pt` 前缀
- 颜色与排版一律引用 [`src/styles/tokens.css`](src/styles/tokens.css) 中的设计令牌，**不得在组件内硬编码色值**

完整要求见 [阶段索引的全局要求](docs/phases/README.md#全局要求)。

## 许可

尚未确定。在选定许可证之前，本仓库保留所有权利。
