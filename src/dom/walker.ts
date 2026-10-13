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
//   - 以 br 分行的超长段落按行切块（src/dom/br-split.ts，#706）
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
//   - D3 pre 切块、超长段落按 br 切行（#706）—— 切块自身被采集为独立单元
//   - D4-D7 非单元 / 非文本容器 / 非视觉 / 不可见 —— 跳过自身继续子树
//   - D8 去掉保留原文后没有可翻译的文字（#454）—— 跳过自身继续子树

import {
  SKIP_SET,
  nonVisualSkipReason,
  type NonVisualSkip,
  isVisible,
  isTranslationUnit,
  hasNonTextContent,
  inScope,
  withinAny,
} from './classify';
import { applyCompat } from './compat';
import { getSiteRules } from '~/src/storage/specialization';
import { splitPre } from './pre-split';
import { splitBrParagraph } from './br-split';
import { hasTranslatableText } from './text';
import { walkShadowTree } from './shadow-walk';

/**
 * 被跳过的单元按原因分的类（#754）。每一类对应既有跳过判定里的一个或几个
 * 分支，不另加判定：
 * - too-long：文字超过长度上限（MAX_TEXT）
 * - too-complex：标记复杂度超限（子树元素个数兜底，MAX_ELEMENTS）
 * - site-rule：被站点页面规则的排除或域名补丁的 skip 挡下
 * - other：采集时属性访问抛异常（#54）
 *
 * #754 定的第五类“被判为非正文区域”（NON_CONTENT）在 #756 起不计入跳过，
 * 与扩展自己的 UI、已翻译的单元一样；不可见的单元（#755）与限定范围之外的
 * 内容（#757）也不计入。见 skipCategory。
 */
export type SkipCategory = 'too-long' | 'too-complex' | 'site-rule' | 'other';

/** 采集遍历里一个候选元素没被采到，是在哪一步被挡下的。 */
export type SkipSource =
  | { step: 'non-visual'; reason: NonVisualSkip }
  | { step: 'site-exclude' }
  | { step: 'compat-skip' }
  | { step: 'hidden' }
  | { step: 'error' };

/**
 * 这一步算不算“被跳过”、算哪一类（#753、#754）。纯函数，算作跳过的口径
 * 只在这里：这个单元有正文，却没进入待翻列表。返回 null 的本来就不是要翻
 * 的东西（太短、纯数字、代码、标记了不翻、可编辑区、切块容器），算进去
 * 正常页面上也会报出一大串。
 */
export function skipCategory(source: SkipSource): SkipCategory | null {
  switch (source.step) {
    case 'non-visual':
      switch (source.reason) {
        case 'too-long':
          return 'too-long';
        case 'too-complex':
          return 'too-complex';
        // #756：非正文区域（导航、页脚、侧栏、参考文献）本来就不该翻；扩展
        // 自己插的译文与界面本来就不该被翻；已翻译的单元不是漏翻，增量补翻
        // 时还会反复经过采集。都不算跳过，算进去等于自己制造噪声
        case 'non-content':
        case 'extension-ui':
        case 'translated':
          return null;
        default:
          return null;
      }
    case 'site-exclude':
    case 'compat-skip':
      return 'site-rule';
    case 'hidden':
      // #755：不可见的单元进延迟队列，等可见了由观察器补翻 —— 不是被丢掉，
      // 是还没轮到。算进去提示会虚高，用户以为丢了内容
      return null;
    case 'error':
      return 'other';
  }
}

export interface CollectOptions {
  /**
   * 只读采集（#843）：页面级闸门取样用，不切块、不改动页面。
   */
  readOnly?: boolean;
  /**
   * 每跳过一个有正文的单元调用一次（#753），带上原因的分类（#754）。统计在遍历里顺带产生：只用跳过
   * 判定本来就算出的结果，不额外序列化 DOM、不额外读布局，不改变采集结果。
   * 不传就什么都不发生。
   */
  onSkip?: (el: Element, category: SkipCategory) => void;
}

/**
 * 采集可翻译节点。
 * TreeWalker 不会自动进入 shadowRoot，必须显式递归。
 *
 * #753：被跳过的单元经 opts.onSkip 报出，返回值仍是采到的单元 —— 不改返回
 * 类型，整页翻译、增量补翻、闸门取样这几处调用方不必跟着改。
 */
