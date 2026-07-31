// Phase 3 / 8 — TreeWalker 递归穿透 shadowRoot + 域名级补丁。
//
// document.createTreeWalker 只遍历 light DOM，不会自动进入 shadow DOM。
// Reddit 新版、YouTube、大量 Web Components 站点的内容放在 shadow root 里，
// 必须显式递归才能覆盖。
//
// Phase 8 接入域名级采集补丁（src/dom/compat.ts），
// 在通用规则判定之前给特定站点插入决策。

import { SKIP_SET, shouldSkip, isTranslationUnit } from './classify';
import { applyCompat } from './compat';

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

    // Phase 8 域名补丁：在通用判定之前给特定站点插入决策。
    // 补丁的 skip/take 优先于通用规则；null 则交回通用逻辑。
    const patched = applyCompat(el);
    if (patched && 'skip' in patched) {
      node = walker.nextNode();
      continue;
    }
    if (patched && 'take' in patched) {
      if (!seen.has(el)) {
        seen.add(el);
        out.push(patched.take);
      }
      node = walker.nextNode();
      continue;
    }

    // 判定顺序不能反：isTranslationUnit() 首步只是一次标签查表，而
    // shouldSkip() 要拼 outerHTML、算 textContent、调 getBoundingClientRect
    // （真实浏览器中会强制同步布局）。先便宜后昂贵，整页采集耗时约降至 1/5。
    if (!seen.has(el) && isTranslationUnit(el) && !shouldSkip(el)) {
      seen.add(el);
      out.push(el);
    }
    node = walker.nextNode();
  }
}
