// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 9 — 提取可翻译文本（跳过 .notranslate 与站点元数据子树）。
//
// 单元文本不能直接取 textContent：Google AI 概览的来源角标（chip）是
// UI 元数据不是正文，混进译文就是“YouTube·Tech +2”这类噪声。规则分两层：
// - .notranslate 类：HTML 标准约定（Google 翻译同样尊重），通用
// - shouldOmitText()：域名补丁（compat.ts），站点的特定元数据
// - 保留原文：#58 占位符机制，用户名等标识符不翻译但保留原文。先按站点
//   页面规则的排除（#441）与保留原文（#369）选择器（数据），再按 compat
//   代码层判定

import { shouldOmitText, shouldPreserveText } from './compat';
import { isInlineTag, isVisible, isVisuallyHidden } from './classify';
import { getSiteRules } from '~/src/storage/specialization';
import { normalizeLines, normalizePreText } from './normalize';
import type { SiteRules } from '~/src/storage/specialization';

/**
 * Preserve 占位符格式：⟦PT0⟧、⟦PT1⟧ ...
 * 使用 U+27E6/U+27E7 数学括号 + "PT" 前缀 + 自增索引。
 * 这些 Unicode 字符极少出现在自然文本中，各翻译引擎通常原样透传。
 */
const PLACEHOLDER_RE = /⟦PT\d+⟧/g;
const PLACEHOLDER_PREFIX = '⟦PT';
const PLACEHOLDER_SUFFIX = '⟧';

/** 提取送翻文本用到的站点页面规则：排除与保留原文 */
export type TextRules = Pick<SiteRules, 'exclude' | 'preserve'>;

interface PreserveMap {
  placeholders: Map<string, string>; // ⟦PT0⟧ → 原文
  nextIndex: number;
  /** 当前站点的排除与保留原文选择器 */
  rules: TextRules;
  /** #595 / #600：提取时跳过了看不见的元素（skipHidden） */
  hiddenSkipped: boolean;
  /**
   * #840：br 作为换行带出去，文本节点里的空白（源码换行、缩进）当场折叠成
   * 空格 —— 送翻文字里的 \n 只来自 br。pre 里的单元不开（靠硬换行）
   */
  brNewlines?: boolean;
}

/**
 * rules 为调用方已读取的站点页面规则（#468：采集入口一次采集只读一次）；
 * 不传时按当前站点读取一次。
 */
function makePreserveMap(rules?: TextRules): PreserveMap {
  const { exclude, preserve } = rules ?? getSiteRules(location.hostname);
  return {
    placeholders: new Map(),
    nextIndex: 0,
    rules: { exclude, preserve },
    hiddenSkipped: false,
  };
}

function makePlaceholder(idx: number): string {
  return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
}

/**
 * 排除与保留原文在提取送翻文本时的行内元素判定与采集一致：白名单标签与
 * 自定义元素（标签名含连字符）。浏览器默认把后者按行内渲染，Web Component
 * 渲染的用户名、频道名常写在句子中间。
 */
function isInline(el: Element): boolean {
  return isInlineTag(el.tagName.toLowerCase());
}

/**
 * 元素应保留的原文，或 null 表示不保留。只对行内元素生效（isInline）。
 * 判定顺序（ADR-0003）：站点页面规则的排除 → 保留原文 → compat 代码层。
 *
 * #441：段落里命中排除的行内元素同样原文保留 —— 段落照常采集，排除的
 * “整块不翻译”落到行内元素上就是不送翻、原样留在译文句子里。不从译文
 * 里去掉：“仅译文”显示模式下那样会丢内容。同时命中排除与保留原文时
 * 结果相同，“排除优先”在行内元素上不再有冲突。块级元素的排除由采集
 * 入口整块跳过；段落里命中排除的块级子元素在提取时整块跳过（#456）。
 */
function preservedText(
  el: Element,
  rules: Pick<SiteRules, 'exclude' | 'preserve'>,
): string | null {
  if (!isInline(el)) return null;
  const hit = (sels: string[]) => sels.some((sel) => el.matches(sel));
  if (hit(rules.exclude) || hit(rules.preserve)) {
    return el.textContent?.trim() || null;
  }
  return shouldPreserveText(el);
}

