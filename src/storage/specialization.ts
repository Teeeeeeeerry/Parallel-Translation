// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的站点页面规则部分（#366，父 #365）；领域部分
// 见 domains.ts。
//
// 设置页与 DOM 采集都只经这里读取站点页面规则。生效站点规则 = 内置
// 规则与用户规则（#370）逐字段追加；停用内置规则在后续 ticket 接入。
// 用户规则放在 storage.local（不占 sync 配额）。
//
// getSiteRules() 保持同步 —— walker 的采集入口是同步的。用户规则在
// 内存里留一份快照：content script 启动时 await siteRulesReady() 载入，
// 之后随 storage.onChanged 更新。

import { siteMatches } from '~/src/dom/site-filter';
import { BUILTIN_SITE_RULES } from './builtin-site-rules';

/** 一个站点的页面规则：CSS 选择器列表。 */
export interface SiteRules {
  /** 排除：命中的元素整块不翻译 */
  exclude: string[];
  /** 保留原文：命中的行内元素不翻译，原文留在译文句子里 */
  preserve: string[];
}

/** 选择器能否解析：按“站点 + 选择器”缓存，无效的只警告一次。 */
const selectorValidity = new Map<string, boolean>();

/**
 * #368：运行时解析失败的选择器只跳过它自己（ADR-0003），避免重演
 * #93 —— 一条带尾随逗号的无效选择器让 walker 对每个元素抛错，整页
 * 采集 0 个单元。用空文档片段试解析，不触碰页面。
 *
 * 需要 DOM：只在 content script 等有 document 的上下文调用。只把
 * SyntaxError 当作无效选择器，其他错误（例如在 service worker 里
 * document 未定义）照常抛出，不会把全部选择器静默判为无效。
 */
function isValidSelector(site: string, sel: string): boolean {
  const key = `${site}\n${sel}`;
  let valid = selectorValidity.get(key);
  if (valid === undefined) {
    try {
      document.createDocumentFragment().querySelector(sel);
      valid = true;
    } catch (e) {
      if ((e as Error).name !== 'SyntaxError') throw e;
      valid = false;
      console.warn(
        `[PT] 站点页面规则中的无效选择器已跳过：${site} ${JSON.stringify(sel)}`,
      );
    }
    selectorValidity.set(key, valid);
  }
  return valid;
}

/**
 * 按当前站点读取生效站点规则：内置规则在前，用户规则逐字段追加在后，
 * 已剔除无法解析的选择器。同步返回 —— walker 的采集入口是同步的，
 * 每次采集调用一次。用户规则须先 await siteRulesReady()，之前只有内置规则。
 */
export function getSiteRules(host: string): SiteRules {
  const exclude: string[] = [];
  const preserve: string[] = [];
  const sources: Array<[string, Partial<SiteRules>]> = [
    ...Object.entries(BUILTIN_SITE_RULES),
    ...userSnapshot.map((u): [string, Partial<SiteRules>] => [u.site, u]),
  ];
  for (const [site, rules] of sources) {
    if (!siteMatches(host, site)) continue;
    const valid = (sels: string[] = []) =>
      sels.filter((sel) => isValidSelector(site, sel));
    exclude.push(...valid(rules.exclude));
    preserve.push(...valid(rules.preserve));
  }
  return { exclude, preserve };
}

// ---- 用户规则（#370） ----

/** 用户规则：设置页的一张站点卡片，裸域名加各字段的选择器。 */
export interface UserSiteRules extends Partial<SiteRules> {
  /** 裸域名，语义与站点黑白名单相同。 */
  site: string;
}

/** storage.local 里的用户规则。 */
const STORAGE_KEY = 'pt-site-rules';

interface StoredSiteRules {
  /** 站点卡片，按新增顺序。 */
  user: UserSiteRules[];
}

/** 裸域名：小写、无协议与路径；localhost 与 IP 也在其中。 */
const SITE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 存储里的站点卡片形状校验 —— 脏数据跳过，不影响其他卡片。 */
function isUserSiteRules(v: unknown): v is UserSiteRules {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Partial<UserSiteRules>;
  return (
    typeof u.site === 'string' &&
    (u.exclude === undefined || isStringList(u.exclude)) &&
    (u.preserve === undefined || isStringList(u.preserve))
  );
}

function parseStored(stored: unknown): UserSiteRules[] {
  const user = (stored as Partial<StoredSiteRules> | undefined)?.user;
  return Array.isArray(user) ? user.filter(isUserSiteRules) : [];
}

/**
 * 读取用户规则。读取失败时退回空列表（只剩内置规则）并记日志 ——
 * 存储故障不该让整页翻译失败。
 */
async function readUserSiteRules(): Promise<UserSiteRules[]> {
  try {
    return parseStored((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  } catch (e) {
    console.warn('[PT] 读取站点规则失败:', e);
    return [];
  }
}

/** 本上下文里的用户规则快照，getSiteRules() 同步读取它。 */
let userSnapshot: UserSiteRules[] = [];
let ready: Promise<void> | null = null;

/**
 * 载入用户规则快照，并订阅其他上下文的保存。首次调用触发加载，
 * 后续复用同一个 Promise。不会失败：读取失败时只剩内置规则。
 */
export function siteRulesReady(): Promise<void> {
  if (!ready) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        userSnapshot = parseStored(changes[STORAGE_KEY].newValue);
      }
    });
    ready = readUserSiteRules().then((user) => {
      userSnapshot = user;
    });
  }
  return ready;
}

/** 站点卡片列表，按新增顺序。设置页据此渲染。 */
export function getUserSiteRules(): Promise<UserSiteRules[]> {
  return readUserSiteRules();
}

/**
 * 读-改-写串行化：同一上下文里连续保存时，后一次基于前一次的结果改，
 * 不会互相覆盖（与 domains.ts 同一做法）。
 */
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * 保存一张站点卡片：站点不存在时新增在末尾，已存在时更新传入的字段。
 * 每个选择器去掉首尾空白，空行不保存。站点不是裸域名时抛错，不写入。
 */
export function saveUserSiteRules(
  site: string,
  rules: Partial<SiteRules>,
): Promise<void> {
  const key = site.trim().toLowerCase();
  if (!SITE_RE.test(key)) {
    return Promise.reject(new Error(`[PT] 站点须为裸域名：${JSON.stringify(site)}`));
  }
  const patch: Partial<SiteRules> = {};
  for (const field of ['exclude', 'preserve'] as const) {
    const sels = rules[field];
    if (sels) patch[field] = sels.map((s) => s.trim()).filter(Boolean);
  }

  const next = writeChain.then(async () => {
    const user = await readUserSiteRules();
    const i = user.findIndex((u) => u.site === key);
    if (i === -1) user.push({ site: key, ...patch });
    else user[i] = { ...user[i]!, ...patch };
    const stored: StoredSiteRules = { user };
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
    userSnapshot = user;
  });
  writeChain = next.catch(() => {});
  return next;
}

/**
 * 用户规则变更订阅（任一上下文保存后触发）。返回取消订阅函数。
 */
export function onUserSiteRulesChanged(fn: () => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'local' && changes[STORAGE_KEY]) fn();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
