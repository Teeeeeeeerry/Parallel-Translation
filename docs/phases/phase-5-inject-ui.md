# 阶段 5 — 注入式 UI

## 目标

实现注入到宿主页面的三个 UI 组件：悬浮球、逐段翻译、状态与错误提示。全部通过 shadow DOM 隔离，保证在任何网站上外观一致且不污染宿主页面。

## 前置依赖

- 阶段 0：`tokens.css` 设计令牌
- 阶段 3：walker 已实现 `data-pt-ui="1"` 排除逻辑
- 阶段 4：`render()` / `applyMode()` 可被 UI 调用

## 交付文件清单

```
src/ui/
├── mount.ts             # shadow root 挂载通用封装
├── floating-ball.ts     # 右下角悬浮球，点击 = 全页翻译
├── paragraph-btn.ts     # 段落悬停浮出按钮，点击 = 单段翻译
└── toast.ts             # 状态与错误提示

src/styles/
└── injected.css         # 注入 UI 专属样式（注入进 shadow root）
```

## 关键代码骨架

### `src/ui/mount.ts`

```typescript
import tokens   from '@/src/styles/tokens.css?inline';
import injected from '@/src/styles/injected.css?inline';

/**
 * 创建一个与宿主页面完全隔离的挂载点。
 * 双向隔离：宿主 CSS 进不来，我们的 CSS 出不去。
 */
export function mountIsolated(id: string): ShadowRoot {
  const host = document.createElement('div');
  host.id = `pt-host-${id}`;

  // 关键标记：walker 与 observer 依此跳过整棵子树，避免翻译自己的按钮
  host.dataset.ptUi = '1';

  // 宿主页面可能有 div { position: static !important } 之类的规则，用 all: initial 兜底
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = tokens + injected;   // 设计令牌必须注入 shadow，否则变量不可见
  shadow.appendChild(style);

  document.body.appendChild(host);
  return shadow;
}

export function unmountIsolated(id: string): void {
  document.getElementById(`pt-host-${id}`)?.remove();
}
```

### `src/ui/floating-ball.ts`

```typescript
/**
 * 右下角悬浮球。点击触发全页翻译，再次点击还原。
 * 位置可拖动并持久化。
 */
export function createBall(): void {
  const shadow = mountIsolated('ball');

  const ball = document.createElement('button');
  ball.className = 'pt-ball';
  ball.setAttribute('aria-label', '翻译此页');
  shadow.appendChild(ball);

  let translating = false;
  let dragged = false;

  // 拖动与点击共用 mousedown —— 靠位移阈值区分，否则拖完会误触发翻译
  ball.addEventListener('mousedown', startDrag);
  ball.addEventListener('click', () => {
    if (dragged) { dragged = false; return; }
    translating = !translating;
    setState(translating ? 'loading' : 'idle');
    translating ? translatePage() : restorePage();
  });

  /** 状态机：idle / loading / done / error，各自对应不同视觉 */
  function setState(s: 'idle' | 'loading' | 'done' | 'error') {
    ball.dataset.state = s;
  }
}
```

### `src/ui/paragraph-btn.ts`

```typescript
/**
 * 鼠标进入可翻译段落时，在其右侧浮出一个小按钮。
 * 单个按钮实例复用，随鼠标在段落间移动，不为每段各建一个。
 */
export function createParaBtn(): void {
  const shadow = mountIsolated('para-btn');
  const btn = document.createElement('button');
  btn.className = 'pt-para-btn';
  shadow.appendChild(btn);

  let target: Element | null = null;
  let hideTimer: number | undefined;

  document.addEventListener('mouseover', e => {
    const el = (e.target as Element)?.closest?.(
      'p, li, dd, blockquote, h1, h2, h3, h4, h5, h6',
    );
    if (!el || el.closest('[data-pt-ui="1"]')) return;
    if (el.getAttribute('data-pt') === 'done') return;

    clearTimeout(hideTimer);
    target = el;
    position(btn, el);
  });

  // 延迟隐藏，给用户从段落移动到按钮的时间；否则按钮永远点不到
  document.addEventListener('mouseout', () => {
    hideTimer = self.setTimeout(() => { btn.style.display = 'none'; }, 200);
  });

  btn.addEventListener('click', () => target && translateOne(target));
}

/** 定位到段落右上角。用 getBoundingClientRect + fixed 定位，不依赖宿主布局 */
function position(btn: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  btn.style.display = 'block';
  btn.style.top  = `${r.top}px`;
  btn.style.left = `${r.right + 4}px`;
}
```

### `src/ui/toast.ts`

```typescript
/** 短暂提示。错误用 --pt-danger，其余用 --pt-forest */
export function toast(msg: string, kind: 'info' | 'error' = 'info'): void { /* ... */ }
```

### `src/styles/injected.css`

```css
/* 注入 shadow root。此处可安全使用短类名，不会与宿主冲突 */

.pt-ball {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: var(--pt-forest);
  color: var(--pt-paper);
  border: 1.5px solid var(--pt-brass);
  cursor: pointer;
  font-family: var(--pt-font-mono);
  box-shadow: 0 4px 16px rgba(31, 58, 46, .3);
}
.pt-ball[data-state="loading"] { animation: pt-spin 1s linear infinite }
.pt-ball[data-state="error"]   { border-color: var(--pt-danger) }

.pt-para-btn {
  position: fixed;
  display: none;
  padding: 3px 7px;
  font-family: var(--pt-font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  background: var(--pt-surface);
  color: var(--pt-forest);
  border: 1px solid var(--pt-forest-15);
  border-radius: var(--pt-r-sm);
  cursor: pointer;
}

@keyframes pt-spin { to { transform: rotate(360deg) } }
```

