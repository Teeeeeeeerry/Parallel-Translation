// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 内置领域（#379）—— 纯数据。软件开发领域由本项目自行编写，写在本文件里；
// 其余内置领域按术语库生成，见 builtin-domain-terms.ts 与
// scripts/build-builtin-domains.ts（数据来源与重新生成的方法记在脚本文件头）。

import { BUILTIN_TERM_DOMAINS } from './builtin-domain-terms';
import type { Domain } from './domains';

/** 软件开发(简体中文)：代码托管与技术问答站点上的常见行话。 */
const SOFTWARE_ZH_CN: Domain = {
  id: 'builtin:software-zh-CN',
  name: '软件开发(简体中文)',
  targetLang: 'zh-CN',
  sites: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com'],
  origin: 'builtin',
  terms: [
    // 读者本来就按英文使用的词：不翻译
    { source: 'issue', noTranslate: true },
    { source: 'pull request', noTranslate: true },
    { source: 'PR', noTranslate: true },
    { source: 'merge request', noTranslate: true },
    { source: 'MR', noTranslate: true },
    { source: 'fork', noTranslate: true },
    { source: 'commit', noTranslate: true },
    { source: 'rebase', noTranslate: true },
    { source: 'cherry-pick', noTranslate: true },
    { source: 'diff', noTranslate: true },
    { source: 'bug', noTranslate: true },
    { source: 'README', noTranslate: true },
    { source: 'CI', noTranslate: true },
    // 有通行中文说法的词：统一译法
    { source: 'repository', target: '仓库' },
    { source: 'repo', target: '仓库' },
    { source: 'branch', target: '分支' },
    { source: 'merge', target: '合并' },
    { source: 'release', target: '发行版' },
    { source: 'tag', target: '标签' },
    { source: 'maintainer', target: '维护者' },
    { source: 'contributor', target: '贡献者' },
    { source: 'upstream', target: '上游' },
    { source: 'downstream', target: '下游' },
    { source: 'dependency', target: '依赖' },
    { source: 'deprecated', target: '已弃用' },
    { source: 'breaking change', target: '破坏性变更' },
    { source: 'changelog', target: '更新日志' },
    { source: 'workflow', target: '工作流' },
    { source: 'stack trace', target: '堆栈跟踪' },
  ],
};

/** 内置领域列表，顺序即默认优先级。软件开发领域排在最前（#379）。 */
export const BUILTIN_DOMAINS: readonly Domain[] = [SOFTWARE_ZH_CN, ...BUILTIN_TERM_DOMAINS];
