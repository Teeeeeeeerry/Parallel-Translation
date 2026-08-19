// Phase 6 — 系统识别 + 按键符号映射。
//
// Mac 用符号且不加分隔符；其余平台用单词加 +。
// formatHotkey 是全局唯一的显示入口，设置页、popup 都调它。

export type OS = 'mac' | 'win' | 'linux' | 'other';

let cached: OS | null = null;

/** chrome.runtime.getPlatformInfo 是扩展环境下最可靠的来源 */
export async function detectOS(): Promise<OS> {
  if (cached) return cached;
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    cached =
      os === 'mac'
        ? 'mac'
        : os === 'win'
          ? 'win'
          : os === 'linux'
            ? 'linux'
            : 'other';
  } catch {
    // 降级链：content script 某些时机拿不到 runtime API
    const p =
      (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    cached = /mac/i.test(p)
      ? 'mac'
      : /win/i.test(p)
        ? 'win'
        : /linux/i.test(p)
          ? 'linux'
          : 'other';
  }
  return cached;
}

export function getOSSync(): OS {
  return cached ?? 'other';
}

/** Mac 用符号且不加分隔符；其余平台用单词加 + */
const SYMBOLS: Record<OS, Record<string, string>> = {
  mac: { Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' },
  win: { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
  linux: { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
  other: { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl' },
};

/** Mac 修饰键的标准显示顺序：⌃ ⌥ ⇧ ⌘（Apple HIG 约定） */
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];
const PC_ORDER = ['Ctrl', 'Mod', 'Alt', 'Shift'];

/**
 * 'Mod+Shift+Y' →  mac: '⇧⌘Y'   win: 'Ctrl+Shift+Y'
 */
export function formatHotkey(combo: string, os: OS): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  // #176: 别名键的显示形式（与 fromEvent 的 KEY_ALIAS 对应）
  const DISPLAY_KEY: Record<string, string> = { Space: 'Space', Plus: '+' };
  const shown = DISPLAY_KEY[key] ?? key.toUpperCase();
  const order = os === 'mac' ? MAC_ORDER : PC_ORDER;
  const mods = order
    .filter((m) => parts.includes(m))
    .map((m) => SYMBOLS[os][m]!);
  return os === 'mac' ? mods.join('') + shown : [...mods, shown].join('+');
}
