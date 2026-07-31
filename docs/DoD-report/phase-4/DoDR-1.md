# 阶段 4 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 4 — 显示模式与译文样式 |
| 验收依据 | `docs/phases/phase-4-render.md` |
| 被测提交 | `6436495` feat: 阶段 4/5/6 —— 渲染系统 + 注入式 UI + 快捷键 (v0.5.0)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 同批报告 | [阶段 5 DoDR-1](../phase-5/DoDR-1.md)、[阶段 6 DoDR-1](../phase-6/DoDR-1.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 产物 CSS 审计 + jsdom 用例 33 条 + content script 集成用例（见[阶段 5 报告](../phase-5/DoDR-1.md#5-验收方式与复现)） |
| **结论** | **未通过** — 1 项缺陷 P4-1：出厂默认样式（`default`）的黄铜金左边框在宿主页面上**完全不渲染**，因为 `presets.css` 引用的 `--pt-brass` 只定义在 shadow root 里。33 条断言 32 条通过 |

---

## 1. 结果总览

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | 对照 ↔ 仅译文切换瞬时生效，无新请求 | ✅ | B-1 ~ B-4 |
| 2 | 6 种样式逐个切换均正确呈现 | ❌ | P4-1：`default` 无边框；其余 5 种 C-1/C-3/C-4 ✅ |
| 3 | 弱化显示：默认不可见，悬停淡入 | ✅ | C-3 |
| 4 | 半透明：始终可见，透明度约 .6 | ✅ | C-4 |
| 5 | 译文字体与字号跟随宿主页面 | ✅ | C-2 |
| 6 | 还原原文后链接、按钮仍可点击 | ✅ | A-2、A-5 |
| 7 | 单段翻译只影响目标段落 | ✅ | A-7 |
| 8 | 自定义 CSS `color: red` → 只有译文变红 | ✅ | E-1、E-8（作用域限定在 `.pt-trans`） |
| 9 | 自定义 CSS `body { … }` 被拒绝并提示 | ✅ | E-2 |
| 10 | 自定义 CSS 与预设可叠加 | ✅ | E-13（注入在 `head` 末尾，晚于 presets） |
| — | `pnpm typecheck` / `pnpm build` | ✅ | 0 error / 61.88 kB |

---

## 2. 缺陷

### P4-1 出厂默认样式的左边框不渲染（高）

`src/styles/presets.css:19-22`：

```css
.pt-style-default .pt-trans {
  border-left: 2px solid var(--pt-brass);
  padding-left: 0.5em;
}
```

`--pt-brass` 定义在 `src/styles/tokens.css` 的 `:root` 中，而 tokens 目前**只被 `mount.ts` 以 `?inline` 方式注入各 shadow root**，宿主页面的 `:root` 上从来没有这个变量。产物可直接看出：

```
.output/chrome-mv3/content-scripts/content.css   → 含 var(--pt-brass)，:root 定义 0 处
.output/chrome-mv3/content-scripts/content.js    → 含 --pt-brass: #b89968（仅注入 shadow root 的字符串）
```

`var()` 引用不存在的自定义属性属于「计算值时刻无效」（invalid at computed-value time），整条 `border-left` 简写退化为 `unset`，`border-left-style` 取初始值 `none` —— 不是"边框颜色变黑"，而是**边框整个消失**。`default` 是 `DEFAULT_SETTINGS.style` 的取值，所以这是所有新用户开箱看到的样式：译文与原文之间没有任何视觉标识，只剩 `padding-left` 造成的 0.5em 缩进。

自动化断言：

```
D-1  presets.css 引用了 --pt-brass            ✅
D-2  tokens.css 在 :root 上定义 --pt-brass    ✅
D-3  产物 content.css 提供 --pt-brass 定义    ❌   ← 断链在这里
```

**建议修复**：在 content script 的宿主样式里补一份令牌定义。最小改动是让 `presets.css` 顶部 `@import` 不可行（CSS `@import` 在 content script CSS 中受限），推荐在 `entrypoints/content.ts` 里与 `presets.css` 一起引入 `tokens.css`，或直接在 `presets.css` 中就近声明本文件用到的那一个变量。前者代价是把整套令牌暴露到宿主页面的 `:root`（变量名带 `--pt-` 前缀，冲突风险可忽略），后者更克制但令牌定义会一分为二。倾向前者。

---

## 3. 通过项的证据摘录

**模式与样式切换零 DOM 操作、零请求**（DoD 1）。在已渲染译文的页面上挂 `MutationObserver`（`childList` + `subtree` + `characterData` + `attributes`）观测 `document.body`，来回切换模式 5 次、逐个应用 6 种样式：

```
B-3  mutation record 数 = 0（变更只发生在 <html> 的 class 上）
B-4  chrome.runtime.sendMessage 调用数 = 0
B-5  切换后 <html> 上恒只有一个 pt-style-* 类
```

**事件保全**（DoD 6）。`render()` 用 `while (el.firstChild) origin.appendChild(el.firstChild)` 搬移节点而非 `innerHTML` 赋值：

```
A-2  render 后 querySelector('#lk') === 原节点对象，click 监听器仍触发
A-5  unrender 后同上，且 innerHTML 与渲染前逐字符相同
```

**自定义 CSS 校验**（DoD 8、9）。5 条禁止构造逐条命中，提示文案与阶段文档一致：

| 输入 | 结果 |
|---|---|
| `color: red;` | 通过，注入 `.pt-trans { color: red; }` |
| `body { color: red }` | 拒绝：只需填写 CSS 属性，无需选择器与花括号 |
| `@import url(x)` | 拒绝：不支持 @import |
| `</style><script>…` | 拒绝：不允许 style 标签 |
| `background: url(javascript:…)` | 拒绝：不允许 javascript: 协议 |
| `width: expression(…)` | 拒绝：不允许 expression() |

注入的 `<style>` 带 `data-pt-ui="1"`（E-9），重复调用不产生第二个节点（E-10），空输入清除已有注入（E-12）。

---

## 4. 待真机自测项

以下项在代码与产物层面成立，但 jsdom 不做布局与层叠计算，需在浏览器内确认：

- 6 种样式的实际观感与"切换无闪烁"（DoD 2）
- 译文 `font-family` / `font-size` 与 `.pt-origin` 的 `getComputedStyle` 相等（阶段文档给出的 Console 自查脚本）
- dim 预设的 `:hover` 淡入在真实指针交互下的手感（DoD 3）

复现步骤见阶段文档《验证步骤》一节。
