// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 领域与规则存储模块的领域部分（#379，父 #365）；站点页面规则部分
// 见 specialization.ts。
//
// 设置页、popup、content、router 都只经这里读取领域。生效领域列表 =
// 内置领域（叠加用户对术语的修改与新增 #395、删除 #396，对适用网址的
// 增删 #397）+ 自建领域（#391），按用户调整的顺序排列（#394）。
// 用户数据放在 storage.local（不占 sync 配额），跨设备迁移靠导入导出。

import { siteMatches } from '~/src/dom/site-filter';
import { BUILTIN_DOMAINS } from './builtin-domains';
import { isQuotaError, StorageQuotaError } from './quota';
import { StorageReadError } from './read-error';

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
 * 内置领域的用户叠加层（#395）：按原词记录用户对术语的修改、新增与删除
 * （#396），按网址记录用户对适用网址的增删（#397）。生效内容 = 当前版本
 * 的内置内容 + 叠加层，同一原词（不区分大小写）或网址以叠加层为准，所以
 * 升级带来的新内置术语和网址照样生效，用户改过或删掉的不被覆盖、不会复活。
 */
interface BuiltinOverlay {
  /** 与内置不同的术语（修改）和内置没有的术语（新增），按保存顺序。 */
  terms: Term[];
  /** 用户删掉的内置术语的原词（去掉首尾空格、小写，#396）。 */
  removedTerms: string[];
  /** 用户新增的适用网址（#397），按保存顺序。 */
  addedSites: string[];
  /** 用户删掉的内置适用网址（#397）。 */
  removedSites: string[];
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

/** 叠加层里的适用网址列表（#397）：只留格式合法的条目，去掉首尾空格、转小写并去重。 */
function overlaySites(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter(isValidSite),
    ),
  ];
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
 * 读取用户领域数据（自建领域与叠加层），读取失败时抛错。存储里还没有
 * 数据（首次使用）不算失败，得到空数据。形状不对的条目跳过。
 */
