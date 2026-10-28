#!/usr/bin/env npx tsx
/**
 * build-builtin-domains.ts
 *
 * 从外部术语库包生成内置领域数据 src/storage/builtin-glossary-data.ts。
 *
 * 用法：
 *   npx tsx scripts/build-builtin-domains.ts <术语库包目录>
 *
 * 术语库包不在本仓库里，也不随扩展分发：脚本读它的 terminology/clean/*.csv
 *（三列 source,target,tgt_lng；文件名 [词表]_zh-CN.csv / _zh-TW.csv，无语言
 * 后缀的是 auto 词表，表示原样保留）。本次生成用的上游是
 * <https://github.com/immersive-translate/terms> 提交
 * 46f8686f4278ed0a5bf20c81a07a07b09ddf877e（经 translation-terminology 包
 * 清洗），上游未声明许可证，公开再分发前须自行确认授权。这条来源记录只留在
 * 本脚本，不进入扩展产物与用户界面。
 *
 * 生成规则（都是有意的取舍，改之前先读一遍）：
 * - 一个词表、一种目标语言一个领域（领域只服务一种目标语言）。
 * - auto 词表并进同主题的领域，标“不翻译”：同一批词在简体、繁体两边都要有。
 *   default（LLM 等）并进技术领域。
 * - 适用网址只收「站点本身就是这套词的主场」的裸域名（本扩展只按主机名匹配，
 *   语法见 src/dom/site-filter.ts）。共享站点上的路径限定（Discord 频道、
 *   ESPN / BBC 的网球栏目等）表达不了，直接不收，让用户在 popup 里手选。
 *   生物词表原配的 wikipedia 之类太宽泛：class / order / family 在通用页面上
 *   会被误伤，也不收。
 * - 术语顺序沿用 CSV；同一领域里原词（不区分大小写）重复、空原词、空译法都
 *   直接报错，不带病生成。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 一个术语库的元数据；顺序即生成后的内置领域顺序。 */
interface GlossaryMeta {
  /** 术语库 ID（clean 目录里的文件名前缀）。 */
  id: string;
  /** 简体中文领域名。 */
  nameZhCN: string;
  /** 繁体中文领域名。 */
  nameZhTW: string;
  /** 适用网址（裸域名，小写）。 */
  sites: string[];
}

