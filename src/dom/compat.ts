// Phase 8 — 域名级采集补丁。
// 仅在通用 walker 判断有误时才添加条目 —— 这是兜底层，不是主路径。
// 每加一条都意味着一处通用逻辑的缺陷，先问"能不能改进通用规则"。
//
// 补丁只做两件事：跳过(skip)、改指(take)。不在此处写翻译逻辑或 DOM 操作。

type CompatResult =
  | { skip: true }
  | { take: Element }
  | null; // 无意见，交回通用逻辑

type CompatHandler = (el: Element) => CompatResult;

type OmitHandler = (el: Element) => boolean;

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
 * 类名来自社区抓包记录而非官方文档，Google 改版可能失效 —— 失效只是
 * 噪声回退（chip 文本重新进入译文），不会翻错。
 */
const OMIT_HANDLERS: Record<string, OmitHandler> = {
  'google.com': (el: Element) => el.matches('span.wJwe6c, .WTfRgd'),
};

export function shouldOmitText(el: Element): boolean {
  const handler = OMIT_HANDLERS[mainDomain(location.hostname)];
  if (!handler) return false;
  return handler(el);
}
