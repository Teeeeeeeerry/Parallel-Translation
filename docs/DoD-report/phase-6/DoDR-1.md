# 阶段 6 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 6 — 快捷键与划词交互 |
| 验收依据 | `docs/phases/phase-6-hotkeys.md` |
| 被测提交 | `6436495` feat: 阶段 4/5/6 —— 渲染系统 + 注入式 UI + 快捷键 (v0.5.0)（分支 `v0.5-render-inject-ui-hotkeys`） |
| 同批报告 | [阶段 4 DoDR-1](../phase-4/DoDR-1.md)、[阶段 5 DoDR-1](../phase-5/DoDR-1.md) |
| 验收日期 | 2026-07-31 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / jsdom 29.1.1 |
| 验收方式 | jsdom 用例 49 条 + content script 多 frame 集成用例 + 版本号一致性专项 6 条 |
| **结论** | **未通过** — 1 项 DoD 缺陷 P6-2（划词右键菜单在多 frame 页面上重复翻译 N 次），1 项附带缺陷 P6-1，另有跨阶段的版本号漂移 X-1。快捷键子系统本身（平台识别、规范化、监听、录制、冲突检测）49 条断言 48 条通过 |

---

## 1. 结果总览

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | Mac 显示 `⇧⌘Y`，Windows 显示 `Ctrl+Shift+Y` | ✅ | A-1 ~ A-3 |
| 2 | Mac 修饰键按 ⌃⌥⇧⌘ 顺序 | ✅ | A-4 |
| 3 | 两平台快捷键均能实际触发 | ✅ | C-1（4 个默认动作逐个触发） |
| 4 | 焦点在输入框/文本域/富文本内不触发 | ✅ | B-8、C-4；contentEditable 见 B-8b（jsdom 限制） |
| 5 | 录制能捕获组合并正确规范化 | ✅ | D-6 |
| 6 | 录到 `Mod+T` 给出"被浏览器占用"警告 | ✅ | D-1、D-2 |
| 7 | 录到已占用组合给出重复警告 | ✅ | D-3、D-4 |
| 8 | 录制拒绝无修饰键的单键 | ✅ | B-4、D-7 |
| 9 | Mac 设置的快捷键同步到 Windows 后显示对应按键 | ✅ | A-8（存储值不含平台符号） |
| 10 | 页面自身吞按键的站点上仍能触发 | ✅ | C-3（捕获阶段监听） |
| 11 | 选中文本右键 → 翻译所选文本 → 弹出译文 | ❌ | **P6-2**：多 frame 页面上重复请求 N 次 |
| 12 | 按住修饰键拖选，松开后自动翻译 | ✅ | E-1 |
| 13 | 不按修饰键正常选中不触发 | ✅ | E-2 ~ E-4 |
| — | 附带缺陷 | ❌ | **P6-1** `stopSelectionDrag()` 空实现 |
| — | 版本号一致性 | ❌ | **X-1** popup 页脚停在 `v0.4.1` |

---

## 2. 缺陷

### P6-2 划词右键菜单在多 frame 页面上重复翻译 N 次（中，DoD 11）

`entrypoints/background.ts:29-36` 用 `chrome.tabs.sendMessage(tab.id, …)` 且不带 `frameId`，这是**广播到该标签页的全部 frame**；而 `entrypoints/content.ts:243-247` 处理 `pt:translate-selection` 时没有 `isMainFrame` 守卫：

```typescript
if (msg?.type === 'pt:translate-selection') {
  translateSelection(msg.text ?? '');
  sendResponse({ ok: true });
  return;
}
```

`translateSelection()` 翻译的是**消息里带来的文本**，不是本 frame 的选区，所以每个 frame 都会照单全收。集成实测（主文档 + 1 个同源 iframe，各一份 content script）：

```
I-7  广播一次 pt:translate-selection
     chrome.runtime.sendMessage('pt:translate') 调用数 = 2   ❌（期望 1）
```

真实页面（广告位、嵌入播放器、评论组件）常有十几个同源 frame，一次右键就是十几次重复请求 —— 直接冲击阶段 2 的并发闸门与引擎额度，而且每个 frame 各弹一个 toast（子 frame 内的 toast 通常在视口外，用户只看到主文档那个，问题不可见）。

同一文件里 `pt:toggle-translate` 与快捷键、注入 UI 都做了 `isMainFrame` 判断，唯独这条漏了。

**建议修复**：在 `pt:translate-selection` 分支加 `if (!isMainFrame) return;`。选区文本由 background 从 `info.selectionText` 取得，主文档处理即可。

### P6-1 `stopSelectionDrag()` 是空函数，重复挂载不去重（中）

`src/ui/selection-drag.ts:19-21` 声称避免重复挂载：

```typescript
const prevCleanup = stopSelectionDrag;
prevCleanup();   // ← 函数体是 no-op
```

而 `stopSelectionDrag()`（同文件 47-50 行）的实现只有一行注释，什么都不做；模块级 `listening` 变量写了但从未被读。于是第二次调用 `startSelectionDrag()` 会在 `document` 上叠加第二对 `mousedown`/`mouseup` 监听：

```
E-8  连续两次 startSelectionDrag → 一次拖选手势 → 回调触发 2 次   ❌（期望 1）
```

当前 `content.ts` 每个 frame 只调用一次，尚未构成线上故障；但阶段 7 一旦让设置变更重新挂载划词监听（修饰键可配置是骨架里的签名），这就会变成"选一次翻两次"。属于坏死代码 + 失效防护，应一并清掉。

