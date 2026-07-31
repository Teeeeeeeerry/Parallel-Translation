# 阶段 5 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 5 — 注入式 UI |
| 验收依据 | `docs/phases/phase-5-inject-ui.md` |
| 被测提交 | `6436495` feat: 阶段 4/5/6 —— 渲染系统 + 注入式 UI + 快捷键 (v0.5.0)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 同批报告 | [阶段 4 DoDR-1](../phase-4/DoDR-1.md)、[阶段 6 DoDR-1](../phase-6/DoDR-1.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1（shadow DOM、事件重定向、MutationObserver 均为真实实现） |
| 验收方式 | jsdom 用例 35 条 + content script 集成用例 10 条 + 源码/产物审计 |
| **结论** | **未通过** — 4 项缺陷。其中 P5-4（全引擎失败时悬浮球不进 error 态）直接对应 DoD 第 4 项，P5-2（悬浮球翻译不启动增量补翻）让阶段 3 的 observer 在最常用的入口上失效。35 条单元断言 34 条通过，10 条集成断言 6 条通过 |

---

## 1. 结果总览

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | 悬浮球在 Wikipedia 与 X 上外观完全一致 | ⚠️ | 代码层成立（A-1 ~ A-4）；真机跨站对比待自测 |
| 2 | 点击触发全页翻译，再次点击还原 | ⚠️ | B-4、B-5 ✅；但翻译后不启动 observer（P5-2）、与其他入口状态不同步（P5-3） |
| 3 | 翻译中 loading 态，完成后 done 态 | ✅ | B-6、I-3 |
| 4 | 全引擎失败时显示 error 态并弹出提示 | ❌ | **P5-4** —— 提示弹出 ✅，但球停在 idle |
| 5 | 可拖动，拖后松手不误触发翻译 | ✅ | B-9、B-11 |
| 6 | 位置持久化，刷新后保持 | ✅ | B-10（写入 `storage.local`）+ `floating-ball.ts:31-46`（启动时回读） |
| 7 | 鼠标移到段落浮出按钮，能移过去点到 | ✅ | C-3、C-5、C-6 |
| 8 | 段落按钮只翻译该段 | ✅ | C-4 |
| 9 | 已翻译的段落不再浮出按钮 | ✅ | C-7 |
| 10 | 注入 UI 上的文字未被翻译 | ✅ | E-1、E-2 |
| 11 | 宿主页面样式未被污染 | ✅ | E-3、E-4 |
| 12 | 设置中关闭悬浮球 / 段落按钮后立即消失 | ✅ | I-10 |
| — | 附带缺陷 | ❌ | **P5-1** 卸载后 document 级监听器泄漏 |

---

## 2. 缺陷

### P5-4 全引擎失败时悬浮球停在 idle，不进 error 态（高，DoD 4）

`src/ui/floating-ball.ts:88-102` 只在 `onTranslate` **抛异常**时转 error：

```typescript
try {
  const status = willTranslate ? await callbacks.onTranslate() : (callbacks.onRestore(), 'restored');
  setState(status === 'translated' ? 'done' : 'idle');
} catch {
  setState('error');
}
```

而 `entrypoints/content.ts:118-125` 的 `doTranslate()` 在引擎全失败时**不抛异常，返回字符串 `'error'`**：

```typescript
if (!resp?.ok) {
  console.error('[PT] 翻译失败:', resp?.error ?? '未知错误');
  if (isMainFrame) toast(resp?.error ?? '所有引擎均失败', 'error');
  return 'error';
}
```

`'error' !== 'translated'` → 走三元的 else 分支 → `setState('idle')`。集成实测（把 background 的应答固定为 `{ ok: false }`）：

```
I-9   toast(data-kind="error") 已弹出   ✅
      ball.dataset.state                idle   ❌（期望 error）
```

结果是失败时球看起来像"没点上"，恰恰是阶段文档中"悬浮球需要状态机而非单一外观"要解决的那个问题。同理 `'disabled'`、`'no-elements'` 也被一律归为 idle，用户看不出区别。

**建议修复**：`doTranslate()` 的返回值已经是一个状态枚举，让 `setState` 按枚举分派即可 —— `translated → done`、`error → error`、其余 → `idle`；error 态保留现有 3 秒自动回落。

### P5-2 悬浮球触发的翻译不启动增量补翻（高）

`stopObserving = startObserver(...)` 只写在 `entrypoints/content.ts:200-206` 的 `pt:toggle-translate` 消息分支里。悬浮球点击走的是 `callbacks.onTranslate → doTranslate()`，绕开了这段代码，因此**从悬浮球翻译的页面没有任何 MutationObserver 在跑**：

```
I-5  悬浮球点击 → 2 段被翻译 ✅
     随后 appendChild 一个新 <p> → 450ms 后仍无 .pt-trans  ❌
```

同一页面若改从 popup 的「翻译此页」进入，新增段落会被补翻（I-3 通过）。也就是说无限滚动、SPA 路由这些阶段 3 花力气覆盖的场景，在最顺手的入口上失效。段落按钮的 `translateOne()` 同理不启动 observer，但那是单段操作，符合预期。

### P5-3 悬浮球与 popup / 快捷键的翻译状态不同步（中）

`translated` 是 `content.ts` 的模块级标志，只有 `pt:toggle-translate` 分支会写它；悬浮球自己维护 `floating-ball.ts` 里的 `currentState`。两者各记各的：

```
I-6  悬浮球点击翻译（页面已有 2 条译文）
     → 按 ⇧⌘Y（toggle-translate，读的是 translated === false）
     → 期望：还原；实际：再发一次整页翻译请求        ❌
```

用户视角是"按快捷键没反应"，实际白烧一次额度。反向亦然：popup 翻译后点悬浮球，球从 idle 走 translate 分支，同样重复请求。

**建议修复**：把翻译态收敛到 `content.ts` 的单一变量，悬浮球只作为它的视图（通过已导出的 `setBallState()` 反向推送），三个入口共用同一个 toggle 函数。

### P5-1 悬浮球卸载后 document 级监听器泄漏（中）

`floating-ball.ts:60-86` 在 `document` 上挂了 `mousemove` 与 `mouseup`，而返回的清理函数只做 `unmountIsolated('ball')`：

```typescript
return () => {
  unmountIsolated('ball');
  // mousemove/mouseup listener 清理由 mount 统一处理
};
```

注释所说的"由 mount 统一处理"并不存在 —— `mount.ts` 只管 host 元素的增删。于是每次在设置里关掉再打开悬浮球，就多留一对监听器和一个被闭包持有的已卸载 `<button>`；`I-10` 场景反复切换会线性增长。当前不会引发可见的错误行为（`dragging` 恒为 false），但属于确定的内存泄漏，且一旦以后有第二个球实例就会出现重复写 `storage.local`。

断言 B-12 以源码断言形式兜住（`removeEventListener('mousemove' | 'mouseup'` 是否存在）。

---

## 3. 通过项的证据摘录

**shadow 隔离**（DoD 1、11）：

```
A-2  host 带 data-pt-ui="1"（与阶段 3 walker 的契约）
A-3  host 内联 all: initial / position: fixed / z-index: 2147483647
A-4  tokens.css 与 injected.css 都进了 shadow root（--pt-brass 与 .pt-ball 同时可见）
A-6  src/ui/ 下 document.body.appendChild 仅出现 1 处（mount.ts 内），无绕过 mountIsolated 的注入
E-3  injected.css 全部选择器均为 .pt- 前缀类，无裸标签选择器
E-4  注入 UI 不向宿主 document.head 追加任何 <style>
B-1  document.querySelectorAll('.pt-ball').length === 0（类名不泄漏）
```

**自翻译防护**（DoD 10）。在 shadow root 内放入 `<button>翻译此页</button>` 与 `<p>Translate this page</p>` 后调用 `collect()`：

```
E-1  采集结果长度 1，且唯一命中是宿主页面那段 "Hello world here"
E-2  [data-pt-ui="1"] .pt-trans 计数 0
```

**段落按钮可达性**（DoD 7）。这是阶段文档特意点名"看起来很小但让功能完全不可用"的细节：

```
C-5  段落 mouseout 后 60ms 仍可见，310ms 后隐藏（200ms 延迟生效）
C-6  mouseout 后立刻 mouseover 到按钮 → 300ms 后仍可见且可点击
C-2  两段之间来回移动，shadow root 内始终只有 1 个按钮实例
C-8  在扩展自身 UI 内的 <p> 上 hover 不浮出按钮
```

**拖动与点击的区分**（DoD 5）。位移阈值 3px：

```
B-9   mousedown(10,10) → mousemove(200,300) → mouseup → click  ⇒ 翻译调用 0 次
B-11  紧接着一次完整的 mousedown→mouseup→click             ⇒ 翻译调用 1 次
B-10  拖动结束后 storage.local['pt-ball-pos'] 已写入
```

---

## 4. 待真机自测项

- 悬浮球在 `en.wikipedia.org` 与 `x.com` 上的尺寸/圆角/配色/阴影逐项对比（DoD 1）
- X 上翻译前后 `article` 的 `fontFamily / fontSize / color / boxSizing` 对比（DoD 11 的宿主污染自查脚本）
- Slow 3G 下点球观察 loading 态的持续时间（DoD 3）
- 刷新页面后悬浮球是否回到拖动后的位置（DoD 6 的持久化回读路径）

---

## 5. 验收方式与复现

自动化用例基于 jsdom 29 直接加载被测源码，与阶段 3 各轮报告同一路数。三点环境说明：

1. **`getBoundingClientRect`**：jsdom 不做布局，原生实现恒返回全 0 矩形，会被 `classify.shouldSkip()` 的"不可见元素"判据整体滤掉。测试环境将其替换为「`display:none` 时返回 0 矩形，否则返回 300×20」，使可见性判据只对显式隐藏生效。
2. **`isContentEditable`**：jsdom 未实现该属性，相关断言退化为源码断言（见[阶段 6 报告](../phase-6/DoDR-1.md) B-8b）。
3. **集成用例**：把 `entrypoints/content.ts` 打成 CJS 后在 jsdom 窗口内执行 `main()`，`defineContentScript` 打桩为恒等函数，`chrome.*` 打桩为内存实现。子 frame 场景用真实同源 `<iframe>` 的 `contentWindow`（其 `window.top !== window`），因此 `isMainFrame` 判定走的是与浏览器一致的路径。

用例脚本未纳入版本库 —— 按 `docs/TESTING.md` 的规划，自动化测试体系（vitest + Playwright）在功能完成后统一落地，本轮为一次性验收夹具。
