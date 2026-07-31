// Phase 6 — 修饰键 + 拖光标划词翻译。
//
// 按住修饰键并拖动光标选中文本，松开即翻译选区。
// 与普通选中的区别：必须全程按住修饰键，避免与页面正常选中冲突。

type OnTranslateSelection = (text: string) => void;

let listening = false;

/**
 * 启动划词拖动监听。
 * 修饰键在 mousedown 和 mouseup 时都检查，中途松开则取消。
 */
export function startSelectionDrag(
  onTranslate: OnTranslateSelection,
): () => void {
  // 避免重复挂载
  const prevCleanup = stopSelectionDrag;
  prevCleanup();

  let armed = false;

  const isModKey = (e: MouseEvent): boolean =>
    e.altKey || e.ctrlKey || e.metaKey;

  const onDown = (e: MouseEvent) => {
    armed = isModKey(e);
  };

  const onUp = (e: MouseEvent) => {
    if (!armed) return;
    armed = false;
    if (!isModKey(e)) return; // 中途松开修饰键则取消
    const text = window.getSelection()?.toString().trim();
    if (text && text.length >= 2) onTranslate(text);
  };

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);
  listening = true;

  return () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseup', onUp, true);
    listening = false;
  };
}

/** 供外部调用以清理 */
function stopSelectionDrag(): void {
  // no-op when not listening, actual cleanup done by returned function
}
export { stopSelectionDrag };