/**
 * 提取元素的全部可翻译文本（含 preserve 占位符）。
 * 返回占位符文本与原文映射表，供译文回填时替换。
 *
 * 遍历逻辑与 translatableText() 相同，额外在遇到 preserve 节点时
 * 写入占位符并记录映射。rules 见 makePreserveMap。
 */
export function translatableTextEx(el: Element, rules?: TextRules): {
  text: string;
  preserves: Map<string, string>;
} {
  const pm = makePreserveMap(rules);
  const text = walkTranslatable(el, pm);
  return { text, preserves: pm.placeholders };
}

/**
 * 一个翻译单元送去翻译的文字（含 preserve 占位符）与占位符映射表，已归一化。
 * 整页翻译与逐段翻译共用。含带文字的块级子元素的混合内容单元（#23）只取
 * 直接文字，子块各自作为单元另外采集；#1137：这一判断在这里做，原先要调用方
 * 传，逐段翻译那条路径没传，把子块的文字也一起送翻。
 *
 * - pre 里的单元（.pt-chunk / 纯文本 pre）保留硬换行与缩进（#117、#141）
 * - 其余单元折叠空白；#840：br 作为换行带出去，整段一个单元的诗、地址、
 *   #768 之后不再按行切的链接多的 br 段落，译文在同样的位置换行。引擎对
 *   换行普遍原样保留（google-web 逐段请求；编号提示词的引擎压成一行，见
 *   buildNumberedPrompt，译文退回不分行，不会错位）
 */
export function unitTextEx(
  el: Element,
  opts: { rules?: TextRules } = {},
): { text: string; preserves: Map<string, string> } {
  const inPre = el.closest('pre') !== null;
  const pm = makePreserveMap(opts.rules);
  pm.brNewlines = !inPre;
  const raw = hasBlockTextChildren(el) ? walkShallow(el, pm) : walkTranslatable(el, pm);
  return {
    text: inPre ? normalizePreText(raw) : normalizeLines(raw),
    preserves: pm.placeholders,
  };
}

/**
 * 提取元素的全部可翻译文本：递归遍历子节点，跳过 .notranslate 与
 * 站点元数据子树。无忽略规则时与 textContent 等价。
 */
export function translatableText(el: Element): string {
  return walkTranslatable(el, null);
}

/**
 * 提取时跳过的看不见的元素：读屏专用的隐藏文字（#595），以及段落可见时
 * 里面不可见的后代（#600，宽高都为 0、display:contents 除外，与翻译单元
 * 的可见性判定相同）—— 例如未打开的悬停提示。不送翻，原文留在原位，回填
 * 时也不出现在译文里。段落本身不可见时（#23 的延迟补翻，或采集后又被
 * 隐藏）不跳过它的不可见后代，行为不变。
 */
function skipHidden(el: Element, unitVisible: boolean): boolean {
  return isVisuallyHidden(el) || (unitVisible && !isVisible(el));
}

/** 文本节点的文字；br 当换行时空白当场折叠，源码里的换行不冒充 br（#840）。 */
function textOf(node: Node, pm: PreserveMap | null): string {
  const text = node.textContent ?? '';
  return pm?.brNewlines ? text.replace(/\s+/g, ' ') : text;
}

/** 共享遍历实现：pm 为 null 时不启用 preserve（向后兼容） */
function walkTranslatable(el: Element, pm: PreserveMap | null): string {
  let out = '';
  const unitVisible = isVisible(el);
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += textOf(child, pm);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child as Element;
        if (pm?.brNewlines && c.tagName === 'BR') {
          out += '\n';
          continue;
        }

        // #595 / #600：看不见的文字不送翻 —— 译文不继承隐藏样式，会把原本
        // 看不见的文字显示出来。原文留在原位，读屏软件照常朗读
        if (skipHidden(c, unitVisible)) {
          if (pm) pm.hiddenSkipped = true;
          continue;
        }

        // #58 preserve：不翻译但保留原文（用户名等标识符）
        if (pm) {
          const preserved = preservedText(c, pm.rules);
          if (preserved) {
            const ph = makePlaceholder(pm.nextIndex);
            pm.placeholders.set(ph, preserved);
            pm.nextIndex++;
            out += ' ';
            out += ph;
            out += ' ';
            continue;
          }
        }

        // #456：命中排除、没有按原文保留的元素（块级元素）整块跳过，
        // 与 .notranslate 相同 —— 全页翻译的浅层提取本就不送段落里的
        // 块级子元素，逐段翻译的完整提取与它一致
        if (pm && pm.rules.exclude.some((sel) => c.matches(sel))) continue;
        if (c.classList.contains('notranslate')) continue;
        if (shouldOmitText(c)) continue;
        // 元素子节点之间补空格，防止源 HTML 中相邻元素无空白时
        // textContent 把末字与首字粘在一起（如 "CertifiedProfessional"，#22）。
        // normalizeText 会将多余空白折叠为单个空格，多余的不会到达引擎。
        out += ' ';
        walk(c);
        out += ' ';
      }
    }
  };
  walk(el);
  return out;
}

