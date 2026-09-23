// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的领域部分（#379，父 #365）；站点页面规则部分
// 见 specialization.ts。
//
// 设置页、popup、content、router 都只经这里读取领域。生效领域列表 =
// 内置领域 + 自建领域（#391）；用户叠加层与排序在后续 ticket 接入。
// 用户数据放在 storage.local（不占 sync 配额），跨设备迁移靠导入导出。

import { siteMatches } from '~/src/dom/site-filter';
import { BUILTIN_DOMAINS } from './builtin-domains';

/** 术语：领域里的一条对照（原词 → 译法），或标记为「不翻译」。 */
export interface Term {
  /** 原词。 */
  source: string;
  /** 译法。noTranslate 为真时不需要。 */
  target?: string;
  /** 不翻译：原词原样出现在译文里。 */
  noTranslate?: boolean;
}

/** 领域：一组术语加一组适用网址，只服务一种目标语言。 */
export interface Domain {
  id: string;
  name: string;
  /** 目标语言（BCP-47，与 Settings.to 同一套语言码）。 */
  targetLang: string;
  /** 适用网址：裸域名，语义与站点黑白名单相同。 */
  sites: string[];
  terms: Term[];
  /** 来源：内置或用户自建。 */
  origin: 'builtin' | 'user';
}

/** storage.local 里的用户领域数据。 */
const STORAGE_KEY = 'pt-domains';

interface StoredDomains {
  /** 自建领域，按新建顺序。 */
  user: Domain[];
}

function isTerm(v: unknown): v is Term {
  return typeof v === 'object' && v !== null && typeof (v as Term).source === 'string';
}

/** 存储里的自建领域形状校验 —— 脏数据跳过，不影响其他领域。 */
function isUserDomain(v: unknown): v is Domain {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Partial<Domain>;
  return (
    typeof d.id === 'string' &&
    !BUILTIN_DOMAINS.some((b) => b.id === d.id) &&
    typeof d.name === 'string' &&
    typeof d.targetLang === 'string' &&
    Array.isArray(d.sites) &&
    d.sites.every((x) => typeof x === 'string') &&
    Array.isArray(d.terms) &&
    d.terms.every(isTerm)
  );
}

/**
 * 读取自建领域。读取失败时退回空列表（只剩内置领域）并记日志 ——
 * 翻译路径每次请求都会读，存储故障不该让整次翻译失败。
 */
async function readUserDomains(): Promise<Domain[]> {
  let stored: Partial<StoredDomains> | undefined;
  try {
    stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | Partial<StoredDomains>
      | undefined;
  } catch (e) {
    console.warn('[PT] 读取自建领域失败:', e);
  }
  const user = Array.isArray(stored?.user) ? stored.user : [];
  return user.filter(isUserDomain).map((d) => ({ ...d, origin: 'user' }));
}

/**
 * 读-改-写串行化：同一上下文里连续新建 / 删除时，后一次基于前一次的
 * 结果改，不会互相覆盖（与 cache.ts 的 index 链同一做法）。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function updateUserDomains<T>(
  fn: (user: Domain[]) => { user: Domain[]; result: T },
): Promise<T> {
  const next = writeChain.then(async () => {
    const { user, result } = fn(await readUserDomains());
    const stored: StoredDomains = { user };
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

/**
 * 生效领域列表 —— 内置领域在前，自建领域按新建顺序在后。
 * 调用方可随意改动返回值。
 */
export async function getEffectiveDomains(): Promise<Domain[]> {
  const builtin = BUILTIN_DOMAINS.map((d) => ({
    ...d,
    sites: [...d.sites],
    terms: d.terms.map((t) => ({ ...t })),
  }));
  return [...builtin, ...(await readUserDomains())];
}

/**
 * 新建自建领域（#391）：名称与目标语言必填，适用网址与术语先为空。
 * 名称或目标语言为空时抛错，不写入。
 */
export async function createDomain(input: {
  name: string;
  targetLang: string;
}): Promise<Domain> {
  const name = input.name.trim();
  const targetLang = input.targetLang.trim();
  if (!name) throw new Error('[PT] 领域名称不能为空');
  if (!targetLang) throw new Error('[PT] 领域目标语言不能为空');

  const domain: Domain = {
    id: `user:${crypto.randomUUID()}`,
    name,
    targetLang,
    sites: [],
    terms: [],
    origin: 'user',
  };
  return updateUserDomains((user) => ({ user: [...user, domain], result: domain }));
}

/**
 * 删除自建领域（#391）。内置领域不能删除（抛错）；ID 不存在时什么也不做。
 */
export async function deleteDomain(id: string): Promise<void> {
  if (BUILTIN_DOMAINS.some((d) => d.id === id)) {
    throw new Error('[PT] 内置领域不能删除');
  }
  await updateUserDomains((user) => ({
    user: user.filter((d) => d.id !== id),
    result: undefined,
  }));
}

/**
 * 领域数据变更订阅（任一上下文新建、删除后触发）。返回取消订阅函数。
 */
export function onDomainsChanged(fn: () => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'local' && changes[STORAGE_KEY]) fn();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * 当前领域：列表中第一个目标语言一致、且适用网址命中 host 的领域。
 * 目标语言不一致的领域不启用，继续看后面的领域；都不命中返回 null。
 */
export function currentDomain(
  domains: readonly Domain[],
  host: string,
  targetLang: string,
): Domain | null {
  const lang = targetLang.toLowerCase();
  return (
    domains.find(
      (d) =>
        d.targetLang.toLowerCase() === lang &&
        d.sites.some((entry) => siteMatches(host, entry)),
    ) ?? null
  );
}
