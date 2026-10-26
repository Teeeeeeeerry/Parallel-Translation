// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译单元（#1145，父 #1138）：“页面上哪些元素是翻译单元、每个单元送翻哪些
// 文字”只在这里回答。对外三个入口：
//
// - collect：采集整页（或一棵子树）的翻译单元 —— 全页翻译、增量补翻、闸门取样
// - closestUnit：找离某个元素最近的翻译单元 —— 逐段翻译（按钮、快捷键）
// - unitText：取一个单元的送翻文字与保留原文的占位符表
//
// 两条判定路径共用同一套顺序（ADR-0003：站点名单 → 限定范围 → 排除与保留
// 原文 → compat 代码层 → 通用判定），站点页面规则在每次采集或查找开头取一次
// 快照（rules-snapshot），取文按单元取回这份快照；“只取直接文字”由取文自己
// 判断（#1137）。调用方不传规则、不传 shallow。
//
// 模块之间单向依赖：判定的标签表与谓词（classify）、取文（text）、切分
// （chunk-split / br-split / pre-split）互不反向 import，都由本模块与采集
// （walker）装配。

import {
  hasNonTextContent,
  inScope,
  isTranslationUnit,
  shouldSkip,
  withinAny,
} from './classify';
import { applyCompat } from './compat';
import { splitBrParagraph } from './br-split';
import { closestChunk, isSplitContainer } from './chunk-marks';
import { hasTranslatableText, unitTextEx } from './text';
import { noteUnitRules, readRulesSnapshot, unitRules, type RulesSnapshot } from './rules-snapshot';

export { collect } from './walker';

/**
 * 一个单元送去翻译的文字（含保留原文的占位符）与占位符表，已归一化。整页
 * 翻译与逐段翻译共用；规则用采集或查找这个单元时的那份快照。
 */
export function unitText(unit: Element): { text: string; preserves: Map<string, string> } {
  return unitTextEx(unit, unitRules(unit));
}

/** compat 代码层说这个元素不是单元（skip，或改指到别处）。 */
function compatSkips(el: Element): boolean {
  return applyCompat(el) !== null;
}

/**
 * 从含非文本内容的容器向下搜索，找到子树里真正持有文本的纯文本翻译单元。
 *
 * #50：命中非文本内容时，与其返回 null，不如继续向下找到那个叶子单元 ——
 * 这直接决定 PR 页那 5193 字符是“翻不了”还是“翻得了”。
 */
function findTextOnlyDescendant(
  container: Element,
  origin: Element,
  rules: RulesSnapshot,
): Element | null {
  let best: Element | null = null;
  let bestDepth = -1;

  // 只在含 origin 的分支里搜索，避免扫到无关兄弟子树
  function dfs(el: Element, depth: number): void {
    if (
      el !== container &&
      el.contains(origin) &&
      isTranslationUnit(el) &&
      !compatSkips(el) &&
      !hasNonTextContent(el) &&
      !shouldSkip(el) &&
      hasTranslatableText(el, rules)
    ) {
      // 越深越好 —— leaf-most text-only unit
      if (depth > bestDepth) {
        best = el;
        bestDepth = depth;
      }
    }
    for (const child of el.children) {
      if (child.contains(origin)) dfs(child, depth + 1);
    }
  }

  dfs(container, 0);
  return best;
}

