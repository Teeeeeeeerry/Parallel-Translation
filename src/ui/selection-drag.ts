// Phase 6 — 修饰键 + 拖光标划词翻译。
//
// 按住修饰键并拖动光标选中文本，松开即翻译选区。
// 与普通选中的区别：必须全程按住修饰键，避免与页面正常选中冲突。

type OnTranslateSelection = (text: string) => void;

/** 当前挂载的清理函数。重复挂载时先摘旧的，否则一次拖选会翻译多次。 */
let cleanup: (() => void) | null = null;

/**
 * 启动划词拖动监听。
 * 修饰键在 mousedown 和 mouseup 时都检查，中途松开则取消。
 */
export function startSelectionDrag(
  onTranslate: OnTranslateSelection,
): () => void {
  stopSelectionDrag();

  let armed = false;
  let preSelection = '';

  const isModKey = (e: MouseEvent): boolean =>
    e.altKey || e.ctrlKey || e.metaKey;

  const onDown = (e: MouseEvent) => {
    armed = isModKey(e);
    // #180: 记录按下前的选区 —— 点击非文本区域（悬浮球/空白处）不会
    // 折叠旧选区，mouseup 时若不对比就会翻译之前残留的选中文本
    preSelection = window.getSelection()?.toString() ?? '';
  };

  const onUp = (e: MouseEvent) => {
    if (!armed) return;
    armed = false;
    if (!isModKey(e)) return; // 中途松开修饰键则取消
    const text = window.getSelection()?.toString().trim();
    // #180: 本次拖动没有产生新选区（文本未变化）→ 不翻译残留旧选区
    if (text && text.length >= 2 && text !== preSelection) onTranslate(text);
  };

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);

  cleanup = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseup', onUp, true);
    cleanup = null;
  };
  return stopSelectionDrag;
}

/** 摘除当前挂载的监听。未挂载时为空操作。 */
export function stopSelectionDrag(): void {
  cleanup?.();
}