/** 36 个术语库。名称按目标语言的惯用叫法写，不随扩展界面语言变化。 */
const GLOSSARIES: readonly GlossaryMeta[] = [
  { id: 'access-control', nameZhCN: '访问控制', nameZhTW: '存取控制', sites: [] },
  { id: 'ao3', nameZhCN: 'AO3', nameZhTW: 'AO3', sites: [] },
  { id: 'bg3', nameZhCN: '博德之门 3', nameZhTW: '柏德之門 3', sites: ['bg3.wiki'] },
  { id: 'biology', nameZhCN: '生物', nameZhTW: '生物', sites: [] },
  { id: 'car', nameZhCN: '汽车', nameZhTW: '汽車', sites: [] },
  { id: 'chess', nameZhCN: '国际象棋', nameZhTW: '西洋棋', sites: [] },
  { id: 'ecommerce', nameZhCN: '电商', nameZhTW: '電商', sites: [] },
  { id: 'education', nameZhCN: '教育', nameZhTW: '教育', sites: [] },
  { id: 'fashion', nameZhCN: '时尚', nameZhTW: '時尚', sites: [] },
  { id: 'finance', nameZhCN: '金融', nameZhTW: '金融', sites: [] },
  { id: 'food', nameZhCN: '餐饮', nameZhTW: '餐飲', sites: [] },
  { id: 'game', nameZhCN: '游戏', nameZhTW: '遊戲', sites: [] },
  { id: 'gardening', nameZhCN: '园艺', nameZhTW: '園藝', sites: [] },
  { id: 'golf', nameZhCN: '高尔夫', nameZhTW: '高爾夫', sites: [] },
  { id: 'hd2', nameZhCN: '绝地潜兵 2', nameZhTW: '絕地戰兵 2', sites: [] },
  { id: 'legal', nameZhCN: '法律', nameZhTW: '法律', sites: [] },
  { id: 'medical', nameZhCN: '医学', nameZhTW: '醫學', sites: [] },
  { id: 'movie', nameZhCN: '影视', nameZhTW: '影視', sites: [] },
  { id: 'music', nameZhCN: '音乐', nameZhTW: '音樂', sites: [] },
  { id: 'news', nameZhCN: '新闻', nameZhTW: '新聞', sites: [] },
  {
    id: 'packraft',
    nameZhCN: '背包船',
    nameZhTW: '背包船',
    sites: ['packraft.org', 'thingstolucat.com', 'alpackaraft.com'],
  },
  { id: 'pet', nameZhCN: '宠物', nameZhTW: '寵物', sites: [] },
  { id: 'photography', nameZhCN: '摄影', nameZhTW: '攝影', sites: [] },
  { id: 'programming', nameZhCN: '编程', nameZhTW: '程式設計', sites: [] },
  {
    id: 'programming-contest',
    nameZhCN: '编程竞赛',
    nameZhTW: '程式競賽',
    sites: [
      'codeforces.com',
      'atcoder.jp',
      'vjudge.net',
      'qoj.ac',
      'codechef.com',
      'onlinejudge.org',
      'poj.org',
      'cp-algorithms.com',
      'icpc.global',
    ],
  },
  { id: 'Shelter69-Slang', nameZhCN: 'Shelter69 俚语', nameZhTW: 'Shelter69 俚語', sites: [] },
  { id: 'sports', nameZhCN: '体育', nameZhTW: '體育', sites: [] },
  { id: 'stellar-blade-clothing', nameZhCN: '剑星服装', nameZhTW: '劍星服裝', sites: [] },
  { id: 'tech', nameZhCN: '技术', nameZhTW: '技術', sites: [] },
  {
    id: 'tennis',
    nameZhCN: '网球',
    nameZhTW: '網球',
    sites: [
      'atptour.com',
      'wtatennis.com',
      'itftennis.com',
      'usopen.org',
      'wimbledon.com',
      'rolandgarros.com',
      'ausopen.com',
      'daviscup.com',
    ],
  },
  { id: 'travel', nameZhCN: '旅行', nameZhTW: '旅行', sites: [] },
  { id: 'twitter', nameZhCN: 'Twitter', nameZhTW: 'Twitter', sites: ['twitter.com', 'x.com'] },
  { id: 'Vocaloid', nameZhCN: 'Vocaloid', nameZhTW: 'Vocaloid', sites: [] },
  { id: 'web3', nameZhCN: 'Web3', nameZhTW: 'Web3', sites: [] },
  { id: 'wuthering-waves', nameZhCN: '鸣潮', nameZhTW: '鳴潮', sites: ['wuthering.gg'] },
];

/**
 * auto 词表并进哪个术语库（该词表没有独立领域）。auto 词表在 clean 目录里
 * 是没有语言后缀的 CSV，target 与 source 相同，导入后按“不翻译”处理。
 */
const AUTO_MERGE: Readonly<Record<string, string>> = {
  default: 'tech',
  game: 'game',
  programming: 'programming',
  tech: 'tech',
  web3: 'web3',
};

/** 内置领域支持的目标语言。 */
type GlossaryLang = 'zh-CN' | 'zh-TW';

const LANGS: readonly GlossaryLang[] = ['zh-CN', 'zh-TW'];

/** 一个术语的中间表示：noTranslate 为真时不需要译法。 */
interface GeneratedTerm {
  source: string;
  target?: string;
  noTranslate?: boolean;
}

/** 生成后的一个领域。 */
interface GeneratedDomain {
  id: string;
  name: string;
  targetLang: GlossaryLang;
  sites: string[];
  terms: GeneratedTerm[];
}

const ROOT = path.resolve(process.argv[2] ?? '');
const CLEAN_DIR = path.join(ROOT, 'terminology', 'clean');
const OUTPUT = path.resolve('src/storage/builtin-glossary-data.ts');

/** 术语库 ID 在领域 ID 里的小写形式。 */
function slug(id: string): string {
  return id.toLowerCase();
}

