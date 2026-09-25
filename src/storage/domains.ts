// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的领域部分（#379，父 #365）；站点页面规则部分
// 见 specialization.ts。
//
// 设置页、popup、content、router 都只经这里读取领域。生效领域列表 =
// 内置领域（叠加用户的修改与新增，#395）+ 自建领域（#391），按用户
// 调整的顺序排列（#394）。
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
  /** 适用网址：裸域名、localhost 或 IPv4 地址（#431），匹配语义与站点黑白名单相同。 */
  sites: string[];
  terms: Term[];
  /** 来源：内置或用户自建。 */
  origin: 'builtin' | 'user';
}

/** storage.local 里的用户领域数据。 */
const STORAGE_KEY = 'pt-domains';

/**
 * 内置领域的用户叠加层（#395）：按原词记录用户的修改、新增与删除（#396）。
 * 生效内容 = 当前版本的内置内容 + 叠加层，同一原词（不区分大小写）以
 * 叠加层为准，所以升级带来的新内置术语照样生效，用户改过或删掉的术语
 * 不被覆盖、不会复活。
 */
interface BuiltinOverlay {
  /** 与内置不同的术语（修改）和内置没有的术语（新增），按保存顺序。 */
  terms: Term[];
  /** 用户删掉的内置术语的原词（去掉首尾空格、小写，#396）。 */
  removedTerms: string[];
}

interface StoredDomains {
  /** 自建领域，按新建顺序。 */
  user: Domain[];
  /** 内置领域的叠加层，按内置领域 ID（#395）。 */
  builtin: Record<string, BuiltinOverlay>;
  /**
   * 用户调整过的领域顺序，按领域 ID（#394）。不在其中的领域（之后新建的、
   * 升级新增的内置领域）按默认顺序排在后面；已不存在的 ID 忽略。
   */
  order: string[];
}

function isTerm(v: unknown): v is Term {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Partial<Term>;
  return (
    typeof t.source === 'string' &&
    (t.target === undefined || typeof t.target === 'string') &&
    (t.noTranslate === undefined || typeof t.noTranslate === 'boolean')
  );
}

/**
 * 叠加层里的术语还要能约束译文（#395）：原词非空，给了译法或标了“不翻译”。
 * 否则跳过 —— 不让一条空术语顶掉同原词的内置术语。
 */
function isOverlayTerm(v: unknown): v is Term {
  return isTerm(v) && v.source.trim() !== '' && (v.noTranslate === true || !!v.target?.trim());
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
 * 读取用户领域数据（自建领域与叠加层）。读取失败时退回空数据（只剩内置
 * 领域的内置内容）并记日志 —— 翻译路径每次请求都会读，存储故障不该让
 * 整次翻译失败。形状不对的条目跳过。
 */
async function readStored(): Promise<StoredDomains> {
  let stored: Partial<StoredDomains> | undefined;
  try {
    stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | Partial<StoredDomains>
      | undefined;
  } catch (e) {
    console.warn('[PT] 读取用户领域数据失败:', e);
  }
  const user = Array.isArray(stored?.user) ? stored.user : [];
  const builtin: Record<string, BuiltinOverlay> = {};
  if (typeof stored?.builtin === 'object' && stored.builtin !== null) {
    for (const [id, overlay] of Object.entries(stored.builtin)) {
      const { terms, removedTerms } = (overlay ?? {}) as Partial<BuiltinOverlay>;
      if (!Array.isArray(terms) && !Array.isArray(removedTerms)) continue;
      builtin[id] = {
        terms: Array.isArray(terms) ? terms.filter(isOverlayTerm) : [],
        removedTerms: Array.isArray(removedTerms)
          ? removedTerms.filter((k): k is string => typeof k === 'string').map((k) => k.trim().toLowerCase())
          : [],
      };
    }
  }
  const order = Array.isArray(stored?.order)
    ? stored.order.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    user: user.filter(isUserDomain).map((d) => ({ ...d, origin: 'user' })),
    builtin,
    order,
  };
}

/**
 * 读-改-写串行化：同一上下文里连续新建 / 删除 / 修改时，后一次基于前一次的
 * 结果改，不会互相覆盖（与 cache.ts 的 index 链同一做法）。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function updateStored<T>(
  fn: (stored: StoredDomains) => { stored: StoredDomains | null; result: T },
): Promise<T> {
  const next = writeChain.then(async () => {
    const { stored, result } = fn(await readStored());
    // stored 为 null：没有改动，不写入
    if (stored) await chrome.storage.local.set({ [STORAGE_KEY]: stored });
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

function updateUserDomains<T>(
  fn: (user: Domain[]) => { user: Domain[]; result: T },
): Promise<T> {
  return updateStored((stored) => {
    const { user, result } = fn(stored.user);
    return { stored: { ...stored, user }, result };
  });
}

/** 术语的原词键：去掉首尾空格，不区分大小写。 */
function termKey(t: Term): string {
  return t.source.trim().toLowerCase();
}

/**
 * 内置领域叠加用户的修改、新增（#395）与删除（#396）：修改的术语留在原位，
 * 新增的排在最后，删掉的不出现。
 */
