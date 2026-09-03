// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// #163: 扩展样式不跨 shadow 边界 —— shadow 内译文不受模式/样式预设控制。
//
// content script 的 CSS（presets.css / tokens.css）由 Chrome 以文档级样式
// 注入，不会穿透 shadow root（YouTube/Reddit 等站的核心内容都在 shadow
// 里）。此模块把 tokens + presets + :host-context 变体以 <style> 注入每个
// 被翻译/被观察的 shadow root：
// - 元素级规则（.pt-trans { display:block } 等）直接生效；
// - 模式/样式预设规则依赖文档 <html> 上的类（pt-only-trans-page、
//   pt-style-* 等），在 shadow 树内匹配不到祖先 —— 用 :host-context
//   变体让文档侧的类经宿主祖先链生效。
// 不支持 :host-context 的浏览器（Safari <18 / Firefox <128）降级为
// 修复前行为：shadow 内译文不受预设控制，功能不受损。

import tokensCss from './tokens.css?inline';
import presetsCss from './presets.css?inline';

/** :host-context 变体 —— 与 presets.css 一一对应，仅作用于 shadow 内译文 */
const HOST_CONTEXT_CSS = `
/* 仅译文模式（按来源分流） */
:host-context(.pt-only-trans-page) [data-pt-src='page'] .pt-origin { display: none; }
:host-context(.pt-only-trans-para) [data-pt-src='para'] .pt-origin { display: none; }

/* 6 种样式预设 */
:host-context(.pt-style-default) .pt-trans {
  opacity: 0.6;
}
:host-context(.pt-style-dim) .pt-trans {
  opacity: 0;
  transition: opacity 0.15s ease;
}
:host-context(.pt-style-dim) [data-pt='done']:hover .pt-trans {
  opacity: 1;
}
:host-context(.pt-style-underline) .pt-trans {
  text-decoration: underline solid;
  text-underline-offset: 3px;
}
:host-context(.pt-style-bold) .pt-trans {
  font-weight: 700;
}
:host-context(.pt-style-italic) .pt-trans {
  font-style: italic;
}
:host-context(.pt-style-border) .pt-trans {
  border-left: 2px solid var(--pt-brass);
  padding-left: 0.5em;
  opacity: 0.6;
}
`;

let cssText: string | null = null;

/** shadow 注入用完整样式文本（tokens + presets + :host-context 变体）。 */
export function shadowStylesCss(): string {
  return (cssText ??= `${tokensCss}
${presetsCss}
${HOST_CONTEXT_CSS}`);
}

/** 已注入样式的 shadow root，避免重复注入（防抖外的幂等保护）。 */
const injectedRoots = new WeakSet<ShadowRoot>();

/**
 * 向 shadow root 注入扩展样式（幂等）。
 * 必须在 observer 挂载前调用（避免注入动作触发自身的 mutation 记录）。
 */
export function injectShadowStyles(root: ShadowRoot): void {
  if (injectedRoots.has(root)) return;
  injectedRoots.add(root);
  const style = document.createElement('style');
  style.textContent = shadowStylesCss();
  root.appendChild(style);
}
