# 阶段 3 — DOM 采集完备化

## 目标

把阶段 2 的简版采集换成完整实现：穿透 shadow DOM、覆盖 iframe、处理动态加载内容。本阶段结束后，Reddit、YouTube、X 这类现代站点都能正常翻译，无限滚动和 SPA 路由切换后新出现的内容会自动补翻。

## 前置依赖

- 阶段 2：翻译链路已打通，`collectSimple()` 可用作对照基准

## 交付文件清单

```
src/dom/
├── classify.ts      # 节点分类三集合 + 判定规则
├── walker.ts        # TreeWalker 递归穿透 shadowRoot（替换 collect.ts）
└── observer.ts      # MutationObserver 增量补翻

entrypoints/content.ts    # 追加 all_frames: true
```

## 关键代码骨架

### `src/dom/classify.ts`

```typescript
/** 直接翻译的块级元素 */
export const DIRECT_SET = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'dd', 'blockquote', 'figcaption',
]);

/** 整棵子树跳过，不再深入 */
export const SKIP_SET = new Set([
  'html', 'body', 'script', 'style', 'noscript',
  'input', 'textarea', 'select', 'button',
  'code', 'pre',
]);

/** 内联元素：自身不作为翻译单元，需向上找可翻父节点 */
export const INLINE_SET = new Set([
  'a', 'b', 'strong', 'span', 'em', 'i', 'u', 'small', 'sub', 'sup',
  'font', 'mark', 'cite', 'q', 'abbr', 'time', 'ruby', 'img', 'br', 'svg',
]);

const MAX_TEXT = 3072;
const MAX_HTML = 4096;
const MIN_TEXT = 3;

export function shouldSkip(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_SET.has(tag)) return true;
  if (el.classList.contains('notranslate')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest('[data-pt="done"]')) return true;

  // 扩展自身注入的 UI —— 绝不能翻译自己的按钮文字
  if (el.closest('[data-pt-ui="1"]')) return true;

  const text = el.textContent?.trim() ?? '';
  if (text.length < MIN_TEXT || text.length > MAX_TEXT) return true;
  if ((el as HTMLElement).outerHTML.length > MAX_HTML) return true;
  if (isMainlyNumeric(text)) return true;

  return false;
}

/** 纯数字、日期、计数（"1.2k"、"2026-07-30"）翻了没意义还浪费额度 */
function isMainlyNumeric(text: string): boolean {
  if (text.length > 30) return false;
  return /^[\d\s.,:/\-+%$€¥£kKmMbB()]+$/.test(text);
}

/**
 * 判定元素是否是一个完整的翻译单元。
 * 核心规则：若子元素中存在非空元素，说明文本还在更深层，当前节点不是叶子翻译单元。
 */
export function isTranslationUnit(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!DIRECT_SET.has(tag)) return false;

  for (const child of el.children) {
    const childTag = child.tagName.toLowerCase();
    // 内联子元素属于本段的一部分，不影响判定
    if (INLINE_SET.has(childTag)) continue;
    // 非内联且有文本 → 文本在更深层，当前节点不是翻译单元
    if (child.textContent?.trim()) return false;
  }
  return true;
}
```

### `src/dom/walker.ts`

```typescript
/**
 * 采集可翻译节点。
 * TreeWalker 不会自动进入 shadowRoot，必须显式递归。
 */
export function collect(root: Node = document.body): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  walk(root, out, seen);
  return out;
}

function walk(root: Node, out: Element[], seen: Set<Element>): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;

      // 扩展自身 UI：整棵子树拒绝，且不下沉其 shadowRoot
      if ((el as HTMLElement).dataset?.ptUi === '1') return NodeFilter.FILTER_REJECT;

      if (SKIP_SET.has(el.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;

    // 关键：遇到 shadow host 就递归下沉。TreeWalker 自己不会做这件事
    if (el.shadowRoot) walk(el.shadowRoot, out, seen);

    if (!seen.has(el) && !shouldSkip(el) && isTranslationUnit(el)) {
      seen.add(el);
      out.push(el);
    }
    node = walker.nextNode();
  }
}
```

### `src/dom/observer.ts`

```typescript
/**
 * 监听 DOM 变化，对新增节点补翻。
 * 覆盖三种场景：无限滚动、SPA 路由切换、懒加载内容。
 */
export function startObserver(onNewNodes: (els: Element[]) => void): () => void {
  let pending: Node[] = [];
  let timer: number | undefined;

  const flush = () => {
    timer = undefined;
    const batch = pending;
    pending = [];
    const found = batch.flatMap(n =>
      n.nodeType === Node.ELEMENT_NODE ? collect(n) : [],
    );
    if (found.length) onNewNodes(found);
  };

  const mo = new MutationObserver(records => {
    for (const r of records) {
      // 只看新增节点。属性变化、文本变化不触发重翻，否则会与自身渲染互相激发
      for (const n of r.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const el = n as HTMLElement;
        // 忽略自己插入的译文与自己的 UI，否则形成无限循环
        if (el.classList?.contains('pt-trans')) continue;
        if (el.dataset?.ptUi === '1') continue;
        pending.push(n);
      }
    }
    // 防抖：无限滚动会在极短时间内产生大量 mutation
    if (pending.length && timer === undefined) {
      timer = self.setTimeout(flush, 300);
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });
  return () => { mo.disconnect(); if (timer) clearTimeout(timer); };
}
```

