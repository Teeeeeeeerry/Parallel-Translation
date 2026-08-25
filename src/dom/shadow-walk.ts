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
