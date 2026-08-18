# 阶段 6 — 快捷键与划词交互

## 目标

实现完整的跨平台快捷键系统（规范化存储、系统识别、显示映射、录制、冲突检测），以及划词右键菜单和修饰键拖光标划词翻译。本阶段结束后，Mac 与 Windows 用户各自看到符合本平台习惯的按键提示，且都能实际触发。

## 前置依赖

- 阶段 1：`Settings.hotkeys` 字段已预留，形如 `{ 'toggle-translate': 'Mod+Shift+Y' }`
- 阶段 4：`applyMode()` 等待被快捷键调用
- 阶段 5：`toast()` 用于反馈

## 交付文件清单

```
src/hotkeys/
├── platform.ts      # 系统识别 + 按键符号映射
├── normalize.ts     # 组合键规范化、解析、事件匹配
├── listener.ts      # content script 运行时监听
└── recorder.ts      # 设置页录制组件 + 冲突检测

src/ui/
├── context-menu.ts     # 划词右键菜单（注册在 background）
└── selection-drag.ts   # 修饰键 + 拖光标划词翻译

entrypoints/background.ts    # 追加 contextMenus 注册
wxt.config.ts                # permissions 追加 contextMenus
```

## 关键代码骨架

### `src/hotkeys/platform.ts`

```typescript
export type OS = 'mac' | 'win' | 'linux' | 'other';

let cached: OS | null = null;

/** chrome.runtime.getPlatformInfo 是扩展环境下最可靠的来源 */
export async function detectOS(): Promise<OS> {
  if (cached) return cached;
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    cached = os === 'mac' ? 'mac' : os === 'win' ? 'win' : os === 'linux' ? 'linux' : 'other';
  } catch {
    // 降级链：content script 某些时机拿不到 runtime API
    const p = (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    cached = /mac/i.test(p) ? 'mac' : /win/i.test(p) ? 'win' : /linux/i.test(p) ? 'linux' : 'other';
  }
  return cached;
}

export function getOSSync(): OS {
  return cached ?? 'other';
}

/** Mac 用符号且不加分隔符；其余平台用单词加 + */
const SYMBOLS: Record<OS, Record<string, string>> = {
  mac:   { Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' },
  win:   { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
  linux: { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
  other: { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
};

/** Mac 修饰键的标准显示顺序：⌃ ⌥ ⇧ ⌘ */
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];
const PC_ORDER  = ['Ctrl', 'Mod', 'Alt', 'Shift'];

/**
 * 'Mod+Shift+Y' →  mac: '⇧⌘Y'   win: 'Ctrl+Shift+Y'
 * 设置页与 popup 共用此函数，保证全局显示一致。
 */
export function formatHotkey(combo: string, os: OS): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const order = os === 'mac' ? MAC_ORDER : PC_ORDER;
  const mods = order.filter(m => parts.includes(m)).map(m => SYMBOLS[os][m]);
  return os === 'mac'
    ? mods.join('') + key.toUpperCase()
    : [...mods, key.toUpperCase()].join('+');
}
```

### `src/hotkeys/normalize.ts`

```typescript
/**
 * 平台无关的组合键表示。
 * Mod 在 Mac 上是 ⌘、其余平台是 Ctrl；Ctrl 在 Mac 上是独立的 ⌃。
 * 两者必须分开建模 —— 只用 Ctrl 会让 Mac 用户被迫使用反直觉的组合。
 */
export function fromEvent(e: KeyboardEvent, os: OS): string | null {
  const key = e.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null;   // 只按了修饰键

  const mods: string[] = [];
  if (os === 'mac') {
    if (e.metaKey)  mods.push('Mod');
    if (e.ctrlKey)  mods.push('Ctrl');
  } else if (e.ctrlKey) {
    mods.push('Mod');
  }
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  if (!mods.length) return null;   // 拒绝无修饰键的单键，避免与页面输入冲突
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

export function matches(e: KeyboardEvent, combo: string, os: OS): boolean {
  return fromEvent(e, os) === combo;
}

/** 焦点在可输入元素内时不响应快捷键 */
export function isTypingContext(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}
```