/**
 * 浅层提取：只取直接文本节点与内联子元素的文本，跳过块级子元素。
 *
 * #23 混合内容元素专用 —— 对 `<li>标签文字<ul><li>子条目</li></ul></li>`
 * 只提取“标签文字”，子条目由各自的翻译单元独立翻译，避免重复。
 */
export function shallowTranslatableText(el: Element): string {
  return walkShallow(el, null);
}

/** 含 preserve 的浅层提取变体。rules 见 makePreserveMap。 */
export function shallowTranslatableTextEx(el: Element, rules?: TextRules): {
  text: string;
  preserves: Map<string, string>;
} {
  const pm = makePreserveMap(rules);
  const text = walkShallow(el, pm);
  return { text, preserves: pm.placeholders };
}

function walkShallow(el: Element, pm: PreserveMap | null): string {
  let out = '';
  const unitVisible = isVisible(el);
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += textOf(child, pm);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as Element;
      const tag = c.tagName.toLowerCase();
      if (pm?.brNewlines && tag === 'br') {
        out += '\n';
        continue;
      }

      // 跳过块级子元素 —— 它们的文本由各自翻译单元覆盖
      if (!isInlineTag(tag)) continue;

      // #595 / #600：看不见的文字不送翻，同完整提取
      if (skipHidden(c, unitVisible)) {
        if (pm) pm.hiddenSkipped = true;
        continue;
      }

      // #58 preserve
      if (pm) {
        const preserved = preservedText(c, pm.rules);
        if (preserved) {
          const ph = makePlaceholder(pm.nextIndex);
          pm.placeholders.set(ph, preserved);
          pm.nextIndex++;
          out += ' ';
          out += ph;
          out += ' ';
          continue;
        }
      }

      if (c.classList.contains('notranslate')) continue;
      if (shouldOmitText(c)) continue;
      out += ' ';
      out += walkTranslatable(c, pm); // 内联元素全递归
      out += ' ';
    }
  }
  return out;
}

/**
 * 元素是否含有带文本的非内联子元素（即混合内容元素）。
 * 此类元素在整页翻译时应使用 shallowTranslatableText，
 * 避免把嵌套子条目的文本重复翻译进父单元。
 */
export function hasBlockTextChildren(el: Element): boolean {
  for (const child of el.children) {
    const tag = child.tagName.toLowerCase();
    if (isInlineTag(tag)) continue;
    if (child.textContent?.trim()) return true;
  }
  return false;
}

/** 可翻译的字符：不是空白、标点、符号或数字 */
const TRANSLATABLE_CHAR_RE = /[^\s\p{P}\p{S}\p{N}]/u;

/**
 * 元素的直接文本节点里有没有可翻译字符（#821）。只看直接子节点，不读布局、
 * 不匹配选择器。字面上带占位符括号的文字一律不算：完整判定会先去掉占位符
 * 样式的片段再看，这里不替它下结论。
 */
function ownTextIsTranslatable(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const text = child.textContent ?? '';
    if (text.includes(PLACEHOLDER_PREFIX[0]!) || text.includes(PLACEHOLDER_SUFFIX)) return false;
    if (TRANSLATABLE_CHAR_RE.test(text)) return true;
  }
  return false;
}

