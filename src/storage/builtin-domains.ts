// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 内置领域（#379）—— 纯数据，新增内置领域只改这里。
//
// 术语由本项目自行编写。沉浸式翻译的数据仓库没有 LICENSE，read-frog 的
// 来源不明，两者的术语、规则都不复用（见 ADR-0003 与调研报告 6.1 节）。

import type { Domain, Term } from './domains';

/** 一组“不翻译”术语；每次调用都是新对象，各领域之间不共享。 */
function noTranslate(sources: readonly string[]): Term[] {
  return sources.map((source) => ({ source, noTranslate: true }));
}

/** 编程语言名：编程语言领域与软件开发领域共用。 */
const PROGRAMMING_LANGUAGES = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'Rust', 'Swift', 'Kotlin', 'Ruby',
  'PHP', 'MATLAB', 'SQL', 'HTML', 'CSS', 'Shell', 'stub',
];

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
    // 编程语言名：与编程语言领域同一份，代码托管站点上同样不翻译
    ...noTranslate(PROGRAMMING_LANGUAGES),
  ],
};

/** 通用(简体中文)：AI 相关站点上的通用缩写。 */
const GENERAL_ZH_CN: Domain = {
  id: 'builtin:general-zh-CN',
  name: '通用(简体中文)',
  targetLang: 'zh-CN',
  sites: ['huggingface.co', 'arxiv.org', 'news.ycombinator.com'],
  origin: 'builtin',
  terms: noTranslate(['LLM', 'LLMs']),
};

/** 游戏(简体中文)：游戏平台与主机名。 */
const GAME_ZH_CN: Domain = {
  id: 'builtin:game-zh-CN',
  name: '游戏(简体中文)',
  targetLang: 'zh-CN',
  sites: ['steampowered.com', 'steamcommunity.com', 'epicgames.com', 'playstation.com', 'xbox.com', 'nintendo.com', 'ign.com'],
  origin: 'builtin',
  terms: noTranslate(['Steam', 'Epic Games', 'PlayStation', 'Xbox', 'Switch']),
};

/** 编程语言(简体中文)：语言官网与开发文档站点上的语言名。 */
const PROGRAMMING_ZH_CN: Domain = {
  id: 'builtin:programming-zh-CN',
  name: '编程语言(简体中文)',
  targetLang: 'zh-CN',
  sites: [
    'developer.mozilla.org',
    'python.org',
    'typescriptlang.org',
    'rust-lang.org',
    'swift.org',
    'kotlinlang.org',
    'ruby-lang.org',
    'php.net',
    'w3schools.com',
    'dev.to',
  ],
  origin: 'builtin',
  terms: noTranslate(PROGRAMMING_LANGUAGES),
};

/** 科技公司与 AI(简体中文)：科技媒体上的公司名与模型名。 */
const TECH_ZH_CN: Domain = {
  id: 'builtin:tech-zh-CN',
  name: '科技公司与 AI(简体中文)',
  targetLang: 'zh-CN',
  sites: ['techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com', 'engadget.com', 'venturebeat.com'],
  origin: 'builtin',
  terms: noTranslate([
    'GPT', 'Claude', 'Gemini', 'LLaMA', 'Mistral', 'OpenAI', 'Anthropic', 'Google', 'DeepMind',
    'Meta', 'Microsoft', 'Amazon', 'Apple', 'NVIDIA', 'Intel', 'AMD', 'IBM', 'Oracle',
    'Salesforce', 'Adobe', 'Autodesk',
  ]),
};

/** Web3(简体中文)：加密货币资讯与区块浏览器上的公链名。 */
const WEB3_ZH_CN: Domain = {
  id: 'builtin:web3-zh-CN',
  name: 'Web3(简体中文)',
  targetLang: 'zh-CN',
  sites: ['coinmarketcap.com', 'coingecko.com', 'coindesk.com', 'cointelegraph.com', 'etherscan.io', 'solscan.io'],
  origin: 'builtin',
  terms: noTranslate([
    'Bitcoin', 'Ethereum', 'Solana', 'Cardano', 'Polygon', 'Avalanche', 'Binance Smart Chain', 'Web3',
  ]),
};

/** 内置领域列表，顺序即默认优先级。 */
export const BUILTIN_DOMAINS: readonly Domain[] = [
  SOFTWARE_ZH_CN,
  GENERAL_ZH_CN,
  GAME_ZH_CN,
  PROGRAMMING_ZH_CN,
  TECH_ZH_CN,
  WEB3_ZH_CN,
];
