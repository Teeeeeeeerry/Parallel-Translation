#!/usr/bin/env tsx
/**
 * generate-test-stubs.ts
 *
 * 从 DEEP-TESTING.md 自动生成测试桩文件 / 校验文档与代码同步（#121）。
 *
 * 用法：
 *   pnpm tsx docs/testing/generate-test-stubs.ts           # 生成全部桩
 *   pnpm tsx docs/testing/generate-test-stubs.ts --dry-run # 预览不写入
 *   pnpm tsx docs/testing/generate-test-stubs.ts --verify  # 检查文档与代码同步状态
 *
 * 工作原理：
 *   1. 解析 DEEP-TESTING.md 中描述的测试用例
 *   2. 按分层声明把用例解析到实际测试文件（unit/integration/e2e/artifacts 目录扫描）
 *   3. 归一化标题 + 模糊匹配，区分「已实现 / 标题差异 / 缺失」
 *   4. 为缺失的测试文件生成桩代码（test.skip + 描述）
 *
 * 用例→文件解析（#121 修复）：
 *   - E2E 用例按 TC-E2E-NN 编号扫描 e2e/*.spec.ts 定位（不再硬编码 core.spec.ts）
 *   - describe 块优先取「测试文件：」注解（相对 docs/testing 解析），
 *     否则按模块名扫描目录中实际包含该 describe 的文件
 *
 * 用例匹配（#121 修复）：
 *   - 标题归一化：去括号内容（#NN 回归等）、去 @tag/TC 编号、去标点与空白
 *   - 依次尝试：归一化精确相等 → 包含关系 → 二元组 Jaccard 相似度
 *   - 命中但措辞不同记「标题差异」，不再误报「未实现」
 *
 * 生成规则：
 *   - 如果对应的测试文件已存在 → 跳过，报告"已实现/标题差异"
 *   - 如果对应文件不存在 → 生成桩文件（所有用例标记为 test.skip）
 */

import fs from 'fs';
import path from 'path';

// ---- 配置 ----

const TESTING_DIR = path.resolve('docs/testing');
const DOC_PATH = path.resolve('docs/DEEP-TESTING.md');

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

/** 模糊匹配阈值：二元组 Jaccard 相似度下限 */
const SIM_THRESHOLD = 0.4;

// ---- 用例提取 ----

interface TestCase {
  name: string;
  module: string;
  category: 'unit' | 'integration' | 'e2e' | 'artifacts';
  /** 相对 docs/testing 的路径；E2E 用例留空，运行期按 TC 编号定位 */
  file: string;
  /** E2E 用例编号（TC-E2E-NN） */
  tcNumber?: number;
}

