// Phase 3 — TreeWalker 递归穿透 shadowRoot。
//
// document.createTreeWalker 只遍历 light DOM，不会自动进入 shadow DOM。
// Reddit 新版、YouTube、大量 Web Components 站点的内容放在 shadow root 里，
// 必须显式递归才能覆盖。

import { SKIP_SET, shouldSkip, isTranslationUnit } from './classify';

/**
 * 采集可翻译节点。
 * TreeWalker 不会自动进入 shadowRoot，必须显式递归。
 */
export function collect(root: Node = document.body): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  walk(root, out, seen);
  return out;
}

function walk(root: Node, out: Element[], seen: Set<Element>): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;

      // 扩展自身 UI：整棵子树拒绝，且不下沉其 shadowRoot
      if ((el as HTMLElement).dataset?.ptUi === '1')
        return NodeFilter.FILTER_REJECT;

      if (SKIP_SET.has(el.tagName.toLowerCase()))
        return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;

    // TreeWalker.currentNode 初值是 root 本身，acceptNode 不作用于根节点。
    // 递归进入 shadowRoot 时 root 是 ShadowRoot（DocumentFragment，无 tagName），
    // 必须跳过，否则 shouldSkip() 里 el.tagName.toLowerCase() 抛 TypeError。
    if (el.nodeType !== Node.ELEMENT_NODE) {
      node = walker.nextNode();
      continue;
    }

    // 关键：遇到 shadow host 就递归下沉。TreeWalker 自己不会做这件事
    if (el.shadowRoot) walk(el.shadowRoot, out, seen);

    if (!seen.has(el) && !shouldSkip(el) && isTranslationUnit(el)) {
      seen.add(el);
      out.push(el);
    }
    node = walker.nextNode();
  }
}
