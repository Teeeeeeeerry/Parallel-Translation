// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 统一 shadow 子树遍历模块 —— #220 架构评审候选 4 的核心（#233）。
//
// Shadow-DOM 的递归遍历此前在还原流程、已翻译判定、观察器三处各写一遍，
// 终止条件互不相同 —— 同一份遍历语义散落多处，漏一处就复发。本模块把
// 递归遍历（含 shadowRoot）与集中式跳过 / 终止规则收敛为一处：
//   - UI 自身子树（[data-pt-ui="1"]）：整棵子树跳过，不访问内部元素
//   - 已翻译标记（[data-pt="done"]）：元素自身可被 visit 命中，
//     其子树默认不再深入（skipTranslated: false 可关闭，供还原流程
//     收集嵌套已翻译单元）
//
// 遍历顺序：先序。根元素自身也会被 visit（root 为 Document /
// ShadowRoot 时从第一个子元素开始）。visit 返回值：
//   - 'continue'（或 undefined）：继续遍历
//   - 'skip-subtree'：跳过当前元素的整棵子树（含其 shadowRoot）
//   - 'stop'：终止整个遍历（短路返回）

export type WalkDecision = 'continue' | 'skip-subtree' | 'stop';

export interface ShadowWalkOptions {
  /**
   * 已翻译单元（[data-pt="done"]）的子树是否跳过，默认 true。
   * 需要收集「已翻译单元内部的嵌套已翻译单元」时传 false。
   */
  skipTranslated?: boolean;
}

export function walkShadowTree(
  root: ParentNode,
  visit: (el: Element) => WalkDecision | void,
  opts: ShadowWalkOptions = {},
): void {
  const skipTranslated = opts.skipTranslated !== false;

  const visitElement = (el: Element): WalkDecision => {
    // 集中式跳过规则一：扩展自身 UI —— 整棵子树拒绝，不下沉 shadowRoot
    if ((el as HTMLElement).dataset?.ptUi === '1') return 'skip-subtree';

    const decision = visit(el);
    if (decision === 'stop' || decision === 'skip-subtree') return decision;

    // 集中式跳过规则二：已翻译标记 —— 元素已 visit，子树不再深入
    if (skipTranslated && el.getAttribute('data-pt') === 'done') {
      return 'skip-subtree';
    }

    // 递归下沉 shadowRoot（TreeWalker / querySelectorAll 都不穿透 shadow 边界）
    if (el.shadowRoot && walk(el.shadowRoot) === 'stop') return 'stop';

    // light DOM 子树
    for (const child of el.children) {
      const d = visitElement(child);
      if (d === 'stop') return 'stop';
      if (d === 'skip-subtree') continue;
    }
    return 'continue';
  };

  const walk = (scope: ParentNode): WalkDecision => {
    // 根元素自身也走同一套 visit + 跳过规则；其子树由 visitElement 递归
    if (scope.nodeType === Node.ELEMENT_NODE) {
      return visitElement(scope as Element);
    }
    for (const child of scope.children) {
      const d = visitElement(child);
      if (d === 'stop') return 'stop';
      if (d === 'skip-subtree') continue;
    }
    return 'continue';
  };

  walk(root);
}

// ── 延迟 attachShadow 补丁（#238）──
//
// host 已入 DOM 后才建 shadow root 的组件（属性级操作，childList 捕不到、
// MutationObserver 不产生记录）此前由观察器自行补丁监听。补丁与遍历
// 同处本模块，共享已见集合等状态：shadowRoot 创建时同步通知已注册的
// 消费方（观察器等），补丁后遍历能发现后建的 shadowRoot，且已见过的
// root 不会重复通知。

/** shadowRoot 创建通知的消费方（观察器等需同步挂载的上下文）。 */
export interface ShadowRootSink {
  /** 已见集合 —— 与遍历共享：已见过的 root 不再重复通知。 */
  seen: WeakSet<ShadowRoot>;
  /** root 创建时同步回调（shadow 内容通常在 attachShadow 之后立即填充）。 */
  onShadowRoot: (root: ShadowRoot) => void;
}

const sinks = new Set<ShadowRootSink>();

/**
 * 注册 shadowRoot 创建通知（attachShadow 补丁驱动）。
 * 返回取消注册函数。
 */
export function watchShadowRoots(sink: ShadowRootSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

const nativeAttachShadow = Element.prototype.attachShadow;
if (
  !(Element.prototype as unknown as { __ptShadowPatched?: boolean })
    .__ptShadowPatched
) {
  (Element.prototype as unknown as { __ptShadowPatched: boolean })
    .__ptShadowPatched = true;
  Element.prototype.attachShadow = function (
    this: Element,
    init?: ShadowRootInit,
  ): ShadowRoot {
    // 原生实现允许省略 init，类型声明要求必填 —— 运行时原样透传
    const root = nativeAttachShadow.call(this, init as ShadowRootInit);
    for (const sink of sinks) {
      if (sink.seen.has(root)) continue;
      sink.seen.add(root);
      sink.onShadowRoot(root);
    }
    return root;
  };
}