async function readStoredStrict(): Promise<StoredDomains> {
  let stored: Partial<StoredDomains> | undefined;
  try {
    stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | Partial<StoredDomains>
      | undefined;
  } catch (e) {
    throw new StorageReadError(e);
  }
  const user = Array.isArray(stored?.user) ? stored.user : [];
  const builtin: Record<string, BuiltinOverlay> = {};
  if (typeof stored?.builtin === 'object' && stored.builtin !== null) {
    for (const [id, overlay] of Object.entries(stored.builtin)) {
      const { terms, removedTerms, addedSites, removedSites } = (overlay ?? {}) as Partial<BuiltinOverlay>;
      if (![terms, removedTerms, addedSites, removedSites].some(Array.isArray)) continue;
      builtin[id] = {
        terms: Array.isArray(terms) ? terms.filter(isOverlayTerm) : [],
        removedTerms: Array.isArray(removedTerms)
          ? removedTerms.filter((k): k is string => typeof k === 'string').map((k) => k.trim().toLowerCase())
          : [],
        addedSites: overlaySites(addedSites),
        removedSites: overlaySites(removedSites),
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
 * 订阅生效领域列表（页面上的当前领域判定）用：读取失败时退回空数据（只剩
 * 内置领域的内置内容）并记日志 —— 存储故障不该让整页翻译失败（翻译路径另见
 * getCachedEffectiveDomains，#418）。写入路径不用它（#484）：把空数据当作
 * 现有数据写回会清掉用户的全部领域。设置页的列表也不用它（#535）：只剩内置
 * 领域的列表看起来像自建领域全没了。
 */
async function readStored(): Promise<StoredDomains> {
  try {
    return await readStoredStrict();
  } catch (e) {
    console.warn('[PT] 读取用户领域数据失败:', e);
    return { user: [], builtin: {}, order: [] };
  }
}

/**
 * 读-改-写串行化：同一上下文里连续新建 / 删除 / 修改时，后一次基于前一次的
 * 结果改，不会互相覆盖（与 cache.ts 的 index 链同一做法）。读取失败时抛错、
 * 不写入（#484），存储里原有的数据保持不变。
 *
 * 跨页面（#485）：多个设置页标签页同时修改时，读-改-写这一段再包一层
 * Web Locks 的同名锁 —— 扩展页面与后台同源，锁在它们之间共享，
 * 后一次写入基于前一次写入之后的数据。拿不到锁接口的环境只有页面内串行。
 */
let writeChain: Promise<unknown> = Promise.resolve();

/** 领域数据读-改-写的跨页面锁名。 */
const LOCK_NAME = 'pt-domains-write';

function updateStored<T>(
  fn: (stored: StoredDomains) => { stored: StoredDomains | null; result: T },
): Promise<T> {
  const readModifyWrite = async (): Promise<T> => {
    const current = await readStoredStrict().catch((e: unknown) => {
      // 读取失败时没有写入：告诉用户领域数据没有被改坏（#537）
      throw new Error('[PT] 读取领域数据失败，未作改动', { cause: e });
    });
    const { stored, result } = fn(current);
    // stored 为 null：没有改动，不写入
    if (stored) {
      await chrome.storage.local.set({ [STORAGE_KEY]: stored }).catch((e: unknown) => {
        // 存储空间不足（#510）：换成说得清原因与办法的错误
        throw isQuotaError(e) ? new StorageQuotaError(e) : e;
      });
      invalidateCachedDomains();
    }
    return result;
  };
  const locks = globalThis.navigator?.locks;
  const next = writeChain.then(async () =>
    locks ? await locks.request(LOCK_NAME, readModifyWrite) : readModifyWrite(),
  );
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
 * 新增的排在最后，删掉的不出现。适用网址的增删（#397）同理。
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
  // 适用网址（#397）：内置网址去掉删掉的，再接上新增的（内置已有的不重复）
  const removedSites = new Set(overlay?.removedSites ?? []);
  const sites = d.sites.filter((s) => !removedSites.has(s));
  return {
    ...d,
    sites: [...sites, ...(overlay?.addedSites ?? []).filter((s) => !sites.includes(s))],
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
 * 生效领域列表 —— 内置领域（叠加用户对术语和适用网址的修改）与自建领域，
 * 按用户调整的顺序排列（#394）。设置页据此渲染，读取失败时抛错（#535）。
 * 调用方可随意改动返回值。
 */
export async function getEffectiveDomains(): Promise<Domain[]> {
  return effectiveDomains(await readStoredStrict());
}

/**
 * 翻译路径用的生效领域列表（#418）：后台内存里缓存一份，不再每次翻译都读
 * 存储。本上下文写入领域数据后、或收到任一上下文写入的变更通知
 * （onDomainsChanged）后失效，下一次重新读取。读取失败时退回只有内置领域
 * 内置内容的列表，这份结果不缓存，下一次重读。返回值在各次调用间共享，
 * 调用方不得修改。
 */
let cachedDomains: Promise<readonly Domain[]> | null = null;
let stopWatchingDomains: (() => void) | null = null;

function invalidateCachedDomains(): void {
  cachedDomains = null;
  stopWatchingDomains?.();
  stopWatchingDomains = null;
}

export async function getCachedEffectiveDomains(): Promise<readonly Domain[]> {
  if (!cachedDomains) {
    // 先订阅再读：读取期间发生的写入也会让这次结果失效
    stopWatchingDomains ??= onDomainsChanged(invalidateCachedDomains);
    const load = readStoredStrict().then(effectiveDomains);
    cachedDomains = load;
    load.catch(() => {
      if (cachedDomains === load) cachedDomains = null;
    });
  }
  try {
    return await cachedDomains;
  } catch (e) {
    console.warn('[PT] 读取用户领域数据失败:', e);
    return effectiveDomains({ user: [], builtin: {}, order: [] });
  }
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
  const domain = newUserDomain(input, []);
  return updateUserDomains((user) => ({ user: [...user, domain], result: domain }));
}

/**
 * 新的自建领域（#391）：名称与目标语言去首尾空白，为空时抛错；适用网址为空。
 * 新建领域与从 CSV 新建领域（#603）共用。
 */
function newUserDomain(input: { name: string; targetLang: string }, terms: Term[]): Domain {
  const name = input.name.trim();
  const targetLang = input.targetLang.trim();
  if (!name) throw new Error('[PT] 领域名称不能为空');
  if (!targetLang) throw new Error('[PT] 领域目标语言不能为空');
  return {
    id: `user:${crypto.randomUUID()}`,
    name,
    targetLang,
    sites: [],
    terms,
    origin: 'user',
  };
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
 * 保存领域的适用网址（#392），整体替换原列表。条目为裸域名、localhost
 * 或 IPv4 地址（#431）。每条去掉首尾空格并转小写，空行与重复条目丢弃；
 * 有不合法的条目时抛 InvalidSitesError，不写入。不存在的领域抛
 * DomainNotFoundError。返回保存后的生效领域。
 *
 * 内置领域（#397）只在叠加层记下新增的网址和删掉的内置网址：删掉的
 * 升级后不复活，新增的保留，新版新增的内置网址照常生效。生效顺序固定为
 * 内置网址（去掉删掉的）在前、新增的按保存顺序在后，不保留输入的顺序。
 */
export async function setDomainSites(id: string, sites: readonly string[]): Promise<Domain> {
  const cleaned = [...new Set(sites.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const invalid = [
    ...new Set(sites.map((s) => s.trim()).filter((s) => s && !isValidSite(s.toLowerCase()))),
  ];
  if (invalid.length > 0) throw new InvalidSitesError(invalid);
  return updateStored((stored) => {
    const { stored: next, domain } = withSites(stored, id, cleaned);
    return { stored: next, result: domain };
  });
}

/**
 * 把领域的适用网址整体换成 sites（已整理、合法）：内置领域记在叠加层
 * （#397），自建领域直接替换。不存在的领域抛 DomainNotFoundError。
 */
function withSites(
  stored: StoredDomains,
  id: string,
  sites: readonly string[],
): { stored: StoredDomains; domain: Domain } {
  const base = BUILTIN_DOMAINS.find((d) => d.id === id);
  if (base) {
    // 只替换网址部分，叠加层的其他记录原样保留；全部为空时删掉这一条
    const { [id]: prev, ...rest } = stored.builtin;
    // 删掉的网址：本次去掉的内置网址，加上以前删掉、当前版本内置里暂时
    // 没有的网址 —— 以后的版本加回它时仍不复活
    const removedSites = [
      ...new Set([
        ...(prev?.removedSites ?? []).filter((s) => !base.sites.includes(s) && !sites.includes(s)),
        ...base.sites.filter((s) => !sites.includes(s)),
      ]),
    ];
    const addedSites = sites.filter((s) => !base.sites.includes(s));
    const overlay: BuiltinOverlay = {
      terms: [],
      removedTerms: [],
      ...prev,
      addedSites,
      removedSites,
    };
    const empty = Object.values(overlay).every((v) => Array.isArray(v) && v.length === 0);
    const builtin = empty ? rest : { ...rest, [id]: overlay };
    return { stored: { ...stored, builtin }, domain: withOverlay(base, builtin[id]) };
  }

  const target = stored.user.find((d) => d.id === id);
  if (!target) throw new DomainNotFoundError(id);
  const updated: Domain = { ...target, sites: [...sites] };
  return {
    stored: { ...stored, user: stored.user.map((d) => (d.id === id ? updated : d)) },
    domain: updated,
  };
}

/**
 * “以后在此站点都使用”（#401）：把站点的裸域名（主机名转小写、去掉
 * www. 前缀）追加到领域的适用网址。内置领域记在叠加层，升级后保留。
 * 适用网址已命中这个站点时不写入；原先命中它的其他领域不改。
 *
 * 返回加入后按领域列表顺序判定的当前领域（按目标领域的目标语言）——
 * 排在前面的领域也命中时不是目标领域，调用方据此提示用户调整顺序。
 * 站点不是合法的网址条目时抛 InvalidSitesError，不存在的领域抛
 * DomainNotFoundError，都不写入。
 */
export async function rememberDomainForSite(
  id: string,
  host: string,
): Promise<{ current: Domain | null }> {
  const site = host.trim().toLowerCase().replace(/^www\./, '');
  if (!isValidSite(site)) throw new InvalidSitesError([host]);
  return updateStored((stored) => {
    const domain = effectiveDomains(stored).find((d) => d.id === id);
    if (!domain) throw new DomainNotFoundError(id);
    const covered = domain.sites.some((entry) => siteMatches(site, entry));
    const next = covered ? stored : withSites(stored, id, [...domain.sites, site]).stored;
    const current = currentDomain(effectiveDomains(next), site, domain.targetLang);
    return { stored: covered ? null : next, result: { current } };
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
  return updateStored((stored) => {
    const { stored: next, domain } = withTerms(stored, id, cleaned);
    return { stored: next, result: domain };
  });
}

/**
 * 把领域的术语整体换成 terms（已按 cleanTerms 整理）：自建领域直接替换；
 * 内置领域只在叠加层记下与内置不同的和新增的术语（#395），去掉的内置
 * 术语记为已删除（#396）。不存在的领域抛 DomainNotFoundError。
 */
function withTerms(
  stored: StoredDomains,
  id: string,
  terms: readonly Term[],
): { stored: StoredDomains; domain: Domain } {
  const base = BUILTIN_DOMAINS.find((d) => d.id === id);
  if (base) {
    const builtinTerms = new Map(base.terms.map((t) => [termKey(t), t]));
    const own = terms.filter((t) => !sameTerm(t, builtinTerms.get(termKey(t))));
    const kept = new Set(terms.map(termKey));
    // 只替换术语部分，叠加层的其他记录原样保留；全部为空时删掉这一条
    const { [id]: prev, ...rest } = stored.builtin;
    // 删除记录：本次去掉的内置术语，加上以前删掉、当前版本内置里暂时
    // 没有的原词 —— 以后的版本加回它时仍不复活
    const removedTerms = [
      ...new Set([
        ...(prev?.removedTerms ?? []).filter((k) => !builtinTerms.has(k) && !kept.has(k)),
        ...[...builtinTerms.keys()].filter((k) => !kept.has(k)),
      ]),
    ];
    const overlay: BuiltinOverlay = { addedSites: [], removedSites: [], ...prev, terms: own, removedTerms };
    const empty = Object.values(overlay).every((v) => Array.isArray(v) && v.length === 0);
    const builtin = empty ? rest : { ...rest, [id]: overlay };
    return { stored: { ...stored, builtin }, domain: withOverlay(base, builtin[id]) };
  }

  const domain = stored.user.find((d) => d.id === id);
  if (!domain) throw new DomainNotFoundError(id);
  const updated: Domain = { ...domain, terms: [...terms] };
  return {
    stored: { ...stored, user: stored.user.map((d) => (d.id === id ? updated : d)) },
    domain: updated,
  };
}

/**
 * 该原词是否为内置领域在当前版本内置的术语（#395）。设置页据此锁定这些
 * 行的原词（#396 起可以删除）。自建领域一律返回 false。
 */
export function isBuiltinTerm(domainId: string, source: string): boolean {
  const key = source.trim().toLowerCase();
  return BUILTIN_DOMAINS.some((d) => d.id === domainId && d.terms.some((t) => termKey(t) === key));
}

/**
 * 恢复默认（#398）：清空内置领域在叠加层上的全部修改 —— 术语的修改、新增、
 * 删除与适用网址的增删，生效内容回到当前版本的内置内容。只动这一个领域，
 * 领域顺序不变。自建领域抛错。返回恢复后的领域。
 *
 * 当前内置里已经没有的原词或网址，它们的删除记录也一并清掉：以后的版本
 * 加回它们时照常生效。这是恢复默认有意为之，与 #396 的“不复活”不冲突。
 */
export async function resetBuiltinDomain(id: string): Promise<Domain> {
  const base = BUILTIN_DOMAINS.find((d) => d.id === id);
  if (!base) throw new Error('[PT] 只有内置领域可以恢复默认');
  return updateStored((stored) => {
    const { [id]: prev, ...rest } = stored.builtin;
    const result = withOverlay(base, undefined);
    // 本来就没有叠加层：不写入
    if (!prev) return { stored: null, result };
    return { stored: { ...stored, builtin: rest }, result };
  });
}

/**
 * 内置领域是否有用户修改（#398）：生效的术语或适用网址与当前版本的内置
 * 内容不同。设置页据此决定是否显示“恢复默认”。自建领域一律返回 false。
 *
 * 只看生效内容：叠加层里只剩对当前内置已没有的原词或网址的删除记录时，
 * 对用户没有可见影响，不算修改。
 */
export function isBuiltinModified(d: Domain): boolean {
  const base = BUILTIN_DOMAINS.find((b) => b.id === d.id);
  if (!base) return false;
  return (
    d.sites.length !== base.sites.length ||
    d.sites.some((s, i) => s !== base.sites[i]) ||
    d.terms.length !== base.terms.length ||
    d.terms.some((t, i) => !sameTerm(t, base.terms[i]))
  );
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

/** 术语 CSV 的表头（#402）：列为原词、译法、不翻译，与 Term 的字段同名，不随界面语言变化。 */
const TERMS_CSV_HEADER = ['source', 'target', 'noTranslate'];

/**
 * 表格软件会当成公式的开头（#511）：= + - @、制表符、回车。导出时这类字段
 * 前面加一个单引号；原本就以单引号开头的字段也加，导入时才能区分。
 */
const FORMULA_START = /^[=+\-@\t\r']/;

/**
 * CSV 字段（RFC 4180）：含逗号、双引号或换行时加引号，双引号写两遍。
 * 以公式字符开头的加单引号前缀并加引号（#511），表格软件打开时不执行。
 */
function csvField(v: string): string {
  if (FORMULA_START.test(v)) return `"'${v.replace(/"/g, '""')}"`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * 去掉导出时加的公式前缀（#511）：单引号后面紧跟公式字符或单引号时去掉
 * 这一个，其余原样保留 —— 手写的“'til”不受影响。
 */
function stripFormulaGuard(v: string): string {
  return v.startsWith("'") && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v;
}

/**
 * 把领域的术语导出为 CSV（#402）：UTF-8 带 BOM（表格软件据此按 UTF-8
 * 打开），首行表头，行尾 CRLF。不翻译列写 true / false。以公式字符开头
 * 的原词与译法加单引号前缀（#511），导入时去掉。内置领域导出
 * 生效内容，含用户的修改、新增与删除。不存在的领域抛 DomainNotFoundError，
 * 读取失败时抛错。
 */
export async function exportDomainTermsCsv(id: string): Promise<string> {
  // 读取失败时抛错：退回空数据会把内置领域的原样内容当成用户的术语导出
  const domain = effectiveDomains(await readStoredStrict()).find((d) => d.id === id);
  if (!domain) throw new DomainNotFoundError(id);
  const rows = [
    TERMS_CSV_HEADER,
    ...domain.terms.map((t) => [t.source, t.target ?? '', String(t.noTranslate === true)]),
  ];
  return '\uFEFF' + rows.map((r) => r.map(csvField).join(',') + '\r\n').join('');
}

/** CSV 的一条记录（#404）：字段、在文件里起始的物理行号（从 1 起），引号是否没有闭合。 */
interface CsvRecord {
  fields: string[];
  line: number;
  unclosed?: boolean;
}

/**
 * 可识别的分隔符（#590）：逗号、分号（欧洲语言区 Excel 的默认）、制表符
 * （从其他工具复制出的术语表）。次数相同时按这里的先后取：制表符极少出现
 * 在术语里；逗号是缺省与导出格式，术语里的分号不改变分隔符。
 */
const CSV_DELIMITERS = ['\t', ',', ';'];

/**
 * 识别分隔符（#590）：数首条非空记录里引号以外的逗号、分号、制表符，取
 * 出现次数最多的那种；都没有出现时按逗号。只有空白与分隔符的行算空行，
 * 与导入时跳过的空行一致。引号规则与 parseCsv 相同，只有字段开头的双引号
 * 起引号。
 */
function detectDelimiter(src: string): string {
  const counts = new Map(CSV_DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let fieldStart = true;
  /** 当前行有分隔符与空白以外的内容。 */
  let content = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (c === '\n' || c === '\r') {
      // 首条非空记录到此结束；空行不算，重新计数
      if (content) break;
      counts.forEach((_, d) => counts.set(d, 0));
      fieldStart = true;
      continue;
    }
    const n = counts.get(c);
    if (n !== undefined) counts.set(c, n + 1);
    else if (c === '"' && fieldStart) quoted = content = true;
    else if (c.trim() !== '') content = true;
    fieldStart = n !== undefined;
  }
  let best = ',';
  let max = 0;
  for (const [d, n] of counts) {
    if (n > max) [best, max] = [d, n];
  }
  return best;
}

/**
 * 按 RFC 4180 把 CSV 文本拆成记录（#403）：字段开头的双引号起引号，引号内
 * 可含分隔符、换行与写两遍的双引号；行尾 CRLF、LF 或单独的 CR 都认；开头的 BOM 去掉，结尾的空行
 * 不算。引号没有闭合时，从那条记录起到文件结尾合成一条，标为未闭合。
 * 分隔符缺省为逗号，也可以是分号或制表符（#590）。
 */
function parseCsv(text: string, delimiter = ','): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  /** 当前物理行与当前记录的起始行（#404 报错用）。 */
  let line = 1;
  let start = 1;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') {
        field += c;
        // 引号内的换行也占物理行；CRLF 只算一次
        if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) line++;
      } else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') {
      // 只有字段开头的双引号才起引号；字段中间的（如英寸号 5"）按普通字符
      quoted = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      records.push({ fields: [...fields, field], line: start });
      fields = [];
      field = '';
      start = ++line;
    } else {
      field += c;
    }
  }
  if (quoted) records.push({ fields: [...fields, field], line: start, unclosed: true });
  else if (field !== '' || fields.length > 0) records.push({ fields: [...fields, field], line: start });
  return records;
}

/**
 * 把导入文件的字节转成文字（#590）：带 UTF-8 BOM 或是有效的 UTF-8 时按
 * UTF-8，否则按 GB18030（兼容 GBK、GB2312，中文 Windows 上 Excel 另存的
 * CSV 默认是 GBK、不带 BOM）。传入文字时原样返回。
 */
function decodeTermsCsv(input: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof input === 'string') return input;
  const head = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, Math.min(3, input.byteLength))
    : new Uint8Array(input, 0, Math.min(3, input.byteLength));
  // 带 BOM 就是 UTF-8：个别无效字节按替换字符读，不改按 GB18030
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return new TextDecoder('utf-8').decode(input);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    return new TextDecoder('gb18030').decode(input);
  }
}

/** 术语 CSV 表头可识别的列名（#590），去掉首尾空白、不区分大小写后比对。 */
const TERMS_CSV_COLUMNS: Record<string, 'source' | 'target' | 'noTranslate'> = {
  source: 'source',
  term: 'source',
  原词: 'source',
  原文: 'source',
  术语: 'source',
  english: 'source',
  target: 'target',
  translation: 'target',
  译法: 'target',
  译文: 'target',
  中文: 'target',
  chinese: 'target',
  notranslate: 'noTranslate',
  不翻译: 'noTranslate',
};

/** 表头里各列的位置（#590）与表头的列数。 */
interface TermsCsvHeader {
  source: number;
  target: number;
  noTranslate?: number;
  width: number;
}

/**
 * 识别表头（#590）：每个字段都是已知列名、同一种列不重复，并且有原词列
 * 与译法列时才算表头，列的顺序随意；否则返回 null，这一行按术语处理。
 */
function termsCsvHeader(fields: string[]): TermsCsvHeader | null {
  const at: Partial<Record<'source' | 'target' | 'noTranslate', number>> = {};
  for (const [i, f] of fields.entries()) {
    const col = TERMS_CSV_COLUMNS[f.trim().toLowerCase()];
    if (!col || at[col] !== undefined) return null;
    at[col] = i;
  }
  if (at.source === undefined || at.target === undefined) return null;
  return { source: at.source, target: at.target, noTranslate: at.noTranslate, width: fields.length };
}

/**
 * 导入时跳过的行的原因（#404）：列数不对（有表头时应与表头列数相同，
 * 没有表头时应为 2 或 3 列，#590）、原词为空、没勾“不翻译”
 * 也没有译法、不翻译列不是 true / false、引号没有闭合（从这一行到文件
 * 结尾都跳过）。
 */
export type TermsCsvSkipReason = 'columns' | 'missingSource' | 'missingTarget' | 'noTranslate' | 'quote';

/** 导入时跳过的一行（#404）：文件里的物理行号（从 1 起）与原因。 */
export interface TermsCsvSkip {
  line: number;
  reason: TermsCsvSkipReason;
}

/**
 * 把 CSV 文件里的术语导入到领域（#403），本扩展导出的格式之外，也接受
 * 用户自己整理的术语表（#590）：
 * - 传入文件字节时识别编码：UTF-8，否则按 GB18030；
 * - 分隔符识别逗号、分号、制表符；
 * - 首行是表头（如 source,target,noTranslate、原词,译法、English,Chinese）
 *   时跳过，并按表头的列名对应列，返回表头的列数 headerColumns；
 * - 没有表头时按位置对应原词、译法、不翻译，第三列可省。
 *
 * 原词与译法去掉导出时加的公式前缀（#511）；不翻译列为 true / 1 时勾选，
 * false / 0 / 空时不勾选（不区分大小写）。与现有术语合并：同一原词（不区分
 * 大小写）以导入为准、留在原位，新原词追加在后，文件里没有的术语不动；
 * 文件里同一原词出现多次时后出现的为准。内置领域写入叠加层。
 *
 * 格式错误的行跳过（#404），按文件里的物理行号列在 skipped 里，其他行
 * 照常导入。返回导入的行数，空行不算；没有可导入的行时不写入。不存在
 * 的领域抛 DomainNotFoundError。
 */
export async function importDomainTermsCsv(
  id: string,
  csv: string | ArrayBuffer | ArrayBufferView,
): Promise<TermsCsvImport> {
  const { incoming, skipped, extra } = parseTermsCsv(csv);
  return updateStored((stored) => {
    const domain = effectiveDomains(stored).find((d) => d.id === id);
    if (!domain) throw new DomainNotFoundError(id);
    // 没有可导入的行：不写入
    if (incoming.length === 0) return { stored: null, result: { imported: 0, skipped, ...extra } };
    // 逐行校验过，这里只做整理（去首尾空格），不会再有不合法的行
    const { stored: next } = withTerms(stored, id, cleanTerms(mergeTerms(domain.terms, incoming)));
    return { stored: next, result: { imported: incoming.length, skipped, ...extra } };
  });
}

/** 导入术语 CSV 的结果（#403、#404、#590）：导入的行数、跳过的行，有表头时带表头的列数。 */
export interface TermsCsvImport {
  imported: number;
  skipped: TermsCsvSkip[];
  headerColumns?: number;
}

/**
 * 从术语 CSV 新建自建领域（#603）：名称与目标语言同 createDomain，术语为
 * 文件里可导入的行，一次写入。文件格式、跳过的行与往已有领域导入相同；
 * 文件里同一原词出现多次时后出现的为准。名称或目标语言为空时抛错；
 * 没有可导入的行时不新建，domain 为 null；写入失败时抛错，不留下领域。
 */
export async function createDomainFromTermsCsv(
  input: { name: string; targetLang: string },
  csv: string | ArrayBuffer | ArrayBufferView,
): Promise<TermsCsvImport & { domain: Domain | null }> {
  // 先校验名称与目标语言：为空时不必解析文件
  newUserDomain(input, []);
  const { incoming, skipped, extra } = parseTermsCsv(csv);
  if (incoming.length === 0) return { domain: null, imported: 0, skipped, ...extra };
  const domain = newUserDomain(input, cleanTerms(mergeTerms([], incoming)));
  return updateUserDomains((user) => ({
    user: [...user, domain],
    result: { domain, imported: incoming.length, skipped, ...extra },
  }));
}

/**
 * 把术语合并进已有术语（#403）：同一原词（不区分大小写）以后来的为准、
 * 留在原位，新原词追加在后。
 */
function mergeTerms(base: readonly Term[], incoming: readonly Term[]): Term[] {
  const merged = [...base];
  const at = new Map(merged.map((t, i) => [termKey(t), i]));
  for (const t of incoming) {
    const i = at.get(termKey(t));
    if (i === undefined) at.set(termKey(t), merged.push(t) - 1);
    else merged[i] = t;
  }
  return merged;
}

/**
 * 解析术语 CSV（#403、#404、#590）：识别编码、分隔符与表头，逐行校验。
 * 返回可导入的术语、跳过的行，以及有表头时的表头列数。往已有领域导入与
 * 从 CSV 新建领域（#603）共用。
 */
function parseTermsCsv(csv: string | ArrayBuffer | ArrayBufferView): {
  incoming: Term[];
  skipped: TermsCsvSkip[];
  extra: { headerColumns?: number };
} {
  const text = decodeTermsCsv(csv).replace(/^\uFEFF/, '');
  const records = parseCsv(text, detectDelimiter(text));
  // 表头在第一条非空记录（开头的空行不算），与识别分隔符取同一条
  const at = records.findIndex((r) => r.unclosed || r.fields.some((f) => f.trim() !== ''));
  const first = records[at];
  const header = first && !first.unclosed ? termsCsvHeader(first.fields) : null;
  if (header) records.splice(at, 1);
  // 没有表头时按位置：原词、译法、不翻译（可省）
  const cols = header ?? { source: 0, target: 1, noTranslate: 2 };
  const extra = header ? { headerColumns: header.width } : {};
  const incoming: Term[] = [];
  const skipped: TermsCsvSkip[] = [];
  for (const { fields, line, unclosed } of records) {
    if (unclosed) {
      skipped.push({ line, reason: 'quote' });
      continue;
    }
    // 空行（文件中间或结尾多出的换行）不算
    if (fields.every((f) => f.trim() === '')) continue;
    if (header ? fields.length !== header.width : fields.length !== 2 && fields.length !== 3) {
      skipped.push({ line, reason: 'columns' });
      continue;
    }
    const source = stripFormulaGuard(fields[cols.source]!);
    const target = stripFormulaGuard(fields[cols.target]!);
    const flag = cols.noTranslate === undefined ? '' : (fields[cols.noTranslate] ?? '');
    const noTranslate = flag.trim().toLowerCase();
    if (!['true', '1', 'false', '0', ''].includes(noTranslate)) {
      skipped.push({ line, reason: 'noTranslate' });
    } else if (!source.trim()) {
      skipped.push({ line, reason: 'missingSource' });
    } else if (noTranslate === 'true' || noTranslate === '1') {
      incoming.push({ source, noTranslate: true });
    } else if (!target.trim()) {
      skipped.push({ line, reason: 'missingTarget' });
    } else {
      incoming.push({ source, target });
    }
  }
  return { incoming, skipped, extra };
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
 * 读取失败时交付只剩内置领域内置内容的列表，不抛错（#535）。
 *
 * initial 为真时（#486）订阅后立即读取一次、交付初始列表。初始读取与之后
 * 的变更读取按发起先后判定：变更读取先返回时，较早的初始读取不再交付。
 * 页面拿初始值加订阅变更一律用它，不要自己另读一次。
 */
export function watchEffectiveDomains(
  fn: (domains: Domain[]) => void,
  { initial = false }: { initial?: boolean } = {},
): () => void {
  let latest = 0;
  let active = true;
  const load = () => {
    const seq = ++latest;
    void readStored().then(effectiveDomains).then((domains) => {
      if (active && seq === latest) fn(domains);
    });
  };
  const off = onDomainsChanged(load);
  if (initial) load();
  return () => {
    active = false;
    off();
  };
}

/**
 * 用户在 popup 里为当前标签页临时选的领域（#400）：自动（按网址判定）、
 * 无领域（临时关闭术语约束），或指定某个领域。只在该标签页内有效，
 * 刷新或关闭后回到自动。
 */
export type DomainChoice = { kind: 'auto' } | { kind: 'none' } | { kind: 'domain'; id: string };

/** 校验跨上下文传来的临时领域选择（#400）；形状不对返回 null。 */
export function parseDomainChoice(v: unknown): DomainChoice | null {
  const c = v as Partial<{ kind: unknown; id: unknown }> | null | undefined;
  if (c?.kind === 'auto' || c?.kind === 'none') return { kind: c.kind };
  if (c?.kind === 'domain' && typeof c.id === 'string') return { kind: 'domain', id: c.id };
  return null;
}

/**
 * 当前领域：列表中第一个目标语言一致、且适用网址命中 host 的领域。
 * 目标语言不一致的领域不启用，继续看后面的领域；都不命中返回 null。
 *
 * 带上临时选择（#400）时：选“无领域”返回 null；指定的领域网址不命中也
 * 用它；指定的领域已被删除或不服务这个目标语言时，退回自动判定。
 */
export function currentDomain(
  domains: readonly Domain[],
  host: string,
  targetLang: string,
  choice: DomainChoice = { kind: 'auto' },
): Domain | null {
  const lang = targetLang.toLowerCase();
  if (choice.kind === 'none') return null;
  if (choice.kind === 'domain') {
    const chosen = domains.find((d) => d.id === choice.id && d.targetLang.toLowerCase() === lang);
    if (chosen) return chosen;
  }
  return (
    domains.find(
      (d) =>
        d.targetLang.toLowerCase() === lang &&
        d.sites.some((entry) => siteMatches(host, entry)),
    ) ?? null
  );
}
