# 阶段 4 — 显示模式与译文样式

## 目标

实现三种显示模式（全页对照 / 全页仅译文 / 单段翻译）与 6 种译文样式预设，以及用户自定义 CSS。本阶段结束后，模式与样式切换瞬时生效且不产生任何翻译请求。

## 前置依赖

- 阶段 1：`getSettings()` 可读 `displayMode`、`style`、`customCss`
- 阶段 3：`collect()` 能采到全站节点

## 交付文件清单

```
src/dom/
└── renderer.ts        # 三模式渲染（替换阶段 2 的 inject.ts）

src/styles/
├── presets.css        # 6 种译文样式预设
└── custom.ts          # 用户自定义 CSS 校验、包作用域、注入
```

## 关键代码骨架

### `src/dom/renderer.ts`

```typescript
/**
 * 渲染译文。三种模式共用同一套 DOM 结构 ——
 * 模式差异全部由挂在 <html> 上的类名 + CSS 表达，切换时不碰 DOM。
 */
export function render(el: Element, translation: string): void {
  if (el.getAttribute('data-pt') === 'done') return;

  // 把原有子节点整体包进 .pt-origin，保留其内部结构与事件绑定
  const origin = document.createElement('span');
  origin.className = 'pt-origin';
  while (el.firstChild) origin.appendChild(el.firstChild);

  const trans = document.createElement('span');
  trans.className = 'pt-trans';
  trans.textContent = translation;

  el.appendChild(origin);
  el.appendChild(trans);
  el.setAttribute('data-pt', 'done');
}

/** 还原原文，把 .pt-origin 的子节点放回去 */
export function unrender(el: Element): void {
  const origin = el.querySelector(':scope > .pt-origin');
  const trans   = el.querySelector(':scope > .pt-trans');
  if (!origin) return;
  while (origin.firstChild) el.insertBefore(origin.firstChild, origin);
  origin.remove();
  trans?.remove();
  el.removeAttribute('data-pt');
}

/** 模式切换：只改 <html> 上的类名，零 DOM 操作、零请求 */
export function applyMode(mode: DisplayMode): void {
  document.documentElement.classList.toggle('pt-only-trans', mode === 'translation-only');
}

/** 样式切换：同上 */
export function applyStyle(style: StyleId): void {
  const root = document.documentElement;
  [...root.classList].filter(c => c.startsWith('pt-style-')).forEach(c => root.classList.remove(c));
  root.classList.add(`pt-style-${style}`);
}
```

### `src/styles/presets.css`

```css
/* ── 基础结构 ───────────────────────────────────────── */
.pt-trans {
  /* 关键：不设 font-family / font-size —— 译文必须继承宿主页面排版 */
  display: block;
}

/* ── 仅译文模式 ─────────────────────────────────────── */
.pt-only-trans .pt-origin { display: none }

/* ── 6 种样式预设 ───────────────────────────────────── */

/* 默认：黄铜金左边框做弱标识 */
.pt-style-default .pt-trans {
  border-left: 2px solid var(--pt-brass);
  padding-left: .5em;
}

/* 弱化：平时完全不可见，悬停到该段才淡入 */
.pt-style-dim .pt-trans {
  opacity: 0;
  transition: opacity .15s ease;
}
.pt-style-dim [data-pt="done"]:hover .pt-trans {
  opacity: 1;
}

/* 实线下划线 */
.pt-style-underline .pt-trans {
  text-decoration: underline solid;
  text-underline-offset: 3px;
}

/* 加粗 */
.pt-style-bold   .pt-trans { font-weight: 700 }

/* 斜体 */
.pt-style-italic .pt-trans { font-style: italic }

/* 半透明：始终可见，只压低存在感 */
.pt-style-fade   .pt-trans { opacity: .6 }
```

### `src/styles/custom.ts`

```typescript
const STYLE_ID = 'pt-custom-style';

/** 禁止出现的构造 —— 一旦允许，用户就能改宿主页面和扩展自身 UI */
const FORBIDDEN = [
  { pattern: /[{}]/,             msg: '只需填写 CSS 属性，无需选择器与花括号' },
  { pattern: /@import/i,         msg: '不支持 @import' },
  { pattern: /<\/?style/i,       msg: '不允许 style 标签' },
  { pattern: /javascript:/i,     msg: '不允许 javascript: 协议' },
  { pattern: /expression\s*\(/i, msg: '不允许 expression()' },
];

export function validateCustomCss(input: string): { ok: true } | { ok: false; msg: string } {
  for (const { pattern, msg } of FORBIDDEN) {
    if (pattern.test(input)) return { ok: false, msg };
  }
  return { ok: true };
}

/**
 * 把用户输入的声明块包进 .pt-trans 作用域后注入。
 * 用户写 `color: #555`，实际注入 `.pt-trans { color: #555 }`。
 */
