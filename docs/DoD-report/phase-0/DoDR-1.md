# 阶段 0 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 0 — 骨架与设计系统 |
| 验收依据 | `docs/phases/phase-0-scaffold.md` |
| 被测提交 | `e03020b`（分支 `v0.1`） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / pnpm / WXT 0.19.29 / TypeScript 5.9.3 |
| **结论** | **未通过** — 2 项 P0 阻断 |

---

## 1. 结果总览

| # | DoD 项 | 结果 |
|---|---|---|
| 1 | `pnpm install` 无报错 | ✅ 通过 |
| 2 | `pnpm dev` 产出 `.output/chrome-mv3-dev/` | ⚠️ 偏差 |
| 3 | Chrome 加载无错误徽章 | ⚠️ 高风险，待人工确认 |
| 4 | 弹出 320px 面板，配色排版符合设计稿 | ❌ 失败 |
| 5 | 点「设置」打开 options 页 | ❌ 失败 |
| 6 | `permissions` 仅 `storage`，无 `host_permissions` | ✅ 通过 |
| 7 | 硬编码色值 grep 零命中 | ✅ 通过 |
| — | `pnpm typecheck`（DoD 未列，补测） | ❌ 失败 |

通过 3 项，失败 3 项，偏差 2 项。

---

## 2. 阻断问题

### P0-1 入口 HTML 未引用 `main.ts`，popup 全部样式与交互丢失

**影响** DoD 第 4、5 项

`entrypoints/popup/index.html` 与 `entrypoints/options/index.html` 的 `<head>` 中缺少 script 标签。WXT 的 HTML 入口遵循 Vite 的 HTML entry 约定，没有 script 引用，`main.ts` 不会进入构建图。

构建产物证据：

```
├─ .output/chrome-mv3/popup.html    1.8 kB
├─ .output/chrome-mv3/background.js 10.25 kB
└─（无 popup.js、无 options.js、无任何 .css）
```

`popup.css` 与 `tokens.css` 未被打包，`popup/main.ts:11-18` 中的 toggle 切换与 `chrome.runtime.openOptionsPage()` 均未注册。浏览器实测渲染结果为无样式的裸文本流，宽度非 320px，「设置」按钮点击无响应。

**修复** 两个 HTML 的 `<head>` 内各加一行：

```html
<script type="module" src="./main.ts"></script>
```

---

### P0-2 `tsconfig.json` 未继承 `.wxt/tsconfig.json`

**影响** `pnpm typecheck`

```
entrypoints/background.ts(4,16): error TS2304: Cannot find name 'defineBackground'.
entrypoints/popup/main.ts(17,5):  error TS2304: Cannot find name 'chrome'.
```

`tsconfig.json` 为独立手写配置，未 `extends` WXT 生成的那份，因此拿不到自动导入声明、`chrome` 类型与 `~` 路径别名。

**修复**

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": { "noUncheckedIndexedAccess": true }
}
```

---

## 3. 次要问题

### P1 图标为 SVG，Chrome MV3 不支持

**影响** DoD 第 3 项

`manifest.icons` 指向 `public/icon/` 下的四个 `.svg`。Chrome 扩展图标解码器仅支持位图格式（PNG / BMP / ICO / GIF / WEBP），SVG 会触发 `Could not load icon ... specified in 'icons'`，即 DoD 第 3 项所要排查的错误徽章。

本次未在真实 Chrome 中加载验证，**需人工确认**。修复方式为改用 PNG。

### P2 `options_ui.open_in_tab` 被 WXT 静默丢弃

**影响** DoD 第 5 项 / 验证步骤 5

`wxt.config.ts:9` 声明了 `options_ui: { open_in_tab: true }`，产物 manifest 中却只有：

```json
"options_ui": { "page": "options.html" }
```

原因见 `wxt/dist/core/utils/manifest.mjs:227` —— WXT 检测到 options 入口后会整体覆写 `manifest.options_ui`，取值来自入口自身的 `openInTab` 选项（默认 `false`），config 中手写的字段不参与合并。即使 P0-1 修复，options 仍会以 `chrome://extensions` 内嵌弹窗形式打开，而非验证步骤要求的新标签页。

**修复** 在 options 的 HTML 中声明：

```html
<meta name="manifest.open_in_tab" content="true" />
```

---

## 4. 文档偏差

以下两项判定为文档问题，代码无需改动。

### D-1 输出目录名

DoD 第 2 项写 `.output/chrome-mv3-dev/`，实测 `pnpm dev` 产出 `.output/chrome-mv3/`。`-dev` 后缀自 WXT 0.20 起引入，而 `package.json` 锁定 `wxt@^0.19.0`。

**处理** 二选一：修正文档措辞，或升级 WXT 至 0.20+。

### D-2 色值 grep 范围

DoD 第 7 项条目文字写「全项目 grep」，但正文给出的验证命令只扫 `src entrypoints`。按命令执行结果为空，判定通过；若按字面扫全项目，`public/icon/*.svg` 四个文件会命中 `#1f3a2e` 与 `#f5f0e6`。

SVG 图标无法引用 `tokens.css` 中的 CSS 变量，属合理豁免。

**处理** 将 DoD 条目措辞改为与验证命令一致的「`src` + `entrypoints`」。

---

## 5. 通过项证据

**DoD-1** `pnpm install` 退出码 0。仅有两条非阻断提示：`tar@6.2.1` / `uuid@8.3.2` 已废弃；`esbuild` / `spawn-sync` 的 build script 被 pnpm 默认忽略。

后者会导致 `pnpm typecheck` 在 `verify-deps-before-run` 阶段以 `ERR_PNPM_IGNORED_BUILDS` 中断，本次测试绕行 `npx tsc --noEmit` 取得结果。执行一次 `pnpm approve-builds` 可清除。

**DoD-6** production 构建产物 manifest：

```json
"permissions": ["storage"]
```

无 `host_permissions` 字段。dev 构建会额外注入 `tabs` / `scripting` / `http://localhost/*` 用于热重载，属 WXT 正常行为，不计入验收。

**DoD-7** 按 DoD 正文命令执行，输出为空：

```bash
grep -rn --include='*.css' --include='*.ts' --include='*.html' \
  -iE "#1f3a2e|#f5f0e6|#b89968|#7a4030" src entrypoints | grep -v "tokens.css"
```

---

## 6. 复测清单

修复后按顺序重跑：

```bash
pnpm approve-builds
pnpm typecheck          # 期望 0 error
pnpm build              # 期望产出 popup.js、options.js、*.css
```

随后人工验证 DoD 第 3、4、5 项：加载 `.output/` 到 `chrome://extensions/`，确认无错误徽章、popup 宽 320px 且配色符合设计稿、「设置」在新标签页打开 options。