/**
 * 从 el（含自身）向上找最近的翻译单元（isTranslationUnit + shouldSkip）。
 * 按钮路径与 translateOne 共用 —— 判定标准与采集器同一套，不再各立门户，
 * 白名单之外的大容器（如 AI 概览的外层 li）不会再被错误命中。
 *
 * #50：同时检查非文本内容（媒体 / 交互控件），与 render() 准入标准一致。
 * 若命中则向下降级到子树中真正持有文本的叶子单元，而非整块放弃。
 *
 * shouldSkip 有强制同步布局的昂贵步骤（getBoundingClientRect），
 * 只应在低频率路径调用：悬停意图计时器、点击/快捷键入口，不能挂在
 * 每次 mouseover 上。
 *
 * #366：站点页面规则作用于逐段翻译 —— el 落在排除区内（自身或祖先命中
 * 排除选择器，祖先越过 Shadow DOM 边界，#442）时找不到单元，不出按钮也不翻译。向下降级只在含 el 的分支
 * 里找，结果必是 el 的祖先或自身，同样在排除区外，无需再判。
 *
 * #374：限定范围与采集入口一致 —— 找到的单元须在范围内。向上找时一旦
 * 走出范围即停：范围外元素的祖先同样在范围外。向下降级的结果在 cur
 * 与 el 之间，cur 在范围内它也在。
 *
 * #454：与采集入口共用“去掉保留原文后是否还有可翻译文字”的判定。
 * #468：站点页面规则只在开头读取一次，向上、向下找单元时都用它。
 *
 * #1145：compat 代码层同样生效，判定顺序与采集一致（ADR-0003）：补丁说
 * skip 的元素不是单元，继续向上找；补丁改指（take）的单元含起点时直接
 * 就是它。
 */
/** 已按行切过的段落（pre 的切块另走自己的路，不在此列）。 */
function isBrSplit(el: Element): boolean {
  return el.tagName !== 'PRE' && isSplitContainer(el);
}

export function closestUnit(el: Element): Element | null {
  const rules = readRulesSnapshot();
  const unit = findClosestUnit(el, rules);
  // #1144：逐段翻译随后取文，按单元取回这份快照
  if (unit) noteUnitRules(unit, rules);
  return unit;
}

function findClosestUnit(el: Element, rules: RulesSnapshot): Element | null {
  const { scope, exclude } = rules;
  if (withinAny(el, exclude)) return null;

  let cur: Element | null = el;
  while (cur) {
    if (!inScope(cur, scope)) return null;
    // D1/D2 compat 代码层：与采集同一步、同一张处理表
    const patched = applyCompat(cur);
    if (patched && 'take' in patched) {
      if (patched.take.contains(el)) return patched.take;
      cur = cur.parentElement;
      continue;
    }
    if (patched) {
      cur = cur.parentElement;
      continue;
    }
    // #712：以 br 分行的超长段落整段当不了单元。走到它这里（起点在它里面，
    // 还没找到单元）就按行切开，返回起点所在那一行的切块：逐段翻译只翻悬停
    // 的那一行，不是整段几千字。起点落在段落自身（行间空白，或切开之前段落
    // 的直接文字）就没有单元，直接返回：外层容器的文字只会更长，往上找也是
    // 白找。
    // 切分只在这里发生：本函数只在悬停意图计时器、按钮点击、快捷键这些低频
    // 路径上调用，mouseover 处理只做 closest() 初筛（paragraph-btn.ts）
    if (splitBrParagraph(cur) || isBrSplit(cur)) {
      const line = closestChunk(el);
      if (!line || line.parentElement !== cur) return null;
      return !shouldSkip(line) && hasTranslatableText(line, rules) ? line : null;
    }
    // #454：去掉保留原文后没有可翻译文字的段落不算单元，继续向上找
    if (isTranslationUnit(cur) && !shouldSkip(cur) && hasTranslatableText(cur, rules)) {
      // #50：容器含媒体 / 交互控件时，向下降级到纯文本后代。
      // 否则用户看到一个注定失败的段落按钮，等一次网络往返后被 render() 拒绝。
      if (hasNonTextContent(cur)) {
        const descendant = findTextOnlyDescendant(cur, el, rules);
        if (descendant) return descendant;
        // 无纯文本后代 —— 继续向上找，避免把含非文本内容的容器
        // 误判为可翻单元（它会回到这里再次尝试向下降级）。
      } else {
        return cur;
      }
    }
    cur = cur.parentElement;
  }
  return null;
}