export function applyCustomCss(input: string): void {
  document.getElementById(STYLE_ID)?.remove();
  const css = input.trim();
  if (!css || !validateCustomCss(css).ok) return;

  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-pt-ui', '1');   // 防止被 walker 采集
  el.textContent = `.pt-trans { ${css} }`;
  document.head.appendChild(el);
}
```

## 实现要点与取舍

**模式与样式切换必须零请求。** 用户在对照与仅译文之间来回切是高频操作。若切换要重新请求翻译，体验会非常糟且白烧额度。做法是三种模式共用一套 DOM 结构，差异全部交给挂在 `<html>` 上的类名 + CSS 表达。切换时只改一个 className，浏览器重绘即可。

**`.pt-trans` 绝不设 `font-family` 和 `font-size`。** 译文的目标是**融入宿主页面**，不是展示扩展的品牌。等宽 12px 森林绿的译文放到任何网站都会显得格格不入且难读。扩展的设计系统只用在 popup、options、悬浮球这些"扩展自己的界面"上。这是本阶段最容易做错的决策。

**原文要包进 `.pt-origin` 而不是直接留在容器里。** 仅译文模式需要隐藏原文，没有包裹元素就无法用 CSS 选中它们。包裹时用移动子节点（`while (el.firstChild)`）而非 `innerHTML` 赋值 —— 后者会销毁原有 DOM 节点，导致宿主页面绑定的事件监听器全部丢失，表现为链接点不动、按钮失效。

**"弱化显示"与"半透明"是两个不同的东西。** 弱化显示是 `opacity: 0` + 悬停淡入，对应"尽量读原文，卡住了才看译文"的语言学习场景；半透明是恒定 `opacity: .6`，译文始终可见只是不喧宾夺主。两者视觉手段相似但使用场景完全不同，不要合并。

**自定义 CSS 只收声明块，不收选择器。** 这是一个刻意的限制，换来三重好处：用户改不动宿主页面（不会打烂网站）、改不动扩展自身 UI（不会把悬浮球搞坏）、商店审核层面干净（不构成任意 CSS 注入）。实现上只需一个正则拒绝 `{}`，比写 CSS 解析器做白名单简单几个数量级，且更难绕过。

**注入的 `<style>` 要打 `data-pt-ui="1"`。** 否则阶段 3 的 walker 可能把它当作可翻译节点采集进去。

**自定义 CSS 天然优先级更高。** 它注入在 `document.head` 末尾，晚于 `presets.css`，同特异性下后者胜出。所以用户能在任一预设基础上做微调，两者叠加而非互斥 —— 这是想要的行为，不需要额外加 `!important`。

## DoD 验收标准

- [ ] 对照 ↔ 仅译文切换瞬时生效，Network 面板无新请求
- [ ] 6 种样式逐个切换均正确呈现，切换无闪烁
- [ ] 弱化显示：译文默认不可见，鼠标悬停到该段才淡入
- [ ] 半透明：译文始终可见，透明度约 .6
- [ ] 译文字体与字号跟随宿主页面，不是等宽字体
- [ ] 还原原文后，页面上的链接、按钮仍可正常点击（事件未丢失）
- [ ] 单段翻译只影响目标段落，其余段落不受影响
- [ ] 自定义 CSS 输入 `color: red` → 译文变红，宿主页面其他文字不变
- [ ] 自定义 CSS 输入 `body { color: red }` → 被拒绝并给出提示
- [ ] 自定义 CSS 与预设可叠加（如 dim 预设 + 自定义 `font-size: 1.1em`）

## 验证步骤

```bash
pnpm dev
```

**模式切换零请求**：
1. 打开 Wikipedia 英文页并翻译
2. F12 → Network 面板 → 清空
3. 在 popup 里对照 ↔ 仅译文来回切 5 次
4. 预期：Network 面板始终为空

**样式逐个验证**：在 popup 里依次切换 6 种样式，对照下表检查。

| 样式 | 预期 |
|---|---|
| 默认 | 译文左侧有黄铜金细边框 |
| 弱化 | 译文不可见；鼠标移到段落上淡入 |
| 实线下划线 | 译文带下划线，与文字有 3px 间距 |
| 加粗 | 译文明显粗于原文 |
| 斜体 | 译文倾斜 |
| 半透明 | 译文始终可见但偏淡 |

**字体继承自查**（页面 Console）：

```javascript
const t = document.querySelector('.pt-trans');
const o = t.parentElement.querySelector('.pt-origin');
const cs = getComputedStyle;
console.log(cs(t).fontFamily === cs(o).fontFamily, cs(t).fontSize === cs(o).fontSize);
// 预期 true true
```

**事件保全**：在一个含链接的段落上翻译 → 还原 → 点击该链接，应能正常跳转。

**自定义 CSS**：

| 输入 | 预期 |
|---|---|
| `color: red;` | 译文变红，宿主页面其他文字不变 |
| `body { color: red }` | 被拒绝，提示"只需填写 CSS 属性，无需选择器与花括号" |
| `@import url(x)` | 被拒绝，提示"不支持 @import" |
| `font-size: 1.5em;`（配合 dim 预设） | 译文放大且保持悬停淡入 |

作用域自查：

```javascript
console.log(document.getElementById('pt-custom-style').textContent);
// 预期形如 .pt-trans { color: red; }
```
