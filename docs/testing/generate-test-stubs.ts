#!/usr/bin/env tsx
/**
 * generate-test-stubs.ts
 *
 * 从 DEEP-TESTING.md 自动生成测试桩文件。
 *
 * 用法：
 *   pnpm tsx docs/testing/generate-test-stubs.ts           # 生成全部桩
 *   pnpm tsx docs/testing/generate-test-stubs.ts --dry-run # 预览不写入
 *   pnpm tsx docs/testing/generate-test-stubs.ts --verify  # 检查文档与代码同步状态
 *
 * 工作原理：
 *   1. 解析 DEEP-TESTING.md 中描述的测试用例
 *   2. 匹配到已存在的测试文件，报告覆盖率
 *   3. 为缺失的测试用例生成桩代码（test.skip + 描述）
 *
 * 生成规则：
 *   - 如果对应的 .test.ts 文件已存在 → 跳过，报告"已实现"
 *   - 如果对应文件不存在 → 生成桩文件（所有用例标记为 test.skip）
 *   - 如果文件存在但缺少用例 → 追加缺失的 test.skip 用例
 */

import fs from 'fs';
import path from 'path';

// ---- 配置 ----

const TESTING_DIR = path.resolve('docs/testing');
const DOC_PATH = path.resolve('docs/DEEP-TESTING.md');
const UNIT_DIR = path.join(TESTING_DIR, 'unit');
const INTEGRATION_DIR = path.join(TESTING_DIR, 'integration');
const E2E_DIR = path.join(TESTING_DIR, 'e2e');
const ARTIFACTS_DIR = path.join(TESTING_DIR, 'artifacts');

const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

// ---- 用例提取 ----

interface TestCase {
  name: string;
  module: string;
  category: 'unit' | 'integration' | 'e2e' | 'artifacts';
  file: string;
}

/**
 * 从 DEEP-TESTING.md 解析测试用例描述。
 *
 * 匹配模式：
 * - describe('ModuleName', ...) 块 → module
 * - test('description') → test case
 * - TC-E2E-NN: description → E2E test case
 */
function parseTestCases(): TestCase[] {
  const content = fs.readFileSync(DOC_PATH, 'utf-8');
  const cases: TestCase[] = [];

  let currentModule = '';
  let currentFile = '';
  let currentCategory: TestCase['category'] = 'unit';

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 检测 describe block
    const descMatch = line.match(/describe\('([^']+)'/);
    if (descMatch) {
      currentModule = descMatch[1]!;
      // 从前面的注释或路径推断文件
      const prevLines = lines.slice(Math.max(0, i - 10), i);
      for (const pl of prevLines.reverse()) {
        const fileMatch = pl.match(/(?:测试文件[：:]|文件[：:])\s*(\S+)/);
        if (fileMatch) {
          currentFile = fileMatch[1]!;
          break;
        }
      }
      // 从模块名推断文件
      if (!currentFile) {
        currentFile = inferFileName(currentModule, currentCategory);
      }
      continue;
    }

    // 检测分类标题
    if (line.includes('## 二、单元测试')) currentCategory = 'unit';
    if (line.includes('## 三、集成测试')) currentCategory = 'integration';
    if (line.includes('## 四、E2E')) currentCategory = 'e2e';
    if (line.includes('## 五、构建产物')) currentCategory = 'artifacts';

    // 检测 test case
    const testMatch = line.match(/test\('([^']+)'/);
    if (testMatch && currentModule) {
      cases.push({
        name: testMatch[1]!,
        module: currentModule,
        category: currentCategory,
        file: currentFile || inferFileName(currentModule, currentCategory),
      });
    }

    // 检测 E2E TC 编号
    const e2eMatch = line.match(/TC-E2E-\d+:\s*(.+)/);
    if (e2eMatch) {
      cases.push({
        name: e2eMatch[1]!.trim(),
        module: 'E2E',
        category: 'e2e',
        file: 'core.spec.ts',
      });
    }
  }

  return cases;
}

/** 从模块名推断文件名 */
function inferFileName(
  module: string,
  category: TestCase['category'],
): string {
  const map: Record<string, string> = {
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

  if (map[module]) return map[module];

  // 默认推断
  const slug = module.replace(/\s+/g, '-').toLowerCase().replace(/[/']/g, '');
  return `${category}/${slug}.test.ts`;
}

// ---- 同步检查 ----

interface SyncReport {
  total: number;
  implemented: number;
  stubbed: number;
  missing: { file: string; cases: string[] }[];
  stale: { file: string; cases: string[] }[];
}

/** 检查文档与代码同步状态 */
function verifySync(cases: TestCase[]): SyncReport {
  const report: SyncReport = {
    total: cases.length,
    implemented: 0,
    stubbed: 0,
    missing: [],
    stale: [],
  };

  // 按文件分组
  const byFile = new Map<string, TestCase[]>();
  for (const tc of cases) {
    const list = byFile.get(tc.file) || [];
    list.push(tc);
    byFile.set(tc.file, list);
  }

  for (const [file, tcs] of byFile) {
    const filePath = path.join(TESTING_DIR, file);
    if (!fs.existsSync(filePath)) {
      report.missing.push({
        file,
        cases: tcs.map((t) => t.name),
      });
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let missingCases: string[] = [];

    for (const tc of tcs) {
      // 简单检查：文件是否包含用例描述
      if (content.includes(tc.name)) {
        report.implemented++;
      } else {
        missingCases.push(tc.name);
        report.stubbed++;
      }
    }

    if (missingCases.length > 0) {
      report.missing.push({ file, cases: missingCases });
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
    console.log(`  总用例数:  ${report.total}`);
    console.log(`  已实现:    ${report.implemented}`);
    console.log(`  未实现:    ${report.stubbed}`);
    console.log(`  缺失文件:  ${report.missing.filter((m) => !fs.existsSync(path.join(TESTING_DIR, m.file))).length}`);
    console.log(`  缺失用例:  ${report.missing.filter((m) => fs.existsSync(path.join(TESTING_DIR, m.file))).length}`);

    if (report.missing.length > 0) {
      console.log('\n📝 缺失详情:');
      for (const m of report.missing) {
        const exists = fs.existsSync(path.join(TESTING_DIR, m.file));
        console.log(`\n  ${exists ? '⚠' : '✗'} ${m.file}${exists ? ' (文件存在，缺失用例)' : ' (文件不存在)'}`);
        for (const c of m.cases.slice(0, 5)) {
          console.log(`    - ${c}`);
        }
        if (m.cases.length > 5) {
          console.log(`    … 还有 ${m.cases.length - 5} 个`);
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
  console.log(`  待生成:   ${report.stubbed}`);
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

    // 生成桩文件
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const testContent = generateStubFile(m.file, m.cases);
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
