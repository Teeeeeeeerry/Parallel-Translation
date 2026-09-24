// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 3 / 8 — 采集器：统一遍历模块的一个访问回调。
//
// #320：遍历本身、shadow 下沉、集中式跳过规则（扩展自身 UI）、去重
// 全部交给统一遍历模块 walkShadowTree（src/dom/shadow-walk.ts）；
// 本模块只保留：
//   - 站点页面规则的限定范围与排除（数据，src/storage/specialization.ts，ADR-0003）
//   - 域名补丁装配（src/dom/compat.ts，选择器表达不了的代码层）
//   - 超大纯文本 pre 切块（src/dom/pre-split.ts）
//   - 翻译单元判定（src/dom/classify.ts）
//
// 决策表（#319）到遍历决策的映射：
//   - R1 扩展自身 UI 整棵子树跳过（含其 shadowRoot）—— 遍历模块内建
//   - S1 站点页面规则的排除（#366）整棵子树跳过；采集根落在排除区内
//     （observer 增量补翻的新增节点，祖先越过 Shadow DOM 边界，#442）
//     时直接返回空集
//   - R2 SKIP_SET 整棵子树拒绝 —— 本回调返回 skip-subtree（根元素除外，
//     根为 body 时按既有语义仍遍历其子树）
//   - S2 站点页面规则的限定范围（#374）：范围外的元素跳过自身继续子树
//     —— 范围可能在更深处。ADR-0003 的判定顺序是限定范围在排除之前；
//     两者都只做否决，先判排除只为整棵剪枝，结果与先判限定范围相同
//   - D1/D2 域名补丁 skip/take —— 仍在通用判定之前生效
//   - D3 pre 切块 —— 切块自身被采集为独立单元
//   - D4-D7 非单元 / 非文本容器 / 非视觉 / 不可见 —— 跳过自身继续子树
//   - D8 去掉保留原文后没有可翻译的文字（#454）—— 跳过自身继续子树

import {
  SKIP_SET,
  shouldSkipNonVisual,
  isVisible,
  isTranslationUnit,
  hasNonTextContent,
  inScope,
  withinAny,
} from './classify';
import { applyCompat } from './compat';
import { getSiteRules } from '~/src/storage/specialization';
import { splitPre } from './pre-split';
import { hasTranslatableText } from './text';
import { walkShadowTree } from './shadow-walk';

/**
 * 采集可翻译节点。
 * TreeWalker 不会自动进入 shadowRoot，必须显式递归。
 */
export function collect(
  root: Node = document.body,
  onHidden?: (el: Element) => void,
): Element[] {
  const out: Element[] = [];

  // 非 ParentNode（文本节点等）的根直接返回空集，与旧 TreeWalker 行为一致
  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return out;
  }
  const rootEl =
    root.nodeType === Node.ELEMENT_NODE ? (root as Element) : null;

  // S1 站点页面规则的排除：命中的元素整块不采集。划词翻译只拿选中
  // 文本、不经过本入口，因此不受站点页面规则影响。
  const { scope, exclude } = getSiteRules(location.hostname);
  if (rootEl && withinAny(rootEl, exclude)) return out;

  // skipTranslated: false —— 已翻译单元（data-pt="done"）的子树仍要访问：
  // 单元自身由 D6 跳过，但其内新增的段落（原文容器之外）仍被采集（#179）。
  // 遍历模块在每一层递归（含 shadow 边界内侧）都调用本回调，
  // 隐藏单元回调因此处处可用（#317）。
  walkShadowTree(
    root as ParentNode,
    (el) => {
      try {
        if (exclude.some((sel) => el.matches(sel))) return 'skip-subtree';

        // R2 整棵子树拒绝：SKIP_SET（button/code/script 等）。
        // 根元素除外 —— 根是 body 时旧语义仍遍历其子树（acceptNode
        // 不作用于 TreeWalker 根节点）
        if (el !== rootEl && SKIP_SET.has(el.tagName.toLowerCase())) {
          return 'skip-subtree';
        }

        // S2 限定范围：范围外不采集，也不做 pre 切块等 DOM 改动
        if (!inScope(el, scope)) return 'continue';

        // D1 域名补丁（skip 优先于通用判定）：跳过自身继续子树
        const patched = applyCompat(el);
        if (patched && 'skip' in patched) return 'continue';
        // D2 域名补丁（take）：改指收为单元，继续遍历
        if (patched && 'take' in patched) {
          out.push(patched.take);
          return 'continue';
        }

        // D3 #65：超大纯文本 pre（如 GitHub README 的 .plain > pre）按空行
        // 切块，块是独立翻译单元（切块本身由 D4 的 pt-chunk 判定采集）。
        // 代码块判定（isCodeBlockPre）是唯一站点相关部分（#64）。
        if (el.tagName === 'PRE') splitPre(el as HTMLPreElement);

        // D4 翻译单元查表（首步只是一次标签查表）：非单元跳过自身继续子树
        if (!isTranslationUnit(el)) return 'continue';

        // D5 #50：含媒体/交互控件的容器不能整体翻译（render 会拒绝），
        // 跳过自身继续子树 —— 其纯文本后代（不含非文本内容）仍可采集
        if (hasNonTextContent(el)) return 'continue';

        // D6 非视觉跳过：notranslate / 已翻译单元自身（.pt-origin 内不重复
        // 翻）/ 扩展 UI / 非正文区 / 文本长度。跳过自身继续子树
        if (shouldSkipNonVisual(el)) return 'continue';

        // D7 #23：不可见翻译单元记入延迟队列，等 IntersectionObserver 补翻
        if (!isVisible(el)) {
          onHidden?.(el);
          return 'continue';
        }

        // D8 #454：去掉保留原文后没有可翻译的文字 —— 不算翻译单元。放在
        // 最后：只对已通过上面各项检查的候选段落做一次文本提取。隐藏单元
        // 变为可见后经 observer 重新采集，届时同样判定
        if (!hasTranslatableText(el)) return 'continue';

        out.push(el);
      } catch {
        // #54：属性访问抛 DOMException → 跳过自身继续子树，采集不中断
      }
      return 'continue';
    },
    { skipTranslated: false },
  );

  return out;
}
