// Phase 8 — 域名级采集补丁。
// 仅在通用 walker 判断有误时才添加条目 —— 这是兜底层，不是主路径。
// 每加一条都意味着一处通用逻辑的缺陷，先问"能不能改进通用规则"。
//
// 补丁只做两件事：跳过(skip)、改指(take)。不在此处写翻译逻辑或 DOM 操作。

import { INLINE_SET } from './classify';

type CompatResult =
  | { skip: true }
  | { take: Element }
  | null; // 无意见，交回通用逻辑

type CompatHandler = (el: Element) => CompatResult;

type OmitHandler = (el: Element) => boolean;

// ---- 通用行内角标检测 ----

/** Favicon 尺寸上限（像素），超过此值视为内容图片而非角标图标 */
const MAX_FAVICON_PX = 24;

/** 角标文字长度上限（字符），超过此值视为正文片段而非角标 */
const MAX_BADGE_TEXT = 40;

/**
 * 元素是否包含 favicon 尺寸的图片（任一边 ≤ MAX_FAVICON_PX）。
 * 来源角标通常内嵌站点 favicon，而正文内链不含此类小图。
 */
function hasFaviconImage(el: Element): boolean {
  const imgs = el.querySelectorAll('img');
  for (const img of imgs) {
    const rect = img.getBoundingClientRect();
    if (
      (rect.width > 0 && rect.width <= MAX_FAVICON_PX) ||
      (rect.height > 0 && rect.height <= MAX_FAVICON_PX)
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

  // 信号 1：以 +N 结尾（"+3"、"+5 more"、"+10条"）
  if (/\+\d+/.test(text)) return true;

  // 信号 2：交互角色 + favicon 尺寸图片
  const hasInteractiveRole =
    el.matches('[role="button"], [role="link"]') || tag === 'a';
  if (hasInteractiveRole && hasFaviconImage(el)) return true;

  return false;
}

// ---- 域名精修补丁 ----

/**
 * 取主域名（末两段）。
 * news.ycombinator.com → ycombinator.com
 * 对绝大多数站点够用；co.uk 级多级后缀若真遇到再特判。
 */
export function mainDomain(host: string): string {
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

const HANDLERS: Record<string, CompatHandler> = {
  'youtube.com': (el: Element) => {
    // 时长、播放量、发布时间等元数据不翻
    if (
      el.matches(
        '.ytd-thumbnail-overlay-time-status-renderer,' +
          '#metadata-line span,' +
          '.ytd-video-meta-block ytd-badge-supported-renderer,' +
          '.ytd-channel-name yt-formatted-string',
      )
    ) {
      return { skip: true };
    }
    return null;
  },

  'github.com': (el: Element) => {
    // 代码行、文件名、commit hash、blob 内容不翻
    if (
      el.closest(
        '.blob-code, .blob-code-inner, ' +
          '.file-info, .file-header, ' +
          '.commit-tease-sha, ' +
          '.commit-message code, ' +
          'pre, ' + // GitHub 的 pre 通常是代码块
          '.highlight, ' +
          '.blame-hunk, ' +
          '.text-mono',
      )
    ) {
      return { skip: true };
    }

    // #49：文件树侧栏（blob 页）、贡献者面板（仓库首页）均为纯 UI 而非正文。
    // 即使 #50 已在采集阶段过滤含非文本内容的容器，提前跳过整棵子树
    // 可避免无效的 translate-unit 判定。
    if (
      el.closest(
        '.file-tree,' +            // blob 页文件树（新版）
        '.js-file-tree,' +         // blob 页文件树（旧版 JS 挂钩）
        '.tree-browser,' +         // blob 页文件树（旧版）
        '.BorderGrid,' +           // 仓库首页贡献者网格
        '.repository-lang-stats,'  // 仓库首页语言统计条
      )
    ) {
      return { skip: true };
    }

    // 行内 code 的短 hash / 变量名 / 纯数字判定（#61-#67）已移除：
    // walker 的 acceptNode 通过 SKIP_SET 先一步拒绝 CODE 节点，
    // applyCompat(el) 永远收不到 CODE，该分支不可达（#41 附带分析）。
    return null;
  },
};

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
