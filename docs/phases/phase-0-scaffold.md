# 阶段 0 — 骨架与设计系统

## 目标

搭起 WXT + TypeScript 的 MV3 扩展骨架，落地设计令牌，把 popup 按设计稿做成静态页面。本阶段结束后，扩展能加载进 Chrome，点击工具栏图标弹出符合设计稿外观的面板（无实际功能）。

## 前置依赖

无。本阶段从空目录开始。

## 交付文件清单

```
Parallel-Translation/
├── package.json                    # 依赖与脚本
├── tsconfig.json                   # TS 配置
├── wxt.config.ts                   # WXT 配置 + manifest 定义
├── .gitignore                      # 忽略 .output/ .wxt/ node_modules/
├── entrypoints/
│   ├── popup/
│   │   ├── index.html              # popup 结构
│   │   └── main.ts                 # popup 入口（本阶段仅挂载静态 UI）
│   ├── options/
│   │   ├── index.html              # 设置页空壳
│   │   └── main.ts                 # 设置页入口
│   └── background.ts               # Service Worker 空实现（仅打印启动日志）
├── src/
│   └── styles/
│       ├── tokens.css              # 设计令牌（全局唯一颜色/字体来源）
│       └── popup.css               # popup 专属样式
└── public/
    └── icon/                       # 16/32/48/128 图标占位
```

## 关键代码骨架

### `wxt.config.ts`

```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Parallel-Translation',
    description: '对照式网页翻译扩展',
    // 阶段 0 只声明确定需要的权限。storage 阶段 1 用，contextMenus 阶段 6 用。
    // 不预先声明 host_permissions —— 目标翻译端点 CORS 全开，不需要。
    permissions: ['storage'],
    action: { default_title: 'Parallel-Translation' },
    options_ui: { open_in_tab: true },
  },
});
```

### `src/styles/tokens.css`

全局唯一的颜色与排版来源。**任何组件不得硬编码色值**，一律引用变量。

```css
:root {
  /* 主色板 */
  --pt-paper:   #f5f0e6;   /* 底色，纸感米白 */
  --pt-forest:  #1f3a2e;   /* 主色，森林绿 */
  --pt-brass:   #b89968;   /* 强调色，黄铜金 */
  --pt-surface: #ffffff;   /* 浅色卡片 */
  --pt-danger:  #7a4030;   /* 错误态，锈红 */

  /* forest 透明度阶 —— 用途固定，不要随意新增 */
  --pt-forest-08: rgba(31, 58, 46, .08);   /* 分隔线 */
  --pt-forest-09: rgba(31, 58, 46, .09);   /* 卡片描边 */
  --pt-forest-15: rgba(31, 58, 46, .15);   /* 次级按钮描边 */
  --pt-forest-22: rgba(31, 58, 46, .22);   /* 输入框描边 */
  --pt-forest-40: rgba(31, 58, 46, .40);   /* 页脚文字 */
  --pt-forest-55: rgba(31, 58, 46, .55);   /* 次级文字 */

  /* 字体 */
  --pt-font-mono: 'JetBrains Mono', monospace;   /* 标签、数字、标题 */
  --pt-font-ui:   system-ui, sans-serif;         /* 正文、长句描述 */

  /* 圆角 */
  --pt-r-sm: 6px;
  --pt-r-md: 9px;
  --pt-r-lg: 13px;
}

@keyframes pt-pop {
  from { transform: scale(.8); opacity: 0 }
  to   { transform: scale(1);  opacity: 1 }
}
```

### 排版规则

写任何 UI 前先对照这张表，不要临时决定字号：

| 用途 | 规格 |
|---|---|
| 微型标签 | `7-8px` / `700` / `letter-spacing: .18–.22em` / `uppercase` / mono |
| 正文、描述 | `10-11px` / `--pt-font-ui` |
| 数字、标题 | `14-24px` / mono / `letter-spacing: -.02em` |
| 弹窗动画 | `pt-pop .2s cubic-bezier(.34, 1.56, .64, 1)` |
| popup 宽度 | 固定 `320px` |

### `entrypoints/popup/index.html` 结构骨架

