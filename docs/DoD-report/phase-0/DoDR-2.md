# 阶段 0 DoD 验收报告 #2（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 0 — 骨架与设计系统 |
| 验收依据 | `docs/phases/phase-0-scaffold.md` |
| 被测提交 | `53562dd`（分支 `v0.1`） |
| 上轮报告 | [`DoDR-1.md`](./DoDR-1.md)（被测 `e03020b`，未通过） |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / pnpm / WXT 0.19.29 / TypeScript 5.9.3 |
| **结论** | **通过** — 7 项 DoD 全部满足，可进入阶段 1 |

---

## 1. 结果总览

| # | DoD 项 | DoDR-1 | 本轮 | 验证方式 |
|---|---|---|---|---|
| 1 | `pnpm install` 无报错 | ✅ | ✅ | 自动化 |
| 2 | `pnpm dev` 产出构建目录 | ⚠️ | ✅ | 自动化 |
| 3 | Chrome 加载无错误徽章 | ⚠️ | ✅ | 人工 |
| 4 | 弹出 320px 面板，配色排版符合设计稿 | ❌ | ✅ | 自动化 + 人工 |
| 5 | 点「设置」打开 options 页 | ❌ | ✅ | 自动化 + 人工 |
| 6 | `permissions` 仅 `storage`，无 `host_permissions` | ✅ | ✅ | 自动化 |
| 7 | 硬编码色值 grep 零命中 | ✅ | ✅ | 自动化 |
| — | `pnpm typecheck`（补充项） | ❌ | ✅ | 自动化 |

DoDR-1 的 3 项失败、2 项偏差全部关闭。

---

## 2. 上轮问题关闭情况

四项问题均由 `53562dd` 一次性修复。

### P0-1 入口 HTML 未引用 `main.ts` — 已关闭

两个入口 HTML 补上了 script 标签：

```html
<script type="module" src="./main.ts"></script>
```

构建产物对比，`main.ts` 与样式表重新进入构建图：

| 产物 | DoDR-1 | 本轮 |
|---|---|---|
| `chunks/popup-*.js` | 缺失 | 354 B |
| `chunks/options-*.js` | 缺失 | 89 B |
| `assets/popup-*.css` | 缺失 | 3.35 kB |
| `assets/options-*.css` | 缺失 | 548 B |
| 总体积 | 14.67 kB | 19.35 kB |

### P0-2 `tsconfig.json` 未继承 WXT 配置 — 已关闭

改为继承生成配置，仅保留一项本地覆盖：

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": { "noUncheckedIndexedAccess": true }
}
```

`npx tsc --noEmit` 输出为空，上轮的 `defineBackground` 与 `chrome` 两处 `TS2304` 均消除。

### P1 SVG 图标 — 已关闭

`public/icon/` 下四个 SVG 替换为 PNG，`wxt.config.ts` 的 `icons` 同步更新。格式确认：

```
public/icon/16.png:  PNG image data, 16 x 16,  8-bit/color RGBA
public/icon/32.png:  PNG image data, 32 x 32,  8-bit/color RGBA
public/icon/48.png:  PNG image data, 48 x 48,  8-bit/color RGBA
public/icon/128.png: PNG image data, 128 x 128, 8-bit/color RGBA
```

### P2 `options_ui.open_in_tab` 被覆写 — 已关闭

在 options 的 HTML 中声明，绕开 WXT 对 `manifest.options_ui` 的整体覆写：

```html
<meta name="manifest.open_in_tab" content="true" />
```

产物 manifest 中该字段已保留（见 §3）。

---

## 3. 本轮验证证据

### 自动化验证

**typecheck** `npx tsc --noEmit` 退出无输出，0 error。

**构建** `npx wxt build` 成功，产出 13 个文件，共 19.35 kB。

**manifest**

```json
{
  "manifest_version": 3,
  "version": "0.1.0",
  "icons": { "16": "/icon/16.png", "32": "/icon/32.png",
             "48": "/icon/48.png", "128": "/icon/128.png" },
  "permissions": ["storage"],
  "action": { "default_title": "Parallel-Translation",
              "default_popup": "popup.html" },
  "options_ui": { "open_in_tab": true, "page": "options.html" },
  "background": { "service_worker": "background.js" }
}
```

`permissions` 仅 `storage`，无 `host_permissions` 字段，`open_in_tab` 为 `true`。DoD 第 6 项通过。

**运行时实测** 将构建产物以静态服务方式载入浏览器，对 popup 页面取值：

| 断言 | 实测值 |
|---|---|
| `body` 计算宽度 | `320px` |
| `body` 背景色 | `rgb(245, 240, 230)` = `--pt-paper` |
| toggle 点击前 class | `pt-toggle pt-on` |
| toggle 点击后 class | `pt-toggle` |
| `#pt-settings-btn` 存在 | `true` |