function withOverlay(d: Domain, overlay: BuiltinOverlay | undefined): Domain {
  const own = new Map((overlay?.terms ?? []).map((t) => [termKey(t), t]));
  const removed = new Set(overlay?.removedTerms ?? []);
  const terms = d.terms.flatMap((t) => {
    const mine = own.get(termKey(t));
    own.delete(termKey(t));
    if (!mine && removed.has(termKey(t))) return [];
    return [{ ...(mine ?? t) }];
  });
  return {
    ...d,
    sites: [...d.sites],
    terms: [...terms, ...[...own.values()].map((t) => ({ ...t }))],
  };
}

/**
 * 由存储数据得出生效领域列表：默认内置领域在前、自建领域按新建顺序在后；
 * 用户调整过顺序（#394）时，顺序里的领域按它排在前面，其余保持默认顺序。
 */
function effectiveDomains({ user, builtin, order }: StoredDomains): Domain[] {
  const list = [...BUILTIN_DOMAINS.map((d) => withOverlay(d, builtin[d.id])), ...user];
  const rank = new Map(order.map((id, i) => [id, i]));
  const ranked = list.filter((d) => rank.has(d.id));
  ranked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...ranked, ...list.filter((d) => !rank.has(d.id))];
}

/**
 * 生效领域列表 —— 内置领域（叠加用户的修改与新增）与自建领域，按用户
 * 调整的顺序排列（#394）。调用方可随意改动返回值。
 */
export async function getEffectiveDomains(): Promise<Domain[]> {
  return effectiveDomains(await readStored());
}

/**
 * 把领域上移或下移一位（#394）。多个领域同时命中一个网址时，排在前面的
 * 成为当前领域。已在两端时不变。不存在的领域抛 DomainNotFoundError。
 * 返回移动后的生效领域列表。
 */
export async function moveDomain(id: string, direction: 'up' | 'down'): Promise<Domain[]> {
  return updateStored((stored) => {
    const list = effectiveDomains(stored);
    const from = list.findIndex((d) => d.id === id);
    if (from < 0) throw new DomainNotFoundError(id);
    const to = direction === 'up' ? from - 1 : from + 1;
    // 已在两端：不写入，免得各标签页白白重读一次
    if (to < 0 || to >= list.length) return { stored: null, result: list };
    [list[from], list[to]] = [list[to]!, list[from]!];
    return { stored: { ...stored, order: list.map((d) => d.id) }, result: list };
  });
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
  await updateStored((stored) => ({
    stored: {
      ...stored,
      user: stored.user.filter((d) => d.id !== id),
      order: stored.order.filter((o) => o !== id),
    },
    result: undefined,
  }));
}

/**
 * 要修改的领域不存在（#430）—— 例如已在另一个设置页标签页里删除。设置页
 * 据此提示用户并刷新列表。
 */
export class DomainNotFoundError extends Error {
  constructor(readonly id: string) {
    super('[PT] 领域不存在');
    this.name = 'DomainNotFoundError';
  }
}

/** 裸域名格式，与站点黑白名单的输入校验一致。 */
const SITE_RE = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;

/** IPv4 的一段：0–255，不带前导零。 */
const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);

/**
 * 适用网址条目是否合法：裸域名，或 localhost、IPv4 地址（#431）—— 后两者
 * 在 siteMatches 里只做精确匹配。协议、端口、路径一律不收。
 */
function isValidSite(entry: string): boolean {
  return entry === 'localhost' || IPV4_RE.test(entry) || SITE_RE.test(entry);
}

/** 适用网址里有不合法的条目；invalid 按输入顺序列出这些条目（去重）。 */
export class InvalidSitesError extends Error {
  constructor(readonly invalid: string[]) {
    super(`[PT] 适用网址格式不正确: ${invalid.join(', ')}`);
    this.name = 'InvalidSitesError';
  }
}

/**
 * 保存自建领域的适用网址（#392），整体替换原列表。条目为裸域名、localhost
 * 或 IPv4 地址（#431）。每条去掉首尾空格并转小写，空行与重复条目丢弃；
 * 有不合法的条目时抛 InvalidSitesError，不写入。内置领域抛错，不存在的
 * 领域抛 DomainNotFoundError。返回保存后的领域。
 */
