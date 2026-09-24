// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 内置站点页面规则（ADR-0003）—— 纯数据，随扩展打包。
//
// 键是裸域名，匹配语义与站点黑白名单相同（子域归入、主域名归一）。
// 各字段可省略，省略即为空列表。新增一个站点只需在此添加条目；
// 选择器表达不了的逻辑（take 改指、按尺寸识别角标等）留在
// src/dom/compat.ts 代码层。
//
// #441：排除命中块级元素时整块不翻译；命中段落里的行内元素时，段落照常
// 翻译，该元素不翻译、原文留在译文句子里（与保留原文效果相同）。

import type { SiteRules } from './specialization';

export const BUILTIN_SITE_RULES: Record<string, Partial<SiteRules>> = {
  // #366：迁自 compat.ts 的 youtube.com skip 补丁。
  // 会命中行内元素的：#metadata-line span、时长角标里带
  // .ytd-thumbnail-overlay-time-status-renderer 的 span —— 播放量、时长
  // 本就不该翻，落在段落里时原文保留（#441）。另两条命中的是自定义元素，
  // 不属于行内元素，仍整块不翻译
  'youtube.com': {
    exclude: [
      '.ytd-thumbnail-overlay-time-status-renderer', // 视频时长角标
      '#metadata-line span',                          // 播放量、发布时间
      '.ytd-video-meta-block ytd-badge-supported-renderer', // CC / 4K 等徽章
      '.ytd-channel-name yt-formatted-string',        // 频道名
    ],
  },

  // #367：迁自 compat.ts 的 github.com skip 补丁。
  // 每条选择器独立成项 —— 旧补丁拼接选择器字符串时曾带出尾随逗号，
  // 一条无效选择器让整页采集 0 个单元（#93）。
  // 会命中行内元素的：.text-mono（分支名、标识符）、.commit-message code、
  // .commit-tease-sha（commit hash 链接）、.blob-code-inner —— 都是代码或
  // 标识符，落在段落里时原文保留（#441）
  'github.com': {
    exclude: [
      // 代码行、文件名、commit hash、blob 内容
      '.blob-code',
      '.blob-code-inner',
      '.file-info',
      '.file-header',
      '.commit-tease-sha',
      '.commit-message code',
      '.highlight',
      '.blame-hunk',
      '.text-mono',
      // #49：纯 UI 而非正文
      '.file-tree',             // blob 页文件树（新版）
      '.js-file-tree',          // blob 页文件树（旧版 JS 挂钩）
      '.tree-browser',          // blob 页文件树（旧版）
      '.BorderGrid',            // 仓库首页贡献者网格
      '.repository-lang-stats', // 仓库首页语言统计条
    ],
    // #369：迁自 compat.ts 的 github.com preserve 补丁
    preserve: [
      'a.user-mention',                 // 评论正文里的 @mention，最高频场景
      '[data-hovercard-url^="/users/"]', // hovercard 用户名链接，覆盖几乎所有用户名
      '[rel="author"]',                 // 微数据：author 关联
      '[itemprop="author"]',
    ],
  },
};
