// Phase 5 — shadow root 挂载通用封装。
//
// 创建一个与宿主页面完全隔离的挂载点。
// 双向隔离：宿主 CSS 进不来，我们的 CSS 出不去。

import tokens from '@/src/styles/tokens.css?inline';
import injected from '@/src/styles/injected.css?inline';

/**
 * 创建一个与宿主页面完全隔离的挂载点。
 */
export function mountIsolated(id: string): ShadowRoot {
  const host = document.createElement('div');
  host.id = `pt-host-${id}`;

  // 关键标记：walker 与 observer 依此跳过整棵子树，避免翻译自己的按钮
  host.dataset.ptUi = '1';

  // 宿主页面可能有 div { position: static !important } 之类的规则，
  // 用 all: initial 兜底
  host.style.cssText =
    'all: initial; position: fixed; z-index: 2147483647;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = tokens + injected;
  shadow.appendChild(style);

  document.body.appendChild(host);
  return shadow;
}

export function unmountIsolated(id: string): void {
  document.getElementById(`pt-host-${id}`)?.remove();
}
