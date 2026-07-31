// Phase 5 — 状态与错误提示 toast。
// 短暂提示，通过注入 shadow root 隔离，不受宿主页面样式影响。

import { mountIsolated } from './mount';

const TOAST_DURATION = 3000;

let toastTimer: number | undefined;
let toastShadow: ShadowRoot | null = null;

/** 短暂提示。kind='error' 用 --pt-danger，其余用 --pt-forest */
export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  // 复用已有 shadow root
  if (!toastShadow) {
    toastShadow = mountIsolated('toast');
  }

  // 移除旧 toast
  toastShadow.querySelector('.pt-toast')?.remove();
  clearTimeout(toastTimer);

  const el = document.createElement('div');
  el.className = 'pt-toast';
  el.dataset.kind = kind;
  el.textContent = msg;
  toastShadow.appendChild(el);

  toastTimer = self.setTimeout(() => {
    el.remove();
  }, TOAST_DURATION);
}
