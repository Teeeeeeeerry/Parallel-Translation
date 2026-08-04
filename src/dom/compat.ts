// Phase 8 — 域名级采集补丁。
// 仅在通用 walker 判断有误时才添加条目 —— 这是兜底层，不是主路径。
// 每加一条都意味着一处通用逻辑的缺陷，先问"能不能改进通用规则"。
//
// 补丁只做两件事：跳过(skip)、改指(take)。不在此处写翻译逻辑或 DOM 操作。

import { normalizeText } from './normalize';

type CompatResult =
  | { skip: true }
  | { take: Element }
  | null; // 无意见，交回通用逻辑

type CompatHandler = (el: Element) => CompatResult;

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
    // 独立的行内 code 在非 pre 上下文中通常是变量名/hash
    if (el.tagName === 'CODE' && !el.closest('pre, .blob-code')) {
      const text = normalizeText(el.textContent ?? '');
      // 短 hash / 变量名 / 数字 不翻
      if (/^[a-f0-9]{7,40}$/.test(text) || /^[._a-zA-Z]\w*$/.test(text) || /^\d+$/.test(text)) {
        return { skip: true };
      }
    }
    return null;
  },
};

export function applyCompat(el: Element): CompatResult {
  const handler = HANDLERS[mainDomain(location.hostname)];
  if (!handler) return null;
  return handler(el);
}
