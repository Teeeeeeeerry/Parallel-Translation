# 阶段 5 DoD 验收报告 #2（P5-1 ~ P5-4 修复后复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 5 — 注入式 UI |
| 验收依据 | `docs/phases/phase-5-inject-ui.md` |
| 被测提交 | `d65ccab` fix: 修复阶段 4/5/6 DoDR-1 的 8 项缺陷 (v0.5.1)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 上一轮 | [DoDR-1](DoDR-1.md) |
| 同批报告 | [阶段 4 DoDR-2](../phase-4/DoDR-2.md)、[阶段 6 DoDR-2](../phase-6/DoDR-2.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1 |
| 验收方式 | 单元用例 35 条（含按新契约改写的悬浮球组）+ content script 集成用例 10 条 |
| **结论** | **通过（代码与产物层面）** — 四项缺陷全部修复，35 / 35 + 10 / 10 断言通过。跨站外观等真机项仍需自测（清单见 [DoDR-1 §4](DoDR-1.md#4-待真机自测项)） |

---

## 1. 本轮变更

核心是把**翻译态的所有权**从悬浮球收回到 content script。

**`entrypoints/content.ts`** 新增统一入口 `togglePage()`，悬浮球、快捷键、popup 三条路径全部改走它：

```typescript
async function togglePage(): Promise<string> {
  if (translated) { doRestore(); setBallState('idle'); return 'restored'; }

  setBallState('loading');
  const status = await doTranslate();          // 异常分支略

  if (status === 'translated') {
    translated = true;
    if (!stopObserving) stopObserving = startObserver(/* 增量补翻 */);
  }
  setBallState(status === 'translated' ? 'done' : status === 'error' ? 'error' : 'idle');
  return status;
}
```

一处改动同时解掉三个缺陷：observer 不再只挂在 popup 那条路径上（P5-2），`translated` 全局只有一份（P5-3），`doTranslate()` 返回的状态枚举按枚举分派而不是二值判断（P5-4）。

**`src/ui/floating-ball.ts`** 降级为纯视图：

| 变更 | 说明 |
|---|---|
| `BallCallbacks` 由 `{ onTranslate, onRestore }` 改为 `{ onToggle }` | 球不再判断"该翻还是该还原" |
| 点击处理去掉 async 与状态推导 | 只做 `dragged` / `loading` 两个守卫后转发 |
| `setBallState()` 成为唯一状态入口 | 四态字形提到 `GLYPH` 表，error 态在此处自动 3 秒回落 |
| 清理函数摘除 `document` 上的 mousemove / mouseup | 解 P5-1 |
| `createBall()` 末尾调 `setBallState(currentState)` | 设置里关掉再打开时，新球接续既有状态而非重置 |

---

## 2. 缺陷复验

| 编号 | 断言 | DoDR-1 | 本轮 |
|---|---|---|---|
| P5-4 | 引擎全失败 → 球进 error 态且弹提示（I-9） | ❌ 停在 idle | ✅ `data-state="error"` + `data-kind="error"` toast |
| P5-2 | 悬浮球翻译后新增节点被补翻（I-5） | ❌ 无 observer | ✅ 450ms 内新 `<p>` 出现 `.pt-trans` |
| P5-3 | 悬浮球翻译后按 ⇧⌘Y 走还原（I-6） | ❌ 重复发请求 | ✅ 请求数 0，译文清空 |
| P5-1 | 卸载后再做完整拖动手势不再写 storage（B-12） | ❌ 监听器残留 | ✅ 值不变，且源码有对应 removeEventListener |

P5-4 的验证方式是把 background 应答固定为 `{ ok: false, error: '所有引擎均失败' }` 后点球，同时检查 toast 与 `data-state`；P5-2 是点球翻译后 `appendChild` 一个新段落，等待超过 observer 的 300ms 防抖再断言。

---

## 3. 回归结果

DoD 十二项逐条：

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | 悬浮球跨站外观一致 | ⚠️ | 代码层 ✅（A-1 ~ A-4、E-3、E-4）；真机对比待自测 |
| 2 | 点击翻译，再次点击还原 | ✅ | I-3、I-4、I-5、I-6 |
| 3 | loading → done | ✅ | I-3、B-6 |
| 4 | 全引擎失败 → error 态并弹提示 | ✅ | I-9 |
| 5 | 可拖动，拖后不误触发 | ✅ | B-9、B-11 |
| 6 | 位置持久化 | ✅ | B-10 + 启动回读 |
| 7 | 段落按钮可达 | ✅ | C-3、C-5、C-6 |
| 8 | 段落按钮只翻译该段 | ✅ | C-4 |
| 9 | 已翻译段落不再浮出按钮 | ✅ | C-7 |
| 10 | 注入 UI 文字未被翻译 | ✅ | E-1、E-2 |
| 11 | 宿主样式未被污染 | ✅ | E-3、E-4 |
| 12 | 设置关闭后 UI 立即消失 | ✅ | I-10 |

按新契约改写的悬浮球组（B-1 ~ B-12）全部通过，其中三条是本轮新增的行为断言：

```
B-5   loading 期间连点两次 → onToggle 调用 0 次（重复点击被吞）
B-6   四态 data-state 与字形一一对应，无重复字形
B-7   setBallState('error') 后 3.1 秒自动回落 idle
```

段落按钮组（C-1 ~ C-9）、toast 组（D-1 ~ D-4）、隔离组（A、E）本轮未改动，逐条回归与 DoDR-1 一致，无漂移。

---

## 4. 仍需真机自测

沿用 [DoDR-1 §4](DoDR-1.md#4-待真机自测项)：Wikipedia / X 跨站外观对比、宿主污染自查脚本、Slow 3G 下的 loading 观感、刷新后悬浮球位置回读。这些依赖真实布局与层叠，jsdom 覆盖不到。