### `src/hotkeys/listener.ts`

```typescript
export function startHotkeys(handlers: Record<HotkeyAction, () => void>): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingContext()) return;
    const os = getOSSync();
    const combo = fromEvent(e, os);
    if (!combo) return;

    const { hotkeys } = getSettings();
    for (const [action, bound] of Object.entries(hotkeys)) {
      if (bound === combo) {
        e.preventDefault();
        e.stopPropagation();
        handlers[action as HotkeyAction]?.();
        return;
      }
    }
  };
  // 用捕获阶段，抢在页面自身的按键处理之前
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}
```

### `src/hotkeys/recorder.ts`

```typescript
/** 浏览器优先拦截、扩展收不到的组合 */
const RESERVED = [
  'Mod+T', 'Mod+W', 'Mod+N', 'Mod+Q', 'Mod+R', 'Mod+L',
  'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Shift+W',
];

export function checkConflict(
  combo: string,
  hotkeys: Record<HotkeyAction, string>,
  self: HotkeyAction,
): string | null {
  if (RESERVED.includes(combo)) {
    return '该组合被浏览器占用，扩展无法接收';
  }
  for (const [action, bound] of Object.entries(hotkeys)) {
    if (action !== self && bound === combo) return `与“${LABELS[action]}”重复`;
  }
  return null;
}

/** 录制组件：监听 keydown，捕获并规范化用户按下的组合 */
export function startRecording(onCapture: (combo: string) => void): () => void { /* ... */ }
```

### `src/ui/selection-drag.ts`

```typescript
/**
 * 按住修饰键并拖动光标选中文本，松开即翻译选区。
 * 与普通选中的区别：必须全程按住修饰键，避免与页面正常选中冲突。
 */
export function startSelectionDrag(modifier: 'Alt' | 'Ctrl' | 'Shift'): () => void {
  let armed = false;

  const onDown = (e: MouseEvent) => { armed = isModifierHeld(e, modifier); };
  const onUp = (e: MouseEvent) => {
    if (!armed) return;
    armed = false;
    if (!isModifierHeld(e, modifier)) return;   // 中途松开修饰键则取消
    const text = window.getSelection()?.toString().trim();
    if (text && text.length >= 2) translateSelection(text);
  };

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);
  return () => { /* ... */ };
}
```

### `entrypoints/background.ts` 追加

```typescript
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pt-translate-selection',
    title: '翻译所选文本',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'pt-translate-selection' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'pt:translate-selection', text: info.selectionText });
  }
});
```

## 实现要点与取舍

**为什么完全不用 `chrome.commands`。** 它有两个硬限制：最多 4 个快捷键，且**扩展自身无法修改绑定** —— 用户必须手动打开 `chrome://extensions/shortcuts` 才能改。全部自监听换来数量不限和真正的应用内自定义。代价是 `chrome://` 页面、Chrome 商店、PDF 阅读器内快捷键失效，但**这些页面本来也无法注入 content script、无法翻译**，所以没有实际损失。

**`Mod` 与 `Ctrl` 必须是两个 token。** Mac 上 ⌘ 和 ⌃ 是不同的键，日常操作用 ⌘。若只建模一个 `Ctrl`，Mac 用户要么被迫用 ⌃（与所有 Mac 应用习惯相悖），要么代码里到处写平台分支。抽象成 `Mod`（平台主修饰键）+ `Ctrl`（真正的 Control）后，存储是平台无关的，显示与匹配各自映射一次即可。

**存储平台无关、显示与匹配分别映射。** 这样同一份设置在 Mac 和 Windows 间通过 `chrome.storage.sync` 同步后，两边都自然可用。若直接存 `'⌘+Shift+Y'`，同步到 Windows 就是废数据。

**Mac 修饰键有标准显示顺序：⌃ ⌥ ⇧ ⌘。** 这是 Apple 人机界面指南的约定，所有原生应用都遵守。顺序错了看起来会很业余。Windows 侧顺序相对宽松，惯例是 Ctrl → Alt → Shift。