```html
<div class="pt-popup">
  <header class="pt-hdr">
    <div class="pt-logo">P</div>
    <div>
      <div class="pt-hdr-name">Parallel-Translation</div>
      <div class="pt-hdr-sub">Bilingual Reader</div>
    </div>
  </header>

  <main class="pt-content">
    <!-- 状态卡：开/关 -->
    <!-- 引擎选择（阶段 1 接真实数据） -->
    <!-- 语言对（阶段 1 接真实数据） -->
    <!-- 显示模式（阶段 4 生效） -->
  </main>

  <footer class="pt-footer">
    <span>v0.1.0</span>
    <button class="pt-settings-btn">设置</button>
  </footer>
</div>
```

## 实现要点与取舍

**为什么用 WXT 而不是 CRXJS 或裸 JS。** WXT 是完整的扩展框架而非单纯打包器：内置多浏览器目标（Chrome/Firefox/Safari 一次写完）、文件路由式入口约定、i18n、storage 封装、`createShadowRootUi()`（阶段 5 会重度依赖）。裸 JS 在多入口 + 国际化 + 注入 UI 隔离这三件事上会迅速失控。

**权限按需增量声明，不要一次性写全。** 每多一项权限，商店审核就多一项要解释的内容。阶段 0 只需要 `storage`；`contextMenus` 到阶段 6 再加。**不声明 `host_permissions`** —— 目标翻译端点 CORS 全开，background service worker 直接 fetch 即可，多声明反而增加审核摩擦。

**设计令牌集中在 `tokens.css`，禁止组件内硬编码色值。** 阶段 5 的注入式 UI 要把这套令牌塞进 shadow root，届时只需引一个文件。散落各处的色值会让那一步变成考古。

**popup 固定 320px。** 扩展 popup 没有响应式需求，宽度浮动只会让布局在不同缩放下抖动。

**图标先放占位。** 正式图标属于上架材料，在阶段 8 处理。现在卡在图标设计上是纯粹的时间浪费。

## DoD 验收标准

- [x] `pnpm install` 无报错
- [x] `pnpm dev` 成功产出 `.output/chrome-mv3/`（WXT 0.20+ 才带 `-dev` 后缀，本项目锁 `wxt@^0.19.0`）
- [x] Chrome `chrome://extensions/` 能加载该目录，无错误徽章
- [x] 点击工具栏图标弹出 320px 宽的面板，配色与排版符合设计稿
- [x] 点击"设置"按钮打开 options 页（空白页即可，能打开就行）
- [x] `manifest.json` 中 `permissions` 仅含 `storage`，**无 `host_permissions`**
- [x] 在 `src` + `entrypoints` 下 grep 色值 `#1f3a2e` / `#f5f0e6` / `#b89968`，除 `tokens.css` 外零命中

> **验收记录：** 全部通过，阶段已关闭。详见 [`docs/DoD-report/phase-0/DoDR-2.md`](../DoD-report/phase-0/DoDR-2.md)（被测 `53562dd`，2026-07-30）。
> 首轮验收 [`DoDR-1.md`](../DoD-report/phase-0/DoDR-1.md) 未通过，问题与修复过程一并记录在两份报告中。

## 验证步骤

```bash
pnpm install
pnpm dev
```

1. 打开 `chrome://extensions/`，开启右上角“开发者模式”
2. 点“加载已解压的扩展程序”，选择 `.output/chrome-mv3/`（注意选构建产物目录，不是项目根目录；`.output` 是隐藏目录，在选择框内按 `Cmd+Shift+.` 显示）
3. 确认扩展卡片无红色错误提示
4. 点击工具栏中的扩展图标 → 应弹出设计稿外观的面板
5. 点面板内“设置”→ 应在新标签页打开 options
6. 回到 `chrome://extensions/`，点“Service Worker”链接 → DevTools Console 应看到 background 的启动日志

硬编码色值自查：

```bash
grep -rn --include=*.css --include=*.ts --include=*.html -iE "#1f3a2e|#f5f0e6|#b89968|#7a4030" src entrypoints | grep -v "tokens.css"
```

预期输出为空。