### `entrypoints/content.ts`

```typescript
export default defineContentScript({
  matches: ['<all_urls>'],
  all_frames: true,          // 每个同源 iframe 自动获得独立 content script
  runAt: 'document_end',
  async main() { /* ... */ },
});
```

## 实现要点与取舍

**TreeWalker 不会进 shadowRoot，这是必须手写递归的原因。** `document.createTreeWalker` 只遍历 light DOM。Reddit 新版、YouTube、大量 Web Components 站点把内容放在 shadow root 里，不递归就等于这些站点完全翻不了。同类产品普遍的做法是按域名写 CSS 选择器补丁逐站适配 —— 那条路每上线一个新站点就要发一次版，不可持续。通用递归 + 域名补丁兜底（阶段 8）是更合理的两层结构。

**`all_frames: true` 比手动递归 `contentDocument` 更好。** 每个同源 iframe 自动获得独立的 content script 实例，各自管各自的 DOM。手动递归要处理 iframe 加载时序、跨源访问抛异常、iframe 内再嵌 iframe 等一堆边界情况。跨源 iframe 在 `all_frames` 下同样能注入（只要 URL 匹配），而手动递归对跨源直接抓瞎。

**`isTranslationUnit` 的核心是"文本是否还在更深层"。** 判定规则：遍历子元素，内联子元素（`<a>`、`<strong>`、`<span>`）算作本段的一部分不影响判定；出现非内联且带文本的子元素，说明这不是叶子节点，跳过让更深层处理。没有这条规则，`<div>` 套 `<p>` 会导致同一段文本被翻译两次、插入两份译文。

**MutationObserver 只监听 `childList`，绝不监听 `characterData` 或属性。** 我们自己插入译文就是 childList 变化，靠 `.pt-trans` 类名和 `data-pt-ui` 过滤掉自身操作。若监听文本变化，插入译文 → 触发 mutation → 再次采集 → 再次插入，直接死循环。

**防抖 300ms 不是随便定的。** 无限滚动一次加载能产生数百条 mutation record。不防抖会导致每条 record 都触发一次全量采集与翻译请求，瞬间打爆并发闸门。300ms 在"用户感知不到延迟"和"能把一批变更聚合成一次"之间是合适的平衡。

**`data-pt-ui="1"` 的检查要在 walker 和 observer 两处都做。** walker 里是 `FILTER_REJECT`（整棵子树拒绝，且不下沉其 shadowRoot）；observer 里是跳过新增节点。漏掉任一处，扩展会翻译自己悬浮球和按钮上的文字 —— 这个 bug 表现得非常荒诞但成因很隐蔽。

**数字内容过滤是省钱项。** 页面上大量 `1.2k`、`2026-07-30`、`$99` 这类文本翻了没有意义，但会实打实消耗翻译额度和请求配额。限定在 30 字符内做正则判断，成本可忽略。

## DoD 验收标准

- [ ] Reddit（sh.reddit.com）帖子正文与评论能翻译 → shadow DOM 穿透生效
- [ ] YouTube 视频标题、简介、评论能翻译 → 自定义元素生效
- [ ] X/Twitter 时间线能翻译，向下滚动新推文自动补翻 → observer 生效
- [ ] 含同源 iframe 的页面，iframe 内文本能翻译 → `all_frames` 生效
- [ ] Medium 站内点击链接切换文章（SPA 路由），新文章自动补翻
- [ ] 嵌套结构（`<div><p>text</p></div>`）只产生一份译文，无重复
- [ ] 悬浮球与按钮上的文字**没有被翻译**
- [ ] 纯数字文本（点赞数、日期、价格）未被翻译
- [ ] 无限滚动时并发请求数仍不超过 6

## 验证步骤

```bash
pnpm dev
```

| 站点 | 操作 | 预期 |
|---|---|---|
| `sh.reddit.com` 任一英文帖 | 翻译 | 正文与评论均出现译文 |
| `youtube.com` 任一英文视频 | 翻译 | 标题、简介、评论出现译文 |
| `x.com` 英文时间线 | 翻译后向下滚动 | 新推文自动出现译文，无需再点 |
| `medium.com` 任一英文文章 | 翻译后点站内链接跳另一篇 | 新文章自动翻译 |

**重复译文自查**（页面 Console）：

```javascript
// 每个已翻译容器应恰好有一个 .pt-trans
const dup = [...document.querySelectorAll('[data-pt="done"]')]
  .filter(el => el.querySelectorAll(':scope > .pt-trans').length !== 1);
console.log('异常容器数:', dup.length);   // 预期 0
```

**shadow 穿透自查**（在 Reddit）：

```javascript
// 统计 shadow root 内被翻译的节点数
let n = 0;
const visit = (root) => {
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) { n += el.shadowRoot.querySelectorAll('.pt-trans').length; visit(el.shadowRoot); }
  });
};
visit(document);
console.log('shadow 内译文数:', n);   // 预期 > 0
```

**自翻译自查**：

```javascript
console.log(document.querySelectorAll('[data-pt-ui="1"] .pt-trans').length);   // 预期 0
```

**死循环自查**：翻译完成后静置 10 秒，Network 面板不应有新的翻译请求持续产生。

**iframe**：找一个嵌入 YouTube 播放器或 CodePen 的英文页面，确认 iframe 内文本也被翻译。
