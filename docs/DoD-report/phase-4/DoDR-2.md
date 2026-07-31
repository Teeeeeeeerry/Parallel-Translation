# 阶段 4 DoD 验收报告 #2（P4-1 修复后复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 4 — 显示模式与译文样式 |
| 验收依据 | `docs/phases/phase-4-render.md` |
| 被测提交 | `d65ccab` fix: 修复阶段 4/5/6 DoDR-1 的 8 项缺陷 (v0.5.1)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 上一轮 | [DoDR-1](DoDR-1.md) |
| 同批报告 | [阶段 5 DoDR-2](../phase-5/DoDR-2.md)、[阶段 6 DoDR-2](../phase-6/DoDR-2.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1 |
| 验收方式 | DoDR-1 全套 33 条回归 + 产物 CSS 复查 |
| **结论** | **通过（代码与产物层面）** — P4-1 已修复，33 / 33 条断言全部通过。真机观感项仍需用户自测（清单见 [DoDR-1 §4](DoDR-1.md#4-待真机自测项)） |

---

## 1. 本轮变更

针对阶段 4 的改动只有一处，`entrypoints/content.ts`：

```typescript
+ import '~/src/styles/tokens.css';
  import '~/src/styles/presets.css';
```

WXT 把 content script 引入的 CSS 合并进 `content-scripts/content.css`，经 manifest 的 `content_scripts[0].css` 注入宿主页面，于是 `:root` 上有了令牌定义，`presets.css` 里的 `var(--pt-brass)` 不再是悬空引用。

产物复查：

```
.output/chrome-mv3/content-scripts/content.css
  --pt-brass: #b89968 定义   1 处   （DoDR-1 时为 0）
  var(--pt-brass) 引用       1 处
产物体积 61.88 kB → 62.86 kB（+0.98 kB，即整套令牌）
```

选择把整份 `tokens.css` 注入、而不是在 `presets.css` 里就近声明单个变量：令牌保持单一真相来源，阶段 7 若给译文样式再加令牌不需要二次同步；代价是宿主页面 `:root` 多出 16 个 `--pt-` 前缀变量与一个 `@keyframes pt-pop`，前缀足以避免冲突。

---

## 2. 回归结果

| 组 | 内容 | 结果 |
|---|---|---|
| A（7 条） | render / unrender 结构、事件保全、幂等、单段隔离 | 7 / 7 ✅ |
| B（5 条） | 模式与样式切换：零 DOM 变更、零请求、类名互斥 | 5 / 5 ✅ |
| C（5 条） | presets.css 规则完备性、译文不设字体字号 | 5 / 5 ✅ |
| D（3 条） | 设计令牌在宿主页面的可用性 | 3 / 3 ✅（上轮 D-3 ❌） |
| E（13 条） | 自定义 CSS 校验、作用域、注入位置 | 13 / 13 ✅ |

DoD 十项逐条：

| # | DoD 项 | 结果 |
|---|---|---|
| 1 | 对照 ↔ 仅译文瞬时生效，无新请求 | ✅ |
| 2 | 6 种样式逐个切换均正确呈现 | ✅（P4-1 已修复） |
| 3 | 弱化显示：默认不可见，悬停淡入 | ✅ |
| 4 | 半透明：始终可见，约 .6 | ✅ |
| 5 | 译文字体字号跟随宿主页面 | ✅ |
| 6 | 还原后链接、按钮仍可点击 | ✅ |
| 7 | 单段翻译只影响目标段落 | ✅ |
| 8 | 自定义 CSS `color: red` 只作用于译文 | ✅ |
| 9 | 自定义 CSS 含选择器被拒绝并提示 | ✅ |
| 10 | 自定义 CSS 与预设可叠加 | ✅ |
| — | `pnpm typecheck` / `pnpm build` | ✅ 0 error / 62.86 kB |

无新增缺陷，无回归。