## 实现要点与取舍

**shadow DOM 隔离是必需的，不是锦上添花。** 宿主页面的 `* { box-sizing: border-box }`、`button { all: unset }`、`img { max-width: 100% }` 会直接打烂注入 UI；反过来我们的样式也会污染宿主。X/Twitter、Notion 这类站点的全局 reset 极其激进。没有 shadow 隔离，注入 UI 在不同网站上会呈现出完全不同的外观，且无法逐一修补。

**`tokens.css` 必须注入进 shadow root。** CSS 自定义属性虽然会穿透 shadow 边界继承，但那要求宿主页面的 `:root` 上定义了这些变量 —— 显然不会。所以每个 shadow root 都要自带一份令牌定义。用 `?inline` 导入拿到字符串，塞进 `<style>`。

**host 元素上要写 `all: initial`。** shadow root 内部是隔离的，但 host 元素本身仍受宿主页面 CSS 影响。宿主的 `div { position: static !important }` 会让固定定位失效。`all: initial` 重置所有继承与层叠，再单独设需要的属性。

**`z-index: 2147483647`。** 32 位有符号整数最大值。视频网站的播放器控件、聊天挂件经常用很大的 z-index，不顶到最大值悬浮球会被盖住。

**`data-pt-ui="1"` 是与阶段 3 的契约。** walker 见到该标记整棵子树 `FILTER_REJECT` 且不下沉其 shadowRoot，observer 见到则跳过。漏标记会导致扩展翻译自己按钮上的文字。**新增任何注入 UI 都必须走 `mountIsolated()`**，不要手写 `createElement` + `appendChild`，否则迟早漏标记。

**段落按钮复用单一实例。** 为每个段落各创建一个按钮，在长页面上等于插入几百个 DOM 节点，且要为每个绑定事件。复用一个实例、靠 `mouseover` 事件委托切换定位，开销恒定。

**悬停按钮需要 200ms 延迟隐藏。** 鼠标从段落移向按钮的路径上会离开段落触发 `mouseout`。立即隐藏会导致按钮永远点不到 —— 这是个看起来很小但实际让功能完全不可用的细节。

**拖动与点击要用位移阈值区分。** 悬浮球既可拖动又可点击。不做区分的话，用户拖完松手会立刻触发一次翻译。做法是在 `mousedown` 到 `mouseup` 之间累计位移，超过阈值（如 4px）就标记为拖动并吞掉随后的 `click`。

**悬浮球需要状态机而非单一外观。** 翻译一个长页面可能耗时数秒，期间用户需要知道"正在翻"而不是"我是不是没点上"。`idle / loading / done / error` 四态各自对应不同视觉，通过 `data-state` 属性切换。

## DoD 验收标准

- [ ] 悬浮球在 Wikipedia 与 X 上外观完全一致
- [ ] 悬浮球点击触发全页翻译，再次点击还原
- [ ] 翻译过程中悬浮球显示 loading 态，完成后转 done 态
- [ ] 全引擎失败时悬浮球显示 error 态并弹出提示
- [ ] 悬浮球可拖动，拖动后松手**不会**误触发翻译
- [ ] 悬浮球位置持久化，刷新页面后保持
- [ ] 鼠标移到段落上浮出按钮，能顺利移动到按钮并点击
- [ ] 段落按钮点击只翻译该段，其余段落不受影响
- [ ] 已翻译的段落不再浮出按钮
- [ ] 注入 UI 上的文字**没有被翻译**
- [ ] 宿主页面样式未被污染
- [ ] 设置中关闭悬浮球 / 段落按钮后，对应 UI 立即消失

## 验证步骤

```bash
pnpm dev
```

**跨站点外观一致性**：分别打开 `en.wikipedia.org`（保守样式）与 `x.com`（激进 reset），对比悬浮球的尺寸、圆角、配色、阴影，应完全一致。

**宿主污染自查**（在 X 上，翻译前后各执行一次并对比）：

```javascript
const el = document.querySelector('article');
const cs = getComputedStyle(el);
console.log(cs.fontFamily, cs.fontSize, cs.color, cs.boxSizing);
// 预期：翻译前后完全一致
```

**自翻译自查**：

```javascript
console.log(document.querySelectorAll('[data-pt-ui="1"] .pt-trans').length);   // 预期 0
```

隔离性验证：

```javascript
// 悬浮球的类名不应泄漏到宿主页面
console.log(document.querySelectorAll('.pt-ball').length);   // 预期 0（它在 shadow 里）
console.log(document.getElementById('pt-host-ball').shadowRoot.querySelector('.pt-ball'));  // 预期非 null
```

**拖动不误触发**：按住悬浮球拖到屏幕另一侧松手 → 页面**不应**开始翻译。刷新页面 → 悬浮球应在新位置。

**段落按钮可达性**：鼠标移到段落上 → 按钮浮出 → 沿直线移向按钮 → 按钮应仍可见并可点击。

**状态机**：DevTools Network 面板设置为 Slow 3G → 点悬浮球 → 应看到持续的 loading 态而非无反应。

**错误态**：屏蔽 `translate.googleapis.com` 与 `edge.microsoft.com` → 点悬浮球 → 应转 error 态并弹出可读提示。