/**
 * #454：段落去掉保留原文后是否还有可翻译的文字。按全页翻译的提取方式
 * 取送翻文本（含带文字的块级子元素时走浅层提取），去掉占位符后只剩
 * 空白、标点、符号或数字即没有 —— 送去引擎只会原样回来，对照模式下
 * 同一段文字显示两遍。采集入口与逐段翻译入口共用这一判定。
 *
 * #595 / #600：看不见的文字同样去掉 —— 段落自身视觉上隐藏，或去掉读屏
 * 隐藏文字、不可见的后代之后没有可翻译的文字，都不算翻译单元。
 *
 * 既没有保留原文、也没有跳过看不见的文字的段落不在本判定范围内，一律返回 true：
 * 纯数字等短文本由通用判定（shouldSkipNonVisual）处理，.notranslate 与
 * compat omit 的语义不变。
 *
 * #468：两个入口把开头读取的站点页面规则传进来，逐段判定不再重复读取。
 */
export function hasTranslatableText(el: Element, rules?: TextRules): boolean {
  if (isVisuallyHidden(el)) return false;
  // #821：段落自己的直接文字里有可翻译字符，结论就是“有” —— 保留原文、排除、
  // 看不见的后代都只去掉后代元素里的文字，直接文字一定留在送翻文本里。不必
  // 再把整棵子树走一遍：那一遍对每个后代元素读一次布局、匹配一遍保留原文与
  // 排除的选择器，是悬停精判与整页采集七成的开销（#737 实测）
  if (ownTextIsTranslatable(el)) return true;
  const pm = makePreserveMap(rules);
  const text = hasBlockTextChildren(el) ? walkShallow(el, pm) : walkTranslatable(el, pm);
  if (pm.placeholders.size === 0 && !pm.hiddenSkipped) return true;
  return TRANSLATABLE_CHAR_RE.test(text.replace(PLACEHOLDER_RE, ''));
}

/**
 * 译文回填：将占位符替换回原文。
 *
 * 安全降级：若译文中占位符数量/序号与原文不符（引擎破坏了占位符），
 * 返回原始文本而非含破碎占位符的译文 —— 用户绝不会见到 ⟦PT0⟧ 残留。
 *
 * @param translation 引擎返回的译文
 * @param preserves 占位符 → 原文映射表
 * @param originalText 发往引擎前的原文（含占位符），用于校验
 * @returns 还原后的译文，或降级返回的原始无占位符文本
 */
export function restorePreserves(
  translation: string,
  preserves: Map<string, string>,
  originalText: string,
): string {
  if (preserves.size === 0) return translation;

  // 统计原文中的占位符
  const origPlaceholders = originalText.match(PLACEHOLDER_RE) ?? [];

  // 统计译文中的占位符
  const transPlaceholders = translation.match(PLACEHOLDER_RE) ?? [];

  // 数量或序号不一致 → 引擎破坏了占位符，降级
  if (origPlaceholders.length !== transPlaceholders.length) {
    console.debug(
      '[PT] preserve 降级：占位符数量不匹配',
      { orig: origPlaceholders, trans: transPlaceholders },
    );
    return restoreFallback(originalText, preserves);
  }

  for (let i = 0; i < origPlaceholders.length; i++) {
    if (origPlaceholders[i] !== transPlaceholders[i]) {
      console.debug(
        '[PT] preserve 降级：占位符序号不匹配',
        { orig: origPlaceholders[i], trans: transPlaceholders[i] },
      );
      return restoreFallback(originalText, preserves);
    }
  }

  // 全部匹配 → 安全替换
  let result = translation;
  for (const [ph, orig] of preserves) {
    // #173: 必须用函数替换器 —— orig 含 $& / $' / $` / $1 等序列时，
    // 字符串替换参数会被 String.replace 当作替换模式展开，产生与原文
    // 不同的字符。函数返回值不做任何模式解释。
    result = result.replace(ph, () => orig);
  }
  return result;
}

/** 降级：从含占位符的原文中还原出无占位符的原始文本 */
function restoreFallback(
  placeholderText: string,
  preserves: Map<string, string>,
): string {
  let result = placeholderText;
  for (const [ph, orig] of preserves) {
    // #173: 函数替换器，避免 orig 中的 $ 序列被当作替换模式展开
    result = result.replace(ph, () => orig);
  }
  return result;
}