**`formatHotkey` 必须是全局唯一的显示入口。** 设置页、popup、帮助文档都调它。各处自己拼字符串必然导致显示不一致。

**拒绝无修饰键的单键绑定。** 允许绑单个字母会导致用户在页面上正常打字时误触发。虽然有 `isTypingContext()` 兜底，但页面上存在大量非标准输入组件（富文本编辑器的自定义实现），检测不可能覆盖全。直接在录制层拒绝更稳妥。

**用捕获阶段监听。** 很多页面自己绑了 `keydown` 并 `stopPropagation()`。冒泡阶段监听会被这些页面吞掉按键。捕获阶段能抢在页面之前拿到事件。

**保留组合检测是提示而非阻止。** `Mod+T`、`Mod+W` 这类会被浏览器优先拦截，扩展根本收不到。允许用户设置但给出明确警告，比静默失败让用户以为功能坏了要好。

**划词拖动必须全程按住修饰键。** 只在 `mousedown` 时检查会导致用户正常选中文本后偶然按了修饰键就触发翻译。`mouseup` 时再检查一次，中途松开则取消。

**右键菜单注册在 `onInstalled` 而非每次启动。** `chrome.contextMenus.create` 用相同 id 重复调用会抛错。MV3 的 service worker 会频繁休眠重启，放在顶层执行会反复报错。

## DoD 验收标准

- [ ] Mac 上设置页显示 `⇧⌘Y`，Windows 上显示 `Ctrl+Shift+Y`
- [ ] Mac 上修饰键按 ⌃⌥⇧⌘ 顺序排列
- [ ] 两平台快捷键均能实际触发对应功能
- [ ] 焦点在输入框、文本域、富文本编辑器内时快捷键不触发
- [ ] 录制组件能捕获用户按下的组合并正确规范化
- [ ] 录制到 `Mod+T` 时给出"被浏览器占用"警告
- [ ] 录制到已被其他动作占用的组合时给出重复警告
- [ ] 录制拒绝无修饰键的单键
- [ ] 在 Mac 设置的快捷键，同步到 Windows 后显示为对应的 Windows 按键
- [ ] 页面自身绑定了 keydown 的站点（如 Gmail、Notion）上快捷键仍能触发
- [ ] 选中文本右键 → 出现“翻译所选文本”→ 点击后弹出译文
- [ ] 按住修饰键拖选文本，松开后自动翻译选区
- [ ] 不按修饰键正常选中文本，**不会**触发翻译

## 验证步骤

```bash
pnpm dev
```

**跨平台显示**（若只有一台设备，可临时改 `detectOS()` 的返回值验证两侧）：

| 平台 | `'Mod+Shift+Y'` 应显示为 |
|---|---|
| Mac | `⇧⌘Y` |
| Windows / Linux | `Ctrl+Shift+Y` |

**规范化自查**（页面 Console）：

```javascript
// 模拟 Mac 上按下 ⌘⇧Y
console.log(fromEvent({ key: 'y', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }, 'mac'));
// 预期 'Mod+Shift+Y'

// 模拟 Windows 上按下 Ctrl+Shift+Y
console.log(fromEvent({ key: 'y', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false }, 'win'));
// 预期 'Mod+Shift+Y' —— 与 Mac 得到同一个平台无关表示
```

**输入框不误触发**：打开任一含搜索框的页面，点进搜索框，输入包含快捷键字母的文本 → 不应触发翻译。

**页面吞按键**：打开 Gmail 或 Notion（两者都重度绑定键盘事件）→ 按快捷键 → 应能正常触发。

**冲突检测**：进设置页录制快捷键，依次尝试：

| 输入 | 预期 |
|---|---|
| `Mod+T` | 警告"该组合被浏览器占用" |
| 已被其他动作占用的组合 | 警告"与“xxx”重复" |
| 单独按 `Y` | 不被接受 |

**右键菜单**：选中一段英文 → 右键 → 应见“翻译所选文本”→ 点击 → 弹出译文。

**划词拖动**：按住设定的修饰键，拖动选中一段文本，松开 → 自动翻译。不按修饰键重复一次 → 不应触发。
