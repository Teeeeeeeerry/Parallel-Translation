// Phase 3 / 8 — TreeWalker 递归穿透 shadowRoot + 域名级补丁。
//
// document.createTreeWalker 只遍历 light DOM，不会自动进入 shadow DOM。
// Reddit 新版、YouTube、大量 Web Components 站点的内容放在 shadow root 里，
// 必须显式递归才能覆盖。
//
// Phase 8 接入域名级采集补丁（src/dom/compat.ts），
// 在通用规则判定之前给特定站点插入决策。
//
// #319：采集跳过决策表。每个跳过分支明确标注语义：
//   - 整棵子树拒绝（reject-subtree）：不再访问该元素任何后代（含 shadowRoot）
//   - 跳过自身继续子树（skip-self）：元素不入列，但子元素照常访问
//
// 判定顺序（不可颠倒）：
//   1. 便宜的标签查表 —— pt-ui / SKIP_SET 在 acceptNode 里执行，
//      FILTER_REJECT 让 TreeWalker 整体跳过子树（#319 分支 R1/R2）
//   2. 逐元素判定（decideCollect）—— compat 补丁 → pre 切块 →
//      翻译单元查表 → 非文本内容 → 非视觉跳过 → 可见性
//      其中 shouldSkipNonVisual 要拼 outerHTML / 算 textContent、
//      isVisible 取 getBoundingClientRect，都强制同步布局，必须排在
//      便宜判定之后

import {
  SKIP_SET,
  shouldSkipNonVisual,
  isVisible,
  isTranslationUnit,
  hasNonTextContent,
} from './classify';
import { applyCompat } from './compat';
import { splitPre } from './pre-split';

/** 逐元素采集决策（#319 决策表）。 */
type CollectDecision =
  | { kind: 'take'; el: Element } // 域名补丁改指：直接收为单元，继续遍历
  | { kind: 'collect' } // 采集当前元素
  | { kind: 'skip-self' } // 跳过自身，继续访问子元素
  | { kind: 'hidden'; el: Element }; // 不可见：记入 onHidden，跳过自身

/**
 * 便宜的标签查表 —— 整棵子树拒绝（#319 R1/R2）。
 * 放在 acceptNode 里而非逐元素判定：FILTER_REJECT 让 TreeWalker
 * 不进入被拒子树的 light DOM，也避免先访问子元素再逐层拒绝。
 */
function rejectSubtree(el: Element): boolean {
  // R1 整棵子树拒绝：扩展自身 UI —— 且不下沉其 shadowRoot
  if ((el as HTMLElement).dataset?.ptUi === '1') return true;
  // R2 整棵子树拒绝：SKIP_SET（button/code/script 等）
  if (SKIP_SET.has(el.tagName.toLowerCase())) return true;
  return false;
}

/**
 * 逐元素采集决策（#319 决策表）—— 判定顺序：
 * 便宜的标签查表（翻译单元判定首步）在前，强制同步布局的
 * shouldSkipNonVisual / isVisible 在后。
 */
function decideCollect(el: Element, seen: Set<Element>): CollectDecision {
  // D1 域名补丁（skip 优先于通用判定）：跳过自身继续子树
  const patched = applyCompat(el);
  if (patched && 'skip' in patched) return { kind: 'skip-self' };
  // D2 域名补丁（take）：改指收为单元，继续遍历
  if (patched && 'take' in patched) return { kind: 'take', el: patched.take };

  // D3 #65：超大纯文本 pre（如 GitHub README 的 .plain > pre）按空行切块，
  // 块是独立翻译单元。切分是纯文本结构操作，无站点相关性；
  // 代码块判定（isCodeBlockPre）是唯一站点相关部分（#64）。
  // 切块在单元判定之前：pre 自身不是单元也要切，切出的 .pt-chunk 才入列。
  if (el.tagName === 'PRE') splitPre(el as HTMLPreElement);

  // D4 已采集去重 / 翻译单元查表（首步只是一次标签查表）：
  // 非单元或已入列（compat take 收过）—— 跳过自身继续子树
  if (seen.has(el) || !isTranslationUnit(el)) return { kind: 'skip-self' };

  // D5 #50：含媒体/交互控件的容器不能整体翻译（render 会拒绝），
  // 跳过自身继续子树 —— 其纯文本后代（不含非文本内容）仍可采集
  if (hasNonTextContent(el)) return { kind: 'skip-self' };

  // D6 非视觉跳过：notranslate / 已翻译单元自身（.pt-origin 内不重复翻）/
  // 扩展 UI / 非正文区 / 文本长度。跳过自身继续子树 —— 已翻译单元内
  // 新增的段落（原文容器之外）仍被采集（#179）
  if (shouldSkipNonVisual(el)) return { kind: 'skip-self' };

  // D7 #23：不可见翻译单元记入延迟队列，等 IntersectionObserver 补翻。
  // 跳过自身继续子树
  if (!isVisible(el)) return { kind: 'hidden', el };

  return { kind: 'collect' };
}

/**
 * 采集可翻译节点。
 * TreeWalker 不会自动进入 shadowRoot，必须显式递归。
 */
export function collect(
  root: Node = document.body,
  onHidden?: (el: Element) => void,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  walk(root, out, seen, onHidden);
  return out;
}

function walk(
  root: Node,
  out: Element[],
  seen: Set<Element>,
  onHidden?: (el: Element) => void,
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      // 便宜标签查表：整棵子树拒绝（#319 R1/R2）
      return rejectSubtree(node as Element)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;

    // TreeWalker.currentNode 初值是 root 本身，acceptNode 不作用于根节点。
    // 递归进入 shadowRoot 时 root 是 ShadowRoot（DocumentFragment，无 tagName），
    // 必须跳过，否则 el.tagName.toLowerCase() 抛 TypeError。
    if (el.nodeType !== Node.ELEMENT_NODE) {
      node = walker.nextNode();
      continue;
    }

    // 关键：遇到 shadow host 就递归下沉。TreeWalker 自己不会做这件事。
    // #317：onHidden 必须一并传递，否则 shadow 内初次不可见的翻译单元
    // 不会被注册进可见性观察，展开后永久漏翻。
    if (el.shadowRoot) walk(el.shadowRoot, out, seen, onHidden);

    // 逐元素判定（决策表见 decideCollect）：
    // Web Components（<relative-time>、<clipboard-copy> 等）上访问
    // textContent / outerHTML / closest() 可能抛出 DOMException，
    // 用 try-catch 包裹整段判定，失败时按「跳过自身继续子树」处理，
    // 宁可漏翻单个可疑节点也不要整页崩溃（#54）。
    try {
      const decision = decideCollect(el, seen);
      switch (decision.kind) {
        case 'take':
          if (!seen.has(decision.el)) {
            seen.add(decision.el);
            out.push(decision.el);
          }
          break;
        case 'collect':
          seen.add(el);
          out.push(el);
          break;
        case 'hidden':
          onHidden?.(decision.el);
          break;
        case 'skip-self':
          break;
      }
    } catch {
      // 跳过自身继续子树（#54）
    }
    node = walker.nextNode();
  }
}
