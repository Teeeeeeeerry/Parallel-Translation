// Phase 5 — shadow root 挂载通用封装。
//
// 创建一个与宿主页面完全隔离的挂载点。
// 双向隔离：宿主 CSS 进不来，我们的 CSS 出不去。

import tokens from '@/src/styles/tokens.css?inline';
import injected from '@/src/styles/injected.css?inline';

/** 活跃的 host 守护 observer，按 id 索引。同一 id 只有一个实例。 */
const guards = new Map<string, MutationObserver>();

/**
 * 创建一个与宿主页面完全隔离的挂载点。
 *
 * 包含自动恢复机制：如果宿主元素被页面脚本（如 React SPA 的客户端渲染）
 * 从 DOM 中移除，MutationObserver 会检测到并自动重新挂载。
 * 这对于 Reddit 新版等会在 document_end 之后替换 body 子节点的站点至关重要。
 */
export interface MountOptions {
  /**
   * 覆盖挂载点的定位样式。收的是一段 CSS 声明串（须自带结尾分号），
   * 不是单个属性值。默认右下角（悬浮球 / toast / 段落按钮），
   * 更新提示的全屏遮罩传 `'inset: 0;'`。
   */
  positionCss?: string;
}

export function mountIsolated(id: string, opts: MountOptions = {}): ShadowRoot {
  const host = document.createElement('div');
  host.id = `pt-host-${id}`;

  // 关键标记：walker 与 observer 依此跳过整棵子树，避免翻译自己的按钮
  host.dataset.ptUi = '1';

  // 宿主页面可能有 div { position: static !important } 之类的规则，
  // 用 all: initial 兜底
  host.style.cssText =
    'all: initial; position: fixed; z-index: 2147483647; ' +
    (opts.positionCss ?? 'right: 24px; bottom: 24px;');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = tokens + injected;
  shadow.appendChild(style);

  document.body.appendChild(host);

  // 启动守护：监听 host 被外部脚本（如 React SPA 渲染）移除的情况
  startHostGuard(id, host);

  return shadow;
}

export function unmountIsolated(id: string): void {
  // 先停掉守护，避免 observer 在我们主动移除时重新挂载
  stopHostGuard(id);
  document.getElementById(`pt-host-${id}`)?.remove();
}

// ── 内部：host 守护 ──

function startHostGuard(id: string, host: HTMLDivElement): void {
  // 避免同一 id 注册多个 observer
  stopHostGuard(id);

  const fullId = `pt-host-${id}`;

  const observer = new MutationObserver(() => {
    // 检查 host 是否仍在文档中
    if (!document.getElementById(fullId) && document.body) {
      document.body.appendChild(host);
    }
  });

  // 监听 body 的直接子节点变化（React 替换 body 内容时触发）
  observer.observe(document.body, { childList: true });

  guards.set(id, observer);
}

function stopHostGuard(id: string): void {
  const existing = guards.get(id);
  if (existing) {
    existing.disconnect();
    guards.delete(id);
  }
}
