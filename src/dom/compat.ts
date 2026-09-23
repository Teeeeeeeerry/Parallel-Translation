// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 8 — 域名级采集补丁。
// 仅在通用 walker 判断有误时才添加条目 —— 这是兜底层，不是主路径。
// 每加一条都意味着一处通用逻辑的缺陷，先问“能不能改进通用规则”。
//
// 补丁只做两件事：跳过(skip)、改指(take)。不在此处写翻译逻辑或 DOM 操作。

import { INLINE_SET } from './classify';
import { mainDomain } from './site-filter';

type CompatResult =
  | { skip: true }
  | { take: Element }
  | null; // 无意见，交回通用逻辑

type CompatHandler = (el: Element) => CompatResult;

type OmitHandler = (el: Element) => boolean;

/**
 * Preserve 处理器：返回要保留的原文，或 null 表示不保留。
 * 保留文本用占位符替换后送入引擎，译文回填时再将占位符换回原文。
 *
 * 与 omit 的区别：
 *   omit  — 文本完全丢弃，不进入译文（用于来源角标等 UI 元数据）
 *   preserve — 文本不翻译，但原样保留在译文里（用于用户名等标识符）
 */
type PreserveHandler = (el: Element) => string | null;

// ---- 通用行内角标检测 ----

/** Favicon 尺寸上限（像素），超过此值视为内容图片而非角标图标 */
const MAX_FAVICON_PX = 24;

/** 角标文字长度上限（字符），超过此值视为正文片段而非角标 */
const MAX_BADGE_TEXT = 40;

/**
 * 折叠计数角标："+3"、" +12"。+N 必须顶在行首或空白之后、
 * 位于文本末尾 —— 排除 "iPhone 16+128GB"、“电话 +86 123”、“团队+2”
 * 这类正文形态。{1,3} 限制数字位数，应对真实来源折叠计数。
 */
const COUNTER_RE = /(^|\s)\+\d{1,3}$/;

/**
 * 元素是否包含 favicon 尺寸的图片（宽高均 ≤ MAX_FAVICON_PX）。
 * 用 img.width（CSS 渲染宽，未加载时回退 width 属性）而非
 * getBoundingClientRect：不强制同步布局、2x retina（16 CSS px 的
 * 32px 自然宽）仍命中、懒加载未解码的 favicon 也能按属性判定。
 */
function hasFaviconImage(el: Element): boolean {
  const imgs = el.getElementsByTagName('img');
  for (const img of imgs) {
    const w = img.width || img.naturalWidth;
    const h = img.height || img.naturalHeight;
    if (
      w > 0 &&
      w <= MAX_FAVICON_PX &&
      h > 0 &&
      h <= MAX_FAVICON_PX
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 通用行内来源角标识别 —— 跨站生效，不依赖类名。
 *
 * 识别混在正文里的角标 chip（来源链接、"YouTube +3" 等），它们不是
 * 可翻译正文而是 UI 元数据，译文不该包含角标文字，也不应浪费引擎额度。
 *
 * 信号（命中任一即返回 true）：
 * 1. 文本以 +N 结尾 —— 极强信号，正文几乎不会以 "+3" 结尾
 * 2. 交互角色 + favicon 尺寸图片 —— 来源链接 chip 的典型结构
 */
function isGenericInlineBadge(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!INLINE_SET.has(tag)) return false;

  const text = el.textContent?.trim() ?? '';
  if (text.length === 0 || text.length > MAX_BADGE_TEXT) return false;

  // 信号 1：以“行首/空白 + +N”结尾（"+3"、" +12"）
  if (COUNTER_RE.test(text)) return true;

  // 信号 2：交互角色 + favicon 尺寸图片
  const hasInteractiveRole =
    el.matches('[role="button"], [role="link"]') || tag === 'a';
  if (hasInteractiveRole && hasFaviconImage(el)) return true;

  return false;
}

// ---- preserve：不翻译但保留原文（用户名等标识符） ----

const PRESERVE_HANDLERS: Record<string, PreserveHandler> = {
  'github.com': (el: Element) => {
    // 评论正文里的 @mention（a.user-mention）：最高频场景
    if (el.matches('a.user-mention')) {
      return el.textContent?.trim() || null;
    }

    // hovercard 机制多年未变，覆盖几乎所有用户名链接
    if (el.matches('[data-hovercard-url^="/users/"]')) {
      return el.textContent?.trim() || null;
    }

    // 微数据属性：author 关联
    if (el.matches('[rel="author"], [itemprop="author"]')) {
      return el.textContent?.trim() || null;
    }

    return null;
  },
};

/**
 * 元素文本是否应保留原文、不参与翻译。
 * 返回非 null 的保留文本，或 null 表示不保留。
 */
export function shouldPreserveText(el: Element): string | null {
  // 只在内联元素上生效 —— 块级元素走 skip 路径，不在此处判定
  const tag = el.tagName.toLowerCase();
  if (!INLINE_SET.has(tag)) return null;

  const handler = PRESERVE_HANDLERS[mainDomain(location.hostname)];
  if (!handler) return null;
  return handler(el);
}

// ---- 域名精修补丁 ----

// #366 / #367：youtube.com、github.com 的 skip 补丁已迁为内置排除数据
// （src/storage/builtin-site-rules.ts）。本表只收选择器表达不了的逻辑
// （如 take 改指），目前为空。
const HANDLERS: Record<string, CompatHandler> = {};

export function applyCompat(el: Element): CompatResult {
  const handler = HANDLERS[mainDomain(location.hostname)];
  if (!handler) return null;
  return handler(el);
}

/**
 * 提取文本时应剔除的站点元数据（来源角标、计数 chip 等 UI 碎片）。
 * 与 skip 的区别：skip 影响采集器是否收集该节点，这里影响已收集单元的
 * 文本内容 —— AI 概览的来源角标是行内元素，永远当不成单元，只能从
 * 文本层面剔除。
 *
 * 规则分两层：通用行内角标检测（isGenericInlineBadge，跨站）、
 * 域名补丁（本表，精修层）。通用规则覆盖 Bing / DuckDuckGo / Perplexity
 * 等未单独适配但角标形态相同的站点。
 *
 * 类名来自社区抓包记录而非官方文档，Google 改版可能失效 ——
 * 失效时通用规则兜底，角标文字仍会被剔除。
 */
const OMIT_HANDLERS: Record<string, OmitHandler> = {
  'google.com': (el: Element) => el.matches('span.wJwe6c, .WTfRgd'),
};

export function shouldOmitText(el: Element): boolean {
  // 通用行内角标检测（跨站，不依赖类名）
  if (isGenericInlineBadge(el)) return true;

  // 域名精修补丁
  const handler = OMIT_HANDLERS[mainDomain(location.hostname)];
  if (!handler) return false;
  return handler(el);
}