/** 按 RFC 4180 拆 CSV（术语库里只有逗号与引号，不必猜分隔符）。 */
function parseCsv(src: string): string[][] {
  const text = src.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push([...fields, field]);
      fields = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || fields.length > 0) rows.push([...fields, field]);
  return rows;
}

/** 读一个 clean CSV，返回 source / target 两列；表头固定是 source,target,tgt_lng。 */
function readCsv(file: string): { source: string; target: string }[] {
  const rows = parseCsv(fs.readFileSync(file, 'utf-8'));
  const [header, ...body] = rows;
  if (!header || header.join(',') !== 'source,target,tgt_lng') {
    throw new Error(`${file}：表头不是 source,target,tgt_lng`);
  }
  return body
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r, i) => {
      if (r.length !== 3) throw new Error(`${file} 第 ${i + 2} 行：不是三列`);
      return { source: r[0]!, target: r[1]! };
    });
}

/** auto 词表：target 与 source 相同，读成“不翻译”。 */
function readAuto(file: string): GeneratedTerm[] {
  return readCsv(file).map(({ source, target }) => {
    if (source !== target) throw new Error(`${file}：auto 词表的整行 ${source} 译法与原文不一致`);
    return { source, noTranslate: true };
  });
}

/**
 * 同一领域内的术语校验与去重：原词非空、没有首尾空白、不区分大小写不重复；
 * 指定译法的术语译法非空。同一领域里重复原词直接报错 —— 数据有问题就不要
 * 生成带病的内置领域。
 */
function normalizeTerms(domainId: string, terms: readonly GeneratedTerm[]): GeneratedTerm[] {
  const seen = new Map<string, GeneratedTerm>();
  const out: GeneratedTerm[] = [];
  for (const term of terms) {
    const source = term.source.trim();
    if (!source) throw new Error(`${domainId}：原词为空`);
    const key = source.toLowerCase();
    if (seen.has(key)) throw new Error(`${domainId}：原词重复 ${source}`);
    if (!term.noTranslate) {
      const target = (term.target ?? '').trim();
      if (!target) throw new Error(`${domainId}：${source} 没有译法也没标不翻译`);
      if (target !== term.target) throw new Error(`${domainId}：${source} 的译法有首尾空白`);
      const normalized = { source, target };
      seen.set(key, normalized);
      out.push(normalized);
    } else {
      const normalized = { source, noTranslate: true };
      seen.set(key, normalized);
      out.push(normalized);
    }
  }
  return out;
}

/** 适用网址必须是裸域名，和领域存储里的口径一致。 */
function checkSites(id: string, sites: readonly string[]): void {
  const seen = new Set<string>();
  for (const s of sites) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
      throw new Error(`${id}：适用网址 ${s} 不是裸域名`);
    }
    if (seen.has(s)) throw new Error(`${id}：适用网址重复 ${s}`);
    seen.add(s);
  }
}

/** 术语在生成文件里的一行；用 JSON.stringify 处理引号与反斜杠。 */
function termLine(term: GeneratedTerm): string {
  if (term.noTranslate) return `      { source: ${JSON.stringify(term.source)}, noTranslate: true },`;
  return `      { source: ${JSON.stringify(term.source)}, target: ${JSON.stringify(term.target)} },`;
}

