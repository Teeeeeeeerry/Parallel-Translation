// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 术语 CSV（#1148，父 #1140）：术语 ⇄ 文本的编解码，纯函数，不碰存储。
//
// 原先写在领域存储模块里。导出（#402）、导入（#403）、跳过行带行号与原因
// （#404）、公式前缀（#511）、编码 / 分隔符 / 表头识别（#590）的规则原样搬来；
// 领域存储只负责把解码出的术语合并进领域、写入。

import type { Term } from './domains';

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
 * 把术语编码为 CSV（#402）：UTF-8 带 BOM（表格软件据此按 UTF-8 打开），首行
 * 表头，行尾 CRLF。不翻译列写 true / false。以公式字符开头的原词与译法加
 * 单引号前缀（#511），解码时去掉。
 */
export function encodeTermsCsv(terms: readonly Term[]): string {
  const rows = [
    TERMS_CSV_HEADER,
    ...terms.map((t) => [t.source, t.target ?? '', String(t.noTranslate === true)]),
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
function bytesToText(input: string | ArrayBuffer | ArrayBufferView): string {
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

/** 解码的结果：可导入的术语、跳过的行（带行号与原因），有表头时带表头的列数。 */
export interface DecodedTermsCsv {
  terms: Term[];
  skipped: TermsCsvSkip[];
  headerColumns?: number;
}

/**
 * 解码术语 CSV（#403、#404、#590）：识别编码、分隔符与表头，逐行校验。
 * 本扩展导出的格式之外，也接受用户自己整理的术语表：
 * - 传入文件字节时识别编码：UTF-8，否则按 GB18030；
 * - 分隔符识别逗号、分号、制表符；
 * - 首行是表头（如 source,target,noTranslate、原词,译法、English,Chinese）
 *   时跳过，并按表头的列名对应列；没有表头时按位置对应原词、译法、不翻译，
 *   第三列可省。
 *
 * 原词与译法去掉导出时加的公式前缀（#511）；不翻译列为 true / 1 时勾选，
 * false / 0 / 空时不勾选（不区分大小写）。格式错误的行跳过，按物理行号
 * 列在 skipped 里；空行不算。文件里同一原词出现多次时都留着，合并时后出现
 * 的为准（由调用方合并）。
 */
export function decodeTermsCsv(csv: string | ArrayBuffer | ArrayBufferView): DecodedTermsCsv {
  const text = bytesToText(csv).replace(/^\uFEFF/, '');
  const records = parseCsv(text, detectDelimiter(text));
  // 表头在第一条非空记录（开头的空行不算），与识别分隔符取同一条
  const at = records.findIndex((r) => r.unclosed || r.fields.some((f) => f.trim() !== ''));
  const first = records[at];
  const header = first && !first.unclosed ? termsCsvHeader(first.fields) : null;
  if (header) records.splice(at, 1);
  // 没有表头时按位置：原词、译法、不翻译（可省）
  const cols = header ?? { source: 0, target: 1, noTranslate: 2 };
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
  return header ? { terms: incoming, skipped, headerColumns: header.width } : { terms: incoming, skipped };
}
