# 阶段 6 DoD 验收报告 #2（P6-1、P6-2、X-1 修复后复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 6 — 快捷键与划词交互 |
| 验收依据 | `docs/phases/phase-6-hotkeys.md` |
| 被测提交 | `d65ccab` fix: 修复阶段 4/5/6 DoDR-1 的 8 项缺陷 (v0.5.1)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 上一轮 | [DoDR-1](DoDR-1.md) |
| 同批报告 | [阶段 4 DoDR-2](../phase-4/DoDR-2.md)、[阶段 5 DoDR-2](../phase-5/DoDR-2.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1 |
| 验收方式 | 单元用例 49 条 + 多 frame 集成用例 + 版本号一致性专项 6 条 |
| **结论** | **通过（代码与产物层面）** — 三项缺陷全部修复，49 / 49 + 6 / 6 断言通过。跨平台实机与吞按键站点仍需自测（清单见 [DoDR-1 §4](DoDR-1.md#4-待真机自测项)） |

---

## 1. 本轮变更

**P6-2 —— `entrypoints/content.ts` 的 `pt:translate-selection` 分支加 `isMainFrame` 守卫**：

```typescript
if (msg?.type === 'pt:translate-selection') {
  if (!isMainFrame) return;
  translateSelection(msg.text ?? '');
  sendResponse({ ok: true });
  return;
}
```

`background.ts` 的 `chrome.tabs.sendMessage(tab.id, …)` 不带 `frameId`，是全 frame 广播；而选区文本随消息带来、与本 frame 无关，因此只有主文档需要处理。同文件的 `pt:toggle-translate`、快捷键与注入 UI 早已有同样的判断，这次是补齐最后一处。

**P6-1 —— `src/ui/selection-drag.ts` 的 `stopSelectionDrag()` 补上真实实现**：

```typescript
let cleanup: (() => void) | null = null;

export function startSelectionDrag(onTranslate) {
  stopSelectionDrag();               // 先摘旧监听，而不是调一个空函数
  …
  cleanup = () => { /* removeEventListener ×2 */ cleanup = null; };
  return stopSelectionDrag;
}

export function stopSelectionDrag(): void { cleanup?.(); }
```

同时删掉写了从不读的 `listening` 变量。

**X-1 —— popup 页脚改为运行时读取**：

```html
<span id="pt-version"></span>
```

```typescript
const versionEl = document.getElementById('pt-version');
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
```

`manifest.version` 由 WXT 从 `package.json` 生成，两者结构上不可能分叉。这类漂移在阶段 2 [DoDR-6](../phase-2/DoDR-6.md)、阶段 3 [DoDR-4](../phase-3/DoDR-4.md) 各修过一次、本阶段第三次复发，手工同步这条路到此为止。

---

## 2. 缺陷复验

| 编号 | 断言 | DoDR-1 | 本轮 |
|---|---|---|---|
| P6-2 | 主文档 + 1 个 iframe 广播一次 `pt:translate-selection` → 翻译请求数（I-7） | ❌ 2 次 | ✅ 1 次 |
| P6-1 | 连续两次 `startSelectionDrag()` → 一次拖选手势的回调次数（E-8） | ❌ 2 次 | ✅ 1 次 |
| X-1 | popup 页脚版本号（V-2、V-3） | ❌ 停在 `v0.4.1` | ✅ 源码与产物均无字面量，运行时取 `getManifest().version` |

多 frame 用例用的是真实同源 `<iframe>` 的 `contentWindow`（`window.top !== window`），两份 content script 各自注册消息监听后由测试统一广播，与浏览器的分发路径一致。

---

## 3. 回归结果

DoD 十三项逐条：

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | Mac `⇧⌘Y` / Windows `Ctrl+Shift+Y` | ✅ | A-1 ~ A-3 |
| 2 | Mac 修饰键按 ⌃⌥⇧⌘ 顺序 | ✅ | A-4 |
| 3 | 两平台快捷键均能触发 | ✅ | C-1 |
| 4 | 输入框 / 文本域 / 富文本内不触发 | ✅ | B-8、C-4；contentEditable 见 B-8b |
| 5 | 录制能捕获并规范化 | ✅ | D-6 |
| 6 | `Mod+T` 给出占用警告 | ✅ | D-1、D-2 |
| 7 | 重复绑定给出具名警告 | ✅ | D-3、D-4 |
| 8 | 拒绝无修饰键的单键 | ✅ | B-4、D-7 |
| 9 | Mac 设置同步到 Windows 显示正确 | ✅ | A-8 |
| 10 | 吞按键的站点上仍能触发 | ✅ | C-3 |
| 11 | 右键 → 翻译所选文本 → 弹出译文 | ✅ | I-7、F-1 ~ F-7 |
| 12 | 按住修饰键拖选 → 自动翻译 | ✅ | E-1 |
| 13 | 不按修饰键正常选中不触发 | ✅ | E-2 ~ E-4 |
| — | 版本号与产物一致性 | ✅ | V-1 ~ V-6 |

平台识别（A 组 8 条）、规范化（B 组 9 条）、运行时监听（C 组 6 条）、录制与冲突检测（D 组 10 条）、右键菜单（F 组 7 条）本轮未改动，逐条回归与 DoDR-1 一致，无漂移。

---

## 4. 遗留观察（不构成 DoD 缺陷）

[DoDR-1 §2](DoDR-1.md#2-缺陷) 记录的两处与阶段文档骨架的偏差本轮未处理，留待阶段 7 设置页一并落地：

- 骨架签名是 `startSelectionDrag(modifier: 'Alt' | 'Ctrl' | 'Shift')`，实现为"Alt / Ctrl / Meta 任一"，`Settings` 中也无对应字段 —— 划词修饰键目前不可配置。
- macOS 上 `Ctrl + 拖动` 是系统右键手势，与当前的触发条件重叠。

两者都需要先在 `Settings` 里加字段，属于阶段 7（设置页）的范围。

---

## 5. 三阶段合并结论

| 阶段 | DoDR-1 | DoDR-2 |
|---|---|---|
| 阶段 4 — 显示模式与译文样式 | ❌ 1 项缺陷 | ✅ 33 / 33 |
| 阶段 5 — 注入式 UI | ❌ 4 项缺陷 | ✅ 35 / 35 + 10 / 10 |
| 阶段 6 — 快捷键与划词交互 | ❌ 3 项缺陷 | ✅ 49 / 49 + 6 / 6 |

合计 133 条断言全部通过，`pnpm typecheck` 0 error，`pnpm build` 产物 62.86 kB。真机端到端自测清单见三份 DoDR-1 各自的「待真机自测项」。