function main(): void {
  if (!process.argv[2]) {
    console.error('用法：npx tsx scripts/build-builtin-domains.ts <术语库包目录>');
    process.exit(1);
  }
  if (!fs.existsSync(CLEAN_DIR)) {
    console.error(`找不到 ${CLEAN_DIR}；参数要指向术语库包的根目录`);
    process.exit(1);
  }

  // clean 目录里的文件都要有归属，漏掉或写错文件名直接报错
  const files = new Set(fs.readdirSync(CLEAN_DIR).filter((f) => f.endsWith('.csv')));
  const known = new Set<string>();

  // 翻译词表：词表 ID → 语言 → 术语。每个词表至少有一种目标语言
  const translated = new Map<string, Map<GlossaryLang, GeneratedTerm[]>>();
  for (const g of GLOSSARIES) {
    const byLang = new Map<GlossaryLang, GeneratedTerm[]>();
    for (const lang of LANGS) {
      const name = `${g.id}_${lang}.csv`;
      if (!files.has(name)) continue;
      known.add(name);
      byLang.set(lang, readCsv(path.join(CLEAN_DIR, name)).map((r) => ({ source: r.source, target: r.target })));
    }
    if (byLang.size === 0) throw new Error(`术语库 ${g.id} 没有翻译词表`);
    translated.set(g.id, byLang);
  }

  // auto 词表并进同主题领域：两种目标语言都要加一遍
  for (const [autoId, into] of Object.entries(AUTO_MERGE)) {
    const name = `${autoId}.csv`;
    if (!files.has(name)) throw new Error(`clean 目录缺 auto 词表 ${name}`);
    known.add(name);
    const target = translated.get(into);
    if (!target) throw new Error(`auto 词表 ${autoId} 要并进的 ${into} 不在 GLOSSARIES 里`);
    const terms = readAuto(path.join(CLEAN_DIR, name));
    for (const lang of target.keys()) {
      target.get(lang)!.push(...terms);
    }
  }

  for (const f of files) {
    if (!known.has(f)) throw new Error(`clean 目录里的 ${f} 没有登记：补进 GLOSSARIES 或 AUTO_MERGE`);
  }

  const domains: GeneratedDomain[] = [];
  for (const g of GLOSSARIES) {
    checkSites(g.id, g.sites);
    const byLang = translated.get(g.id)!;
    for (const lang of LANGS) {
      const terms = byLang.get(lang);
      if (!terms) continue;
      const name = lang === 'zh-TW' ? g.nameZhTW : g.nameZhCN;
      const suffix = lang === 'zh-TW' ? '(繁體中文)' : '(简体中文)';
      const id = `builtin:${slug(g.id)}-${lang}`;
      domains.push({
        id,
        name: `${name}${suffix}`,
        targetLang: lang,
        sites: [...g.sites],
        terms: normalizeTerms(id, terms),
      });
    }
  }

  // 名称唯一、ID 唯一
  for (const key of ['id', 'name'] as const) {
    const seen = new Set<string>();
    for (const d of domains) {
      if (seen.has(d[key])) throw new Error(`内置领域${key === 'id' ? ' ID' : '名'}重复：${d[key]}`);
      seen.add(d[key]);
    }
  }

  const lines: string[] = [];
  lines.push(
    '// SPDX-License-Identifier: GPL-3.0-or-later',
    '// Copyright (C) 2026 Parallel-Translation contributors',
    '//',
    '// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，',
    '// 不含任何担保。完整条款见仓库根目录的 LICENSE。',
    '',
    '// 本文件由 scripts/build-builtin-domains.ts 生成，不要手改。',
    '// 数据来源与重新生成的方法见该脚本的文件头。',
    '',
    "import type { Domain } from './domains';",
    '',
    '/** 从术语库生成的内置领域，顺序即默认优先级。 */',
    'export const BUILTIN_GLOSSARY_DOMAINS: readonly Domain[] = [',
  );
  for (const d of domains) {
    lines.push('  {');
    lines.push(`    id: ${JSON.stringify(d.id)},`);
    lines.push(`    name: ${JSON.stringify(d.name)},`);
    lines.push(`    targetLang: ${JSON.stringify(d.targetLang)},`);
    lines.push(`    sites: [${d.sites.map((s) => JSON.stringify(s)).join(', ')}],`);
    lines.push("    origin: 'builtin',");
    lines.push('    terms: [');
    for (const t of d.terms) lines.push(termLine(t));
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('];', '');

  fs.writeFileSync(OUTPUT, lines.join('\n'));
  const total = domains.reduce((n, d) => n + d.terms.length, 0);
  const zhCN = domains.filter((d) => d.targetLang === 'zh-CN').reduce((n, d) => n + d.terms.length, 0);
  console.log(`生成 ${domains.length} 个内置领域、${total} 条术语（简体 ${zhCN} 条）→ ${OUTPUT}`);
}

main();