export async function setDomainSites(id: string, sites: readonly string[]): Promise<Domain> {
  if (BUILTIN_DOMAINS.some((d) => d.id === id)) {
    throw new Error('[PT] 内置领域的适用网址不能修改');
  }
  const cleaned = [...new Set(sites.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const invalid = [
    ...new Set(sites.map((s) => s.trim()).filter((s) => s && !isValidSite(s.toLowerCase()))),
  ];
  if (invalid.length > 0) throw new InvalidSitesError(invalid);

  return updateUserDomains((user) => {
    const target = user.find((d) => d.id === id);
    if (!target) throw new DomainNotFoundError(id);
    const updated: Domain = { ...target, sites: cleaned };
    return { user: user.map((d) => (d.id === id ? updated : d)), result: updated };
  });
}

/**
 * 术语表里有不合法的行（#393），各项按输入顺序列出（去重）：
 * duplicates 是重复的原词（小写），missingTarget 是没填译法也没勾选
 * “不翻译”的原词，missingSource 是只填了译法的行的译法。
 */
export class InvalidTermsError extends Error {
  constructor(
    readonly duplicates: string[],
    readonly missingTarget: string[],
    readonly missingSource: string[],
  ) {
    super('[PT] 术语表有不合法的行');
    this.name = 'InvalidTermsError';
  }
}

/**
 * 保存领域的术语，整体替换原术语表。原词与译法去掉首尾空格，两者都为空
 * 的行丢弃；勾选“不翻译”的行不保存译法。同一领域内原词重复（不区分
 * 大小写）、缺译法或缺原词时抛 InvalidTermsError，不写入。不存在的领域
 * 抛 DomainNotFoundError。返回保存后的生效领域。
 *
 * 自建领域（#393）直接替换。内置领域（#395）只在叠加层记下与内置不同
 * 的术语和新增的术语，与内置相同的不记，之后跟随新版内置；提交时去掉的
 * 内置术语记为已删除（#396），升级后也不复活。
 */
export async function setDomainTerms(id: string, terms: readonly Term[]): Promise<Domain> {
  const cleaned = cleanTerms(terms);

  const base = BUILTIN_DOMAINS.find((d) => d.id === id);
  if (base) {
    const builtinTerms = new Map(base.terms.map((t) => [termKey(t), t]));
    const own = cleaned.filter((t) => !sameTerm(t, builtinTerms.get(termKey(t))));
    const kept = new Set(cleaned.map(termKey));
    const removedTerms = [...builtinTerms.keys()].filter((k) => !kept.has(k));
    return updateStored((stored) => {
      // 只替换术语部分，叠加层的其他记录原样保留；全部为空时删掉这一条
      const { [id]: prev, ...rest } = stored.builtin;
      const overlay: BuiltinOverlay = { ...prev, terms: own, removedTerms };
      const empty = Object.values(overlay).every((v) => Array.isArray(v) && v.length === 0);
      const builtin = empty ? rest : { ...rest, [id]: overlay };
      return { stored: { ...stored, builtin }, result: withOverlay(base, builtin[id]) };
    });
  }

  return updateUserDomains((user) => {
    const domain = user.find((d) => d.id === id);
    if (!domain) throw new DomainNotFoundError(id);
    const updated: Domain = { ...domain, terms: cleaned };
    return { user: user.map((d) => (d.id === id ? updated : d)), result: updated };
  });
}

/**
 * 该原词是否为内置领域在当前版本内置的术语（#395）。设置页据此锁定这些
 * 行的原词（#396 起可以删除）。自建领域一律返回 false。
 */
export function isBuiltinTerm(domainId: string, source: string): boolean {
  const key = source.trim().toLowerCase();
  return BUILTIN_DOMAINS.some((d) => d.id === domainId && d.terms.some((t) => termKey(t) === key));
}

/** 两条术语的原词（不区分大小写）、译法与“不翻译”标记都相同。 */
function sameTerm(a: Term, b: Term | undefined): boolean {
  return (
    b !== undefined &&
    termKey(a) === termKey(b) &&
    (a.target ?? '') === (b.target ?? '') &&
    (a.noTranslate === true) === (b.noTranslate === true)
  );
}

/** 按 setDomainTerms 的规则整理术语表；有不合法的行时抛 InvalidTermsError。 */
function cleanTerms(terms: readonly Term[]): Term[] {
  const cleaned: Term[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const missingTarget = new Set<string>();
  const missingSource = new Set<string>();
  for (const t of terms) {
    const source = t.source.trim();
    // 勾选“不翻译”的行不看译法：界面上译法列已禁用，残留的值不算数
    const target = t.noTranslate ? '' : (t.target?.trim() ?? '');
    if (!source) {
      if (target) missingSource.add(target);
      continue;
    }
    const key = source.toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    if (t.noTranslate) {
      cleaned.push({ source, noTranslate: true });
    } else if (target) {
      cleaned.push({ source, target });
    } else {
      missingTarget.add(source);
    }
  }
  if (duplicates.size + missingTarget.size + missingSource.size > 0) {
    throw new InvalidTermsError([...duplicates], [...missingTarget], [...missingSource]);
  }
  return cleaned;
}

/**
 * 领域数据变更订阅（任一上下文新建、删除、修改后触发）。返回取消订阅函数。
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
 * 生效领域列表的变更订阅（#417）：任一上下文新建、删除、修改领域后，重新
 * 读取生效领域列表交给 fn。连续变更时只交付最后一次读取的结果，先发起、
 * 后返回的旧读取不会覆盖新列表。返回取消订阅函数，取消后不再交付。
 */
export function watchEffectiveDomains(fn: (domains: Domain[]) => void): () => void {
  let latest = 0;
  let active = true;
  const off = onDomainsChanged(() => {
    const seq = ++latest;
    void getEffectiveDomains().then((domains) => {
      if (active && seq === latest) fn(domains);
    });
  });
  return () => {
    active = false;
    off();
  };
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