export function collect(
  root: Node = document.body,
  onHidden?: (el: Element) => void,
  opts: CollectOptions = {},
): Element[] {
  const out: Element[] = [];
  const onSkip = opts.onSkip;
  /** 报一次跳过：这一步算作跳过才报。 */
  const skipped = (el: Element, source: SkipSource) => {
    if (!onSkip) return;
    const category = skipCategory(source);
    if (category) onSkip(el, category);
  };
  /**
   * 结构判定之前就被挡下的（排除、范围外、补丁 skip、抛异常）：结构上是一个
   * 单元才报。只在要统计时才问，标签查表打头，不读布局。
   */
  const skipUnit = (el: Element, source: SkipSource) => {
    if (onSkip && isTranslationUnit(el)) skipped(el, source);
  };

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
  // #468：一次采集只读一次，这次采集里的所有判定都用它
  const rules = getSiteRules(location.hostname);
  const { scope, exclude } = rules;
  if (rootEl && withinAny(rootEl, exclude)) return out;

  // skipTranslated: false —— 已翻译单元（data-pt="done"）的子树仍要访问：
  // 单元自身由 D6 跳过，但其内新增的段落（原文容器之外）仍被采集（#179）。
  // 遍历模块在每一层递归（含 shadow 边界内侧）都调用本回调，
  // 隐藏单元回调因此处处可用（#317）。
  walkShadowTree(
    root as ParentNode,
    (el) => {
      try {
        if (exclude.some((sel) => el.matches(sel))) {
          skipUnit(el, { step: 'site-exclude' });
          return 'skip-subtree';
        }

        // R2 整棵子树拒绝：SKIP_SET（button/code/script 等）。
        // 根元素除外 —— 根是 body 时旧语义仍遍历其子树（acceptNode
        // 不作用于 TreeWalker 根节点）
        if (el !== rootEl && SKIP_SET.has(el.tagName.toLowerCase())) {
          return 'skip-subtree';
        }

        // S2 限定范围：范围外不采集，也不做 pre 切块等 DOM 改动
        // #757：范围外不算跳过 —— 限定范围是用户自己设的，范围外不翻是预期，
        // 不是漏翻。也就不必为了统计去问它是不是单元
        if (!inScope(el, scope)) return 'continue';

        // D1 域名补丁（skip 优先于通用判定）：跳过自身继续子树
        const patched = applyCompat(el);
        if (patched && 'skip' in patched) {
          skipUnit(el, { step: 'compat-skip' });
          return 'continue';
        }
        // D2 域名补丁（take）：改指收为单元，继续遍历
        if (patched && 'take' in patched) {
          out.push(patched.take);
          return 'continue';
        }

        // D3 #65：超大纯文本 pre（如 GitHub README 的 .plain > pre）按空行
        // 切块，块是独立翻译单元（切块本身由 D4 的 pt-chunk 判定采集）。
        // 代码块判定（isCodeBlockPre）是唯一站点相关部分（#64）。
        // #706：以 br 分行、超过长度上限的段落按行切块，否则整段被长度上限
        // 静默丢掉；拒切条件（块级子元素、代码块上下文等）在 splitBrParagraph 里
        // #843：只读采集（页面级闸门取样）不切块 —— 切块会改动页面，闸门命中
        // 时页面必须一个字不动。不切的超长段落随后被长度上限跳过，样本里没有它
        if (!opts.readOnly) {
          if (el.tagName === 'PRE') splitPre(el as HTMLPreElement);
          else splitBrParagraph(el);
        }

        // D4 翻译单元查表（首步只是一次标签查表）：非单元跳过自身继续子树
        if (!isTranslationUnit(el)) return 'continue';

        // D5 #50：含媒体/交互控件的容器不能整体翻译（render 会拒绝），
        // 跳过自身继续子树 —— 其纯文本后代（不含非文本内容）仍可采集
        if (hasNonTextContent(el)) return 'continue';

        // D6 非视觉跳过：notranslate / 已翻译单元自身（.pt-origin 内不重复
        // 翻）/ 扩展 UI / 非正文区 / 文本长度。跳过自身继续子树
        const skip = nonVisualSkipReason(el);
        if (skip) {
          skipped(el, { step: 'non-visual', reason: skip });
          return 'continue';
        }

        // D7 #23：不可见翻译单元记入延迟队列，等 IntersectionObserver 补翻
        if (!isVisible(el)) {
          onHidden?.(el);
          skipped(el, { step: 'hidden' });
          return 'continue';
        }

        // D8 #454：去掉保留原文后没有可翻译的文字 —— 不算翻译单元。放在
        // 最后：只对已通过上面各项检查的候选段落做一次文本提取。隐藏单元
        // 变为可见后经 observer 重新采集，届时同样判定
        if (!hasTranslatableText(el, rules)) return 'continue';

        out.push(el);
      } catch {
        // #54：属性访问抛 DOMException → 跳过自身继续子树，采集不中断。
        // 判不了是不是单元（再抛一次）就不算跳过
        try {
          skipUnit(el, { step: 'error' });
        } catch {
          // 同上
        }
      }
      return 'continue';
    },
    { skipTranslated: false },
  );

  return out;
}