顺带两处与阶段文档骨架的偏差，本轮不计入缺陷但记录在案：

- 骨架签名是 `startSelectionDrag(modifier: 'Alt' | 'Ctrl' | 'Shift')`，实现改成了"Alt/Ctrl/Meta 任一"。`Settings` 里也没有对应字段，因此修饰键当前不可配置。
- 在 macOS 上 `Ctrl + 拖动` 是系统右键手势，把 Ctrl 计入触发键会与之重叠。

### X-1 popup 页脚版本号漂移（低，跨阶段）

```
package.json                       0.5.0
产物 manifest.json                 0.5.0
entrypoints/popup/index.html:83    v0.4.1   ❌
产物 popup.html                    v0.4.1   ❌
```

这是第三次出现同类问题（阶段 2 [DoDR-6](../phase-2/DoDR-6.md)、阶段 3 [DoDR-4](../phase-3/DoDR-4.md) 各修过一次）。阶段 3 报告已建议"把页脚改为从 `manifest.version` 读取，或加一条构建期断言"，本轮再次复发，说明手工同步这条路已经走不通了。建议这次直接改成运行时读取 `chrome.runtime.getManifest().version`，把问题根除。

---

## 3. 通过项的证据摘录

**跨平台显示与存储**（DoD 1、2、9）：

| 断言 | 输入 | 输出 |
|---|---|---|
| A-1 | `formatHotkey('Mod+Shift+Y', 'mac')` | `⇧⌘Y` |
| A-2 | `formatHotkey('Mod+Shift+Y', 'win')` | `Ctrl+Shift+Y` |
| A-4 | `formatHotkey('Mod+Ctrl+Alt+Shift+K', 'mac')` | `⌃⌥⇧⌘K`（Apple HIG 顺序） |
| A-5 | `formatHotkey('Mod+Alt+Shift+K', 'win')` | `Ctrl+Alt+Shift+K` |
| A-6 | 4 个默认组合 × 两平台 | 各自互不重复，Mac 全部 `⇧⌘*`、Win 全部 `Ctrl+Shift+*` |
| A-8 | 存储值 `'Mod+Shift+Y'` | 不含任何平台符号，同步到 Win 后原样可显示 |

**规范化的平台无关性**（DoD 9）：

```
B-1  mac ⌘⇧Y      → 'Mod+Shift+Y'
B-2  win Ctrl+⇧+Y → 'Mod+Shift+Y'    ← 同一表示
B-3  mac ⌃Y → 'Ctrl+Y'，⌘Y → 'Mod+Y' ← ⌘ 与 ⌃ 分开建模
B-4  无修饰键单键 → null
B-5  只按 Control/Meta/Alt/Shift → null
B-6  'Mod+ArrowUp' 功能键名未被 toUpperCase 破坏
```

**捕获阶段监听**（DoD 10）。模拟 Gmail/Notion 的做法 —— 在中间容器上绑 `keydown` 并 `stopPropagation()`：

```
C-3  从深层子节点派发 ⇧⌘Y → 处理器仍被调用   ✅
C-2  命中时 e.defaultPrevented === true
C-4  焦点在 <input> 内 → 不触发
C-6  清理函数摘除监听后 → 不触发
```

**录制与冲突检测**（DoD 5 ~ 8）：

```
D-1   'Mod+T'        → 该组合被浏览器占用，扩展无法接收
D-2   RESERVED 全 9 项均被识别
D-3   'Mod+Shift+M'（已绑给切换显示模式）→ 与「切换显示模式」重复
D-4   与自身当前绑定相同 → 无冲突（允许原样保存）
D-7   单独按 Y → 不捕获，给出"请使用带修饰键的组合"
D-8   只按 ⌘ → 既不捕获也不报错
D-9   录制期间 preventDefault，不触发页面行为
```

**右键菜单注册**（DoD 11 的注册侧）：

```
F-1  菜单项 id/title/contexts 与阶段文档一致（selection 上下文）
F-2  相同 id 重复 create 会抛错 → 佐证必须放在 onInstalled
F-3  background.ts 确实在 onInstalled 内调用 initContextMenu()
F-4  onClicked 监听器注册在 defineBackground 顶层（SW 唤醒后仍能收到）
F-6  非本扩展的 menuItemId 不被响应
F-7  产物 manifest 已声明 contextMenus 权限
```

**划词拖动的修饰键语义**（DoD 12、13）：

```
E-1  按住修饰键 mousedown → mouseup（仍按住）→ 翻译选区
E-2  全程不按修饰键 → 不触发
E-3  mousedown 时按住、mouseup 时松开 → 取消
E-4  mousedown 时未按、mouseup 时才按 → 不触发
E-5  选区 < 2 字符 → 不触发
E-6  空选区 → 不触发
```

---

## 4. 待真机自测项

- 在 Windows / Linux 实机上确认 `detectOS()` 的返回与显示（本轮以 `chrome.runtime.getPlatformInfo` 打桩覆盖 mac/win/linux 三条分支）
- Gmail、Notion 上按快捷键的实际触发（DoD 10 的代码层依据已具备）
- 富文本编辑器（Notion、Google Docs）内 `isContentEditable` 的实际拦截效果 —— jsdom 不实现该属性，本轮只做了源码断言
- 选中英文右键 → 菜单出现 → 点击后 toast 弹出译文的完整链路（DoD 11）