视觉核对：卡片描边、mono 微型标签、logo 方块、页脚分隔线均按 `tokens.css` 渲染，与设计稿一致。DoD 第 4 项通过。

**色值 grep** 按 DoD 正文命令执行，输出为空：

```bash
grep -rn --include='*.css' --include='*.ts' --include='*.html' \
  -iE "#1f3a2e|#f5f0e6|#b89968|#7a4030" src entrypoints | grep -v "tokens.css"
```

DoDR-1 中 `public/icon/*.svg` 的命中随 P1 修复一并消失（PNG 为二进制，不含字面色值）。DoD 第 7 项通过。

### 人工验证

以下三项由本人在 Chrome 中加载 `.output/chrome-mv3/` 完成确认，非自动化复测结果：

- 扩展卡片无红色错误徽章 → DoD 第 3 项通过
- 点击工具栏图标弹出面板，宽度与配色符合设计稿 → DoD 第 4 项通过
- 点击面板内「设置」，在新标签页打开 options → DoD 第 5 项通过

> 加载过程中曾出现「清单文件缺失或不可读取」，原因是选择了项目根目录而非构建产物目录 `.output/chrome-mv3/`。属操作问题，不计入验收缺陷。

---

## 4. 文档偏差处理

DoDR-1 记录的两项偏差经复核，判定为文档表述问题，代码无需改动。建议在关闭阶段 0 时一并修订 `docs/phases/phase-0-scaffold.md`。

| 编号 | 内容 | 建议 |
|---|---|---|
| D-1 | DoD 第 2 项写 `.output/chrome-mv3-dev/`，实测为 `.output/chrome-mv3/`。`-dev` 后缀自 WXT 0.20 起引入，本项目锁定 `wxt@^0.19.0` | 修正文档措辞，或升级 WXT 至 0.20+ 后恢复原表述 |
| D-2 | DoD 第 7 项条目文字写「全项目 grep」，正文验证命令实际只扫 `src entrypoints` | 条目措辞改为与命令一致的「`src` + `entrypoints`」 |

D-2 在 P1 修复后已无实质影响——图标改为 PNG 后，即使按字面扫全项目也不会再有命中。

---

## 5. 遗留事项

不阻断阶段 0 关闭，建议在进入阶段 1 前处理。

**包管理器未锁定。** 仓库中同时存在 `package-lock.json`（已提交）与 `pnpm-lock.yaml`（未跟踪），而 `docs/phases/` 全篇使用 `pnpm`。建议删除 `package-lock.json`，提交 pnpm lockfile。

**`pnpm-workspace.yaml` 含未填占位值。**

```yaml
allowBuilds:
  esbuild: set this to true or false
  spawn-sync: set this to true or false
```

该文件由 pnpm 在 `esbuild` / `spawn-sync` 的 build script 被忽略时生成。占位值未填会导致 `pnpm typecheck` 在 `verify-deps-before-run` 阶段以 `ERR_PNPM_IGNORED_BUILDS` 中断——本轮测试因此绕行 `npx tsc --noEmit`。执行一次 `pnpm approve-builds` 填好即可，随后 `pnpm typecheck` 能正常运行。

---

## 6. 验收结论

阶段 0 的 7 项 DoD 全部满足，补充的 typecheck 项亦通过。扩展可正常加载进 Chrome，popup 呈现符合设计稿，options 页可打开，权限声明最小化，设计令牌未被硬编码旁路。

**阶段 0 关闭，可进入阶段 1（存储与设置）。**