/** 递归扫描目录下的测试文件，返回相对 TESTING_DIR 的路径 */
function scanTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...scanTestFiles(p));
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) {
      out.push(path.relative(TESTING_DIR, p).replace(/\\/g, '/'));
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在分类目录中查找包含 describe('module') 的测试文件 */
function findFileByModule(module: string, category: TestCase['category']): string | null {
  const dirName = { unit: 'unit', integration: 'integration', e2e: 'e2e', artifacts: 'artifacts' }[category];
  const root = path.join(TESTING_DIR, dirName);
  const re = new RegExp(`describe\\(['"]${escapeRegExp(module)}['"]`);
  for (const rel of scanTestFiles(root)) {
    const content = fs.readFileSync(path.join(TESTING_DIR, rel), 'utf-8');
    if (re.test(content)) return rel;
  }
  return null;
}

const MODULE_FILE_MAP: Record<string, string> = {
  parseNumbered: 'unit/engines/parseNumbered.test.ts',
  route: 'unit/engines/router.test.ts',
  translatableTextEx: 'unit/dom/text.test.ts',
  shallowTranslatableTextEx: 'unit/dom/text.test.ts',
  restorePreserves: 'unit/dom/text.test.ts',
  hasBlockTextChildren: 'unit/dom/text.test.ts',
  isTranslationUnit: 'unit/dom/classify.test.ts',
  hasNonTextContent: 'unit/dom/classify.test.ts',
  closestUnit: 'unit/dom/classify.test.ts',
  shouldSkipNonVisual: 'unit/dom/classify.test.ts',
  isMainlyNumeric: 'unit/dom/classify.test.ts',
  splitPre: 'unit/dom/pre-split.test.ts',
  unsplitPre: 'unit/dom/pre-split.test.ts',
  normalizeText: 'unit/dom/normalize.test.ts',
  mainDomain: 'unit/dom/compat.test.ts',
  isGenericInlineBadge: 'unit/dom/compat.test.ts',
  shouldPreserveText: 'unit/dom/compat.test.ts',
  render: 'unit/dom/renderer.test.ts',
  unrender: 'unit/dom/renderer.test.ts',
  applyMode: 'unit/dom/renderer.test.ts',
  applyStyle: 'unit/dom/renderer.test.ts',
  'merge / patchSettings': 'unit/storage/settings.test.ts',
  onSettingsChanged: 'unit/storage/settings.test.ts',
  'cacheGet / cacheSet': 'unit/storage/cache.test.ts',
  'LRU 淘汰': 'unit/storage/cache.test.ts',
  '并发安全': 'unit/storage/cache.test.ts',
  Gate: 'unit/queue/concurrency.test.ts',
  fromEvent: 'unit/hotkeys/normalize.test.ts',
  isTypingContext: 'unit/hotkeys/normalize.test.ts',
  validateCustomCss: 'unit/styles/custom.test.ts',
  applyCustomCss: 'unit/styles/custom.test.ts',
  keys: 'unit/storage/keys.test.ts',
  i18n: 'unit/i18n/coverage.test.ts',
  '构建产物校验': 'artifacts/build-output.test.ts',
};

/** 解析「测试文件：」注解为相对 docs/testing 的路径；解析失败返回 null */
function resolveAnnotation(raw: string): string | null {
  const p = raw.replace(/^[`#*\s]+/, '').trim();
  if (!p) return null;
  // 已是相对 docs/testing 的路径（或全路径含 docs/testing）
  if (p.startsWith('docs/testing/') || p.includes('/docs/testing/')) {
    const idx = p.indexOf('docs/testing/');
    return p.slice(idx + 'docs/testing/'.length);
  }
  const direct = path.join(TESTING_DIR, p);
  if (fs.existsSync(direct)) return p.replace(/\\/g, '/');
  // 旧式路径（如 src/__tests__/...）→ 按 basename 在 docs/testing 下查找
  const base = path.basename(p);
  for (const rel of scanTestFiles(TESTING_DIR)) {
    if (path.basename(rel) === base) return rel;
  }
  return null;
}

/** 从模块名推断文件名：映射表 → 目录扫描 → 默认 slug */
function inferFileName(module: string, category: TestCase['category']): string {
  if (MODULE_FILE_MAP[module]) return MODULE_FILE_MAP[module];
  const found = findFileByModule(module, category);
  if (found) return found;
  const slug = module.replace(/\s+/g, '-').toLowerCase().replace(/[/'"]/g, '');
  return `${category}/${slug}.test.ts`;
}

/** E2E 用例按编号的兜底文件（文档 4.4 目录树：核心 01~30、46~48，扩展 31~45） */
function e2eFallbackFile(tcNumber: number): string {
  return tcNumber >= 31 && tcNumber <= 45 ? 'e2e/extended.spec.ts' : 'e2e/core.spec.ts';
}

/**
 * 从 DEEP-TESTING.md 解析测试用例描述。
 *
 * 匹配模式：
 * - describe('ModuleName', ...) 块 → module
 * - test('description') → test case
 * - TC-E2E-NN: description → E2E test case（按编号去重，4.3 详规标题不再重复计数）
 */
function parseTestCases(): TestCase[] {
  const content = fs.readFileSync(DOC_PATH, 'utf-8');
  const cases: TestCase[] = [];
  const seenTc = new Set<number>();

  let currentModule = '';
  let currentFile = '';
  let currentCategory: TestCase['category'] = 'unit';

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 分类标题
    if (line.includes('## 二、单元测试')) currentCategory = 'unit';
    if (line.includes('## 三、集成测试')) currentCategory = 'integration';
    if (line.includes('## 四、E2E')) currentCategory = 'e2e';
    if (line.includes('## 五、构建产物')) currentCategory = 'artifacts';

    // describe 块：重置文件推断（#121：修复 currentFile 跨模块残留）
    const descMatch = line.match(/describe\('([^']+)'/);
    if (descMatch) {
      currentModule = descMatch[1]!;
      currentFile = '';
      const prevLines = lines.slice(Math.max(0, i - 10), i);
      for (const pl of prevLines.reverse()) {
        const fileMatch = pl.match(/(?:测试文件[：:]|文件[：:])\s*(\S+)/);
        if (fileMatch) {
          currentFile = resolveAnnotation(fileMatch[1]!) ?? '';
          if (currentFile) break;
        }
      }
      if (!currentFile) {
        currentFile = inferFileName(currentModule, currentCategory);
      }
      continue;
    }

    // E2E 用例：TC-E2E-NN: 描述（按编号去重）
    const e2eMatch = line.match(/TC-E2E-(\d+):\s*(.+)/);
    if (e2eMatch) {
      const num = Number(e2eMatch[1]);
      if (!seenTc.has(num)) {
        seenTc.add(num);
        cases.push({
          name: e2eMatch[2]!.trim(),
          module: 'E2E',
          category: 'e2e',
          file: '',
          tcNumber: num,
        });
      }
      continue;
    }

    // 普通 test case
    const testMatch = line.match(/test\('([^']+)'/);
    if (testMatch && currentModule) {
      cases.push({
        name: testMatch[1]!,
        module: currentModule,
        category: currentCategory,
        file: currentFile || inferFileName(currentModule, currentCategory),
      });
    }
  }

  return cases;
}

// ---- 归一化与模糊匹配 ----

/** 去掉括号内容（（…）与 (…)）—— 用例名中的 #NN 回归、补充说明等 */
function stripParentheticals(s: string): string {
  return s.replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '');
}

/** 标题归一化：小写、去 @tag、去 TC 编号、去括号内容、去引号与标点、折叠空白 */
function normalizeTitle(s: string): string {
  return stripParentheticals(s)
    .toLowerCase()
    .replace(/@[\w-]+/g, ' ')
    .replace(/tc-e2e-?\d+/g, ' ')
    .replace(/['"“”‘’`]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 二元组 Jaccard 相似度（0~1） */
function jaccard(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

interface FileTests {
  titles: string[];
  normalized: string[];
  tcNumbers: Set<number>;
}

/** 提取文件内所有测试标题（含 test.skip）与 TC 编号 */
function loadFileTests(file: string): FileTests | null {
  const filePath = path.join(TESTING_DIR, file);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const titles: string[] = [];
  const tcNumbers = new Set<number>();
  const re = /test(?:\.\w+)?\(\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    titles.push(m[1]!);
    const tc = m[1]!.match(/TC-E2E-(\d+)/);
    if (tc) tcNumbers.add(Number(tc[1]));
  }
  return { titles, normalized: titles.map(normalizeTitle), tcNumbers };
}

type MatchResult = 'exact' | 'fuzzy' | null;

/** 判断文档用例是否被文件内测试覆盖 */
function matchCase(tc: TestCase, fileTests: FileTests): MatchResult {
  // E2E：按 TC 编号精确匹配
  if (tc.tcNumber !== undefined) {
    return fileTests.tcNumbers.has(tc.tcNumber) ? 'exact' : null;
  }

  const doc = normalizeTitle(tc.name);
  if (!doc) return null;

  // 1) 归一化精确相等
  if (fileTests.normalized.includes(doc)) return 'exact';

  // 2) 包含关系（短边 ≥ 5 字符）
  for (const n of fileTests.normalized) {
    const [shorter, longer] = n.length <= doc.length ? [n, doc] : [doc, n];
    if (shorter.length >= 5 && longer.includes(shorter)) return 'fuzzy';
  }

  // 3) 二元组 Jaccard 相似度
  for (const n of fileTests.normalized) {
    if (jaccard(doc, n) >= SIM_THRESHOLD) return 'fuzzy';
  }

  return null;
}

/** 为缺失用例找最接近的候选标题（用于给「改名 or 改文档」建议） */
function nearestTitles(tc: TestCase, fileTests: FileTests, limit = 2): string[] {
  const doc = normalizeTitle(tc.name);
  return fileTests.titles
    .map((title, i) => ({ title, score: jaccard(doc, fileTests.normalized[i]!) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.title);
}

// ---- 同步检查 ----

interface MissingEntry {
  file: string;
  cases: { name: string; tcNumber?: number; suggestions: string[] }[];
}

interface SyncReport {
  total: number;
  implemented: number;
  titleDiff: number;
  missing: MissingEntry[];
}

/** 检查文档与代码同步状态 */
function verifySync(cases: TestCase[]): SyncReport {
  const report: SyncReport = { total: cases.length, implemented: 0, titleDiff: 0, missing: [] };

  // 按文件分组（E2E 用例先按 TC 编号定位实际 spec 文件）
  const byFile = new Map<string, TestCase[]>();
  const e2eTcFile = new Map<number, string>();
  for (const rel of scanTestFiles(path.join(TESTING_DIR, 'e2e'))) {
    const ft = loadFileTests(rel);
    if (!ft) continue;
    for (const n of ft.tcNumbers) if (!e2eTcFile.has(n)) e2eTcFile.set(n, rel);
  }

  for (const tc of cases) {
    const file = tc.tcNumber !== undefined ? (e2eTcFile.get(tc.tcNumber) ?? e2eFallbackFile(tc.tcNumber)) : tc.file;
    const list = byFile.get(file) || [];
    list.push(tc);
    byFile.set(file, list);
  }

  for (const [file, tcs] of byFile) {
    const fileTests = loadFileTests(file);

    if (!fileTests) {
      report.missing.push({
        file,
        cases: tcs.map((t) => ({ name: t.name, tcNumber: t.tcNumber, suggestions: [] })),
      });
      continue;
    }

    const missCases: MissingEntry['cases'] = [];
    for (const tc of tcs) {
      const result = matchCase(tc, fileTests);
      if (result === 'exact') {
        report.implemented++;
      } else if (result === 'fuzzy') {
        report.titleDiff++;
      } else {
        missCases.push({ name: tc.name, tcNumber: tc.tcNumber, suggestions: nearestTitles(tc, fileTests) });
      }
    }

    if (missCases.length > 0) {
      report.missing.push({ file, cases: missCases });
    }
  }

  return report;
}

// ---- 主入口 ----

function main(): void {
  console.log('🔍 解析 DEEP-TESTING.md 中的测试用例…\n');
  const cases = parseTestCases();

  if (VERIFY) {
    console.log('📋 文档-代码同步验证\n');
    const report = verifySync(cases);
    const missingFiles = report.missing.filter((m) => !fs.existsSync(path.join(TESTING_DIR, m.file)));
    const missingCases = report.missing.filter((m) => fs.existsSync(path.join(TESTING_DIR, m.file)));

    console.log(`  总用例数:  ${report.total}`);
    console.log(`  已实现:    ${report.implemented}`);
    console.log(`  标题差异:  ${report.titleDiff}（模糊匹配命中，措辞与文档不同）`);
    console.log(`  未实现:    ${report.missing.reduce((n, m) => n + m.cases.length, 0)}`);
    console.log(`  缺失文件:  ${missingFiles.length}`);
    console.log(`  用例失配:  ${missingCases.reduce((n, m) => n + m.cases.length, 0)}（文件存在但用例缺失）`);

    if (report.missing.length > 0) {
      console.log('\n📝 缺失详情:');
      for (const m of report.missing) {
        const exists = fs.existsSync(path.join(TESTING_DIR, m.file));
        console.log(`\n  ${exists ? '⚠' : '✗'} ${m.file}${exists ? `（文件存在，缺失 ${m.cases.length} 个用例）` : `（文件不存在，含 ${m.cases.length} 个用例）`}`);
        for (const c of m.cases.slice(0, 8)) {
          console.log(`    - ${c.tcNumber !== undefined ? `TC-E2E-${String(c.tcNumber).padStart(2, '0')}: ` : ''}${c.name}`);
          for (const s of c.suggestions.slice(0, 1)) {
            console.log(`      → 最接近: ${s}（可改名对齐或更新文档措辞）`);
          }
        }
        if (m.cases.length > 8) {
          console.log(`    … 还有 ${m.cases.length - 8} 个`);
        }
        if (!exists) {
          console.log(`      → 建议: 运行 pnpm test:stubs 生成桩文件，或修正文档中该文件的路径`);
        }
      }
    }
    return;
  }

  if (DRY_RUN) {
    console.log('🏃 --dry-run 模式，不写入文件\n');
  }

  const report = verifySync(cases);
  console.log(`  总用例数: ${report.total}`);
  console.log(`  已实现:   ${report.implemented}`);
  console.log(`  标题差异: ${report.titleDiff}`);
  console.log(`  待生成:   ${report.missing.reduce((n, m) => n + m.cases.length, 0)}`);
  console.log();

  // 为缺失文件生成桩
  for (const m of report.missing) {
    const filePath = path.join(TESTING_DIR, m.file);
    if (fs.existsSync(filePath)) {
      console.log(`⏭ 跳过 ${m.file}（文件已存在，请手动补充 ${m.cases.length} 个用例）`);
      continue;
    }

    console.log(`${DRY_RUN ? '📝 将生成' : '✅ 已生成'} ${m.file}（${m.cases.length} 个桩用例）`);
    if (DRY_RUN) continue;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const testContent = generateStubFile(m.file, m.cases.map((c) => c.name));
    fs.writeFileSync(filePath, testContent, 'utf-8');
  }

  console.log(`\n✨ ${DRY_RUN ? '预览' : '生成'}完成。`);
  if (!DRY_RUN) {
    console.log('💡 运行 pnpm test 执行测试（桩用例默认 skip，不会失败）。');
  }
}

/** 生成桩文件内容 */
function generateStubFile(fileName: string, caseNames: string[]): string {
  const parts = fileName.split('/');
  const describeName = parts[parts.length - 1]?.replace('.test.ts', '') ?? 'TODO';
  const importPath = inferImportPath(fileName);

  const cases = caseNames
    .map(
      (name) =>
        `  test.skip('${name.replace(/'/g, "\\'")}', async () => {\n` +
        `    // TODO: 实现此用例\n` +
        `    expect(true).toBe(true);\n` +
        `  });`,
    )
    .join('\n\n');

  return [
    '/**',
    ` * ${fileName} — 自动生成的测试桩`,
    ` * 来源: DEEP-TESTING.md`,
    ` * 生成时间: ${new Date().toISOString()}`,
    ` *`,
    ` * 请将 test.skip 替换为实际测试逻辑。`,
    ' */',
    "import { describe, test, expect } from 'vitest';",
    '',
    ...(importPath ? [`// import { ... } from '${importPath}';`, ''] : []),
    `describe('${describeName}', () => {`,
    cases,
    '});',
  ].join('\n');
}

function inferImportPath(fileName: string): string {
  // 从测试文件路径推断源文件路径
  const srcMap: Record<string, string> = {
    'unit/engines/parseNumbered.test.ts': '../../src/engines/openai',
    'unit/engines/router.test.ts': '../../src/engines/router',
    'unit/dom/text.test.ts': '../../src/dom/text',
    'unit/dom/classify.test.ts': '../../src/dom/classify',
    'unit/dom/pre-split.test.ts': '../../src/dom/pre-split',
    'unit/dom/normalize.test.ts': '../../src/dom/normalize',
    'unit/dom/compat.test.ts': '../../src/dom/compat',
    'unit/dom/renderer.test.ts': '../../src/dom/renderer',
    'unit/storage/settings.test.ts': '../../src/storage/settings',
    'unit/storage/cache.test.ts': '../../src/storage/cache',
    'unit/storage/keys.test.ts': '../../src/storage/keys',
    'unit/queue/concurrency.test.ts': '../../src/queue/concurrency',
    'unit/hotkeys/normalize.test.ts': '../../src/hotkeys/normalize',
    'unit/styles/custom.test.ts': '../../src/styles/custom',
    'unit/i18n/coverage.test.ts': '',
  };
  return srcMap[fileName] ?? '';
}

// ---- 运行 ----

main();
