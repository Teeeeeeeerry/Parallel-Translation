// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 内置领域叠加层（#1149，父 #1140）：内置领域 + 用户叠加层 → 生效领域，以及
// 用户修改适用网址、术语后的新叠加层。纯函数，不碰存储，不 import 站点页面
// 规则模块（ADR-0004）。
//
// 叠加层（#395）按原词记录用户对术语的修改、新增与删除（#396），按网址记录
// 用户对适用网址的增删（#397）。生效内容 = 当前版本的内置内容 + 叠加层，同一
// 原词（不区分大小写）或网址以叠加层为准，所以升级带来的新内置术语和网址
// 照样生效，用户改过或删掉的不被覆盖、不会复活。“删了不复活、全空就去掉
// 这一条”只在下面写一份，适用网址与术语共用。
//
// 恢复默认（#398）就是去掉这个领域的叠加层：applyOverlay(base, undefined)。

import type { Domain, Term } from './domains';

/** 一个内置领域的用户叠加层。 */
export interface BuiltinOverlay {
  /** 与内置不同的术语（修改）和内置没有的术语（新增），按保存顺序。 */
  terms: Term[];
  /** 用户删掉的内置术语的原词（去掉首尾空格、小写，#396）。 */
  removedTerms: string[];
  /** 用户新增的适用网址（#397），按保存顺序。 */
  addedSites: string[];
  /** 用户删掉的内置适用网址（#397）。 */
  removedSites: string[];
}

/** 术语的原词键：去掉首尾空格，不区分大小写。 */
export function termKey(t: Term): string {
  return t.source.trim().toLowerCase();
}

/** 两条术语的原词（不区分大小写）、译法与“不翻译”标记都相同。 */
export function sameTerm(a: Term, b: Term | undefined): boolean {
  return (
    b !== undefined &&
    termKey(a) === termKey(b) &&
    (a.target ?? '') === (b.target ?? '') &&
    (a.noTranslate === true) === (b.noTranslate === true)
  );
}

/**
 * 内置领域叠加用户的修改、新增（#395）与删除（#396）：修改的术语留在原位，
 * 新增的排在最后，删掉的不出现。适用网址的增删（#397）同理。
 */
export function applyOverlay(base: Domain, overlay: BuiltinOverlay | undefined): Domain {
  const own = new Map((overlay?.terms ?? []).map((t) => [termKey(t), t]));
  const removed = new Set(overlay?.removedTerms ?? []);
  const terms = base.terms.flatMap((t) => {
    const mine = own.get(termKey(t));
    own.delete(termKey(t));
    if (!mine && removed.has(termKey(t))) return [];
    return [{ ...(mine ?? t) }];
  });
  // 适用网址（#397）：内置网址去掉删掉的，再接上新增的（内置已有的不重复）
  const removedSites = new Set(overlay?.removedSites ?? []);
  const sites = base.sites.filter((s) => !removedSites.has(s));
  return {
    ...base,
    sites: [...sites, ...(overlay?.addedSites ?? []).filter((s) => !sites.includes(s))],
    terms: [...terms, ...[...own.values()].map((t) => ({ ...t }))],
  };
}

/**
 * 删除记录（#396、#397）：这次去掉的内置项，加上以前删掉、当前版本内置里
 * 暂时没有的项 —— 以后的版本加回它时仍不复活。以前删掉、这次又加回来的
 * 不再算删除。
 */
function removedKeys(prev: readonly string[], builtin: readonly string[], kept: ReadonlySet<string>): string[] {
  return [
    ...new Set([
      ...prev.filter((k) => !builtin.includes(k) && !kept.has(k)),
      ...builtin.filter((k) => !kept.has(k)),
    ]),
  ];
}

/** 叠加层全部为空时去掉这一条（undefined），否则原样返回。 */
function nonEmpty(overlay: BuiltinOverlay): BuiltinOverlay | undefined {
  return Object.values(overlay).every((v) => Array.isArray(v) && v.length === 0) ? undefined : overlay;
}

/**
 * 把内置领域的适用网址整体换成 sites（已整理、合法）之后的叠加层（#397）：
 * 只记新增的网址和删掉的内置网址，叠加层的其他记录原样保留。全部为空时
 * 返回 undefined。生效顺序固定为内置网址（去掉删掉的）在前、新增的按保存
 * 顺序在后。
 */
export function overlayWithSites(
  base: Domain,
  prev: BuiltinOverlay | undefined,
  sites: readonly string[],
): BuiltinOverlay | undefined {
  return nonEmpty({
    terms: [],
    removedTerms: [],
    ...prev,
    addedSites: sites.filter((s) => !base.sites.includes(s)),
    removedSites: removedKeys(prev?.removedSites ?? [], base.sites, new Set(sites)),
  });
}

/**
 * 把内置领域的术语整体换成 terms（已整理）之后的叠加层（#395、#396）：只记
 * 与内置不同的和新增的术语，与内置相同的不记（之后跟随新版内置）；去掉的
 * 内置术语记为已删除。叠加层的其他记录原样保留。全部为空时返回 undefined。
 */
export function overlayWithTerms(
  base: Domain,
  prev: BuiltinOverlay | undefined,
  terms: readonly Term[],
): BuiltinOverlay | undefined {
  const builtinTerms = new Map(base.terms.map((t) => [termKey(t), t]));
  return nonEmpty({
    addedSites: [],
    removedSites: [],
    ...prev,
    terms: terms.filter((t) => !sameTerm(t, builtinTerms.get(termKey(t)))),
    removedTerms: removedKeys(prev?.removedTerms ?? [], [...builtinTerms.keys()], new Set(terms.map(termKey))),
  });
}

/** 该原词是否为这个内置领域在当前版本内置的术语（#395）。 */
export function isBaseTerm(base: Domain, source: string): boolean {
  const key = source.trim().toLowerCase();
  return base.terms.some((t) => termKey(t) === key);
}

/**
 * 生效领域与当前版本的内置内容是否不同（#398）。只看生效内容：叠加层里只剩
 * 对当前内置已没有的原词或网址的删除记录时，对用户没有可见影响，不算修改。
 */
export function isOverlayModified(base: Domain, effective: Domain): boolean {
  return (
    effective.sites.length !== base.sites.length ||
    effective.sites.some((s, i) => s !== base.sites[i]) ||
    effective.terms.length !== base.terms.length ||
    effective.terms.some((t, i) => !sameTerm(t, base.terms[i]))
  );
}
