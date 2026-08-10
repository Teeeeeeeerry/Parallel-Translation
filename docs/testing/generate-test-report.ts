#!/usr/bin/env tsx
/**
 * generate-test-report.ts
 *
 * 运行全部测试并生成统一报告日志。
 *
 * 用法：
 *   pnpm test:report                    # 运行全部测试并输出报告
 *   pnpm test:report -- --no-e2e        # 跳过 E2E
 *   pnpm test:report -- --unit-only     # 仅单元测试
 *
 * 输出：
 *   1. 终端实时输出（各测试框架原生格式）
 *   2. docs/testing/logs/test-report.md        — 人类可读汇总
 *   3. docs/testing/logs/test-report.json       — 机器可读汇总
 *   4. docs/testing/logs/vitest-results.json    — vitest 原始结果
 *   5. docs/testing/logs/playwright-results.json — Playwright 原始结果
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---- 配置 ----

const LOGS_DIR = path.resolve('docs/testing/logs');
const REPORT_MD = path.join(LOGS_DIR, 'test-report.md');
const REPORT_JSON = path.join(LOGS_DIR, 'test-report.json');

interface SuiteResult {
  name: string;
  passed: boolean;
  durationMs: number;
  numPassed?: number;
  numFailed?: number;
  numTotal?: number;
  error?: string;
}

interface Report {
  timestamp: string;
  gitBranch: string;
  gitCommit: string;
  overallPassed: boolean;
  totalDurationMs: number;
  suites: SuiteResult[];
}

// ---- 工具函数 ----

function runCommand(
  cmd: string,
  args: string[],
  label: string,
  resultKind?: 'vitest' | 'playwright',
): SuiteResult {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log(`${'='.repeat(60)}\n`);

  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
  });

  const duration = Date.now() - start;
  const passed = result.status === 0;

  // 根据套件类型只读取对应的 JSON 结果文件
  let numPassed: number | undefined;
  let numFailed: number | undefined;
  let numTotal: number | undefined;

  if (resultKind === 'vitest') {
    try {
      const vitestJson = path.join(LOGS_DIR, 'vitest-results.json');
      if (fs.existsSync(vitestJson)) {
        const data = JSON.parse(fs.readFileSync(vitestJson, 'utf-8'));
        numPassed = data.numPassedTests;
        numFailed = data.numFailedTests;
        numTotal = data.numTotalTests;
      }
    } catch {
      // 解析失败不阻塞
    }
  }

  if (resultKind === 'playwright') {
    try {
      const pwJson = path.join(LOGS_DIR, 'playwright-results.json');
      if (fs.existsSync(pwJson)) {
        const data = JSON.parse(fs.readFileSync(pwJson, 'utf-8'));
        const pwStats = countPlaywrightStats(data);
        numPassed = pwStats.passed;
        numFailed = pwStats.failed;
        numTotal = pwStats.total;
      }
    } catch {
      // 解析失败不阻塞
    }
  }

  console.log(`\n${passed ? '✅' : '❌'} ${label} — ${(duration / 1000).toFixed(1)}s\n`);

  return {
    name: label,
    passed,
    durationMs: duration,
    numPassed,
    numFailed,
    numTotal,
    error: passed ? undefined : `Exit code: ${result.status}`,
  };
}

function countPlaywrightStats(data: Record<string, unknown>): {
  passed: number;
  failed: number;
  total: number;
} {
  let passed = 0;
  let failed = 0;
  let total = 0;

  function walk(obj: unknown) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    const record = obj as Record<string, unknown>;
    if ('suites' in record) walk(record.suites);
    if ('specs' in record) {
      for (const spec of record.specs as Array<Record<string, unknown>>) {
        total++;
        if (spec.ok) passed++;
        else failed++;
      }
    }
    if ('tests' in record) {
      for (const test of record.tests as Array<Record<string, unknown>>) {
        total++;
        if (
          test.status === 'passed' ||
          test.status === 'expected' ||
          test.status === 'skipped'
        ) {
          // skipped 不算 pass/fail
          if (test.status === 'skipped') total--;
          else passed++;
        } else {
          failed++;
        }
      }
    }
  }

  walk(data);
  return { passed, failed, total };
}

function getGitInfo(): { branch: string; commit: string } {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return { branch: branch || 'unknown', commit: commit || 'unknown' };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

// ---- 生成报告 ----

function generateMarkdown(report: Report): string {
  const lines: string[] = [
    '# 测试报告',
    '',
    `**时间**: ${report.timestamp}`,
    `**分支**: \`${report.gitBranch}\``,
    `**提交**: \`${report.gitCommit}\``,
    `**总耗时**: ${(report.totalDurationMs / 1000).toFixed(1)}s`,
    `**结论**: ${report.overallPassed ? '✅ 全部通过' : '❌ 存在失败'}`,
    '',
    '---',
    '',
    '## 套件结果',
    '',
    '| 套件 | 结果 | 通过 | 失败 | 总计 | 耗时 |',
    '|------|------|------|------|------|------|',
  ];

  for (const suite of report.suites) {
    const status = suite.passed ? '✅' : '❌';
    const passed = suite.numPassed?.toString() ?? '-';
    const failed = suite.numFailed?.toString() ?? '-';
    const total = suite.numTotal?.toString() ?? '-';
    const dur = `${(suite.durationMs / 1000).toFixed(1)}s`;
    lines.push(
      `| ${suite.name} | ${status} | ${passed} | ${failed} | ${total} | ${dur} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 原始日志文件');
  lines.push('');
  lines.push('- `docs/testing/logs/vitest-results.json` — Vitest 原始结果');
  lines.push('- `docs/testing/logs/vitest-junit.xml` — Vitest JUnit 报告');
  lines.push('- `docs/testing/logs/playwright-results.json` — Playwright 原始结果');
  lines.push('- `docs/testing/logs/playwright-html/` — Playwright HTML 可视化报告');

  if (!report.overallPassed) {
    lines.push('');
    lines.push('## 失败详情');
    lines.push('');
    for (const suite of report.suites.filter((s) => !s.passed)) {
      lines.push(`### ${suite.name}`);
      lines.push('');
      lines.push('```');
      lines.push(suite.error ?? '未知错误');
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---- 主入口 ----

async function main() {
  const args = process.argv.slice(2);
  const skipE2e = args.includes('--no-e2e');
  const unitOnly = args.includes('--unit-only');

  // 确保日志目录存在
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  // 清空旧日志
  for (const f of fs.readdirSync(LOGS_DIR)) {
    const full = path.join(LOGS_DIR, f);
    if (fs.statSync(full).isFile()) fs.unlinkSync(full);
  }

  const overallStart = Date.now();
  const suites: SuiteResult[] = [];

  // ── 1. 类型检查 ──
  suites.push(runCommand('pnpm', ['typecheck'], '类型检查 (typecheck)'));

  // ── 2. 单元 + 集成 + 产物 + i18n ──
  suites.push(
    runCommand(
      'pnpm',
      ['vitest', 'run', '--config', 'docs/testing/vitest.config.ts'],
      '单元测试 + 集成测试 + 产物断言 (vitest)',
      'vitest',
    ),
  );

  if (!unitOnly) {
    // ── 3. 覆盖率 ──
    suites.push(
      runCommand(
        'pnpm',
        ['vitest', 'run', '--config', 'docs/testing/vitest.config.ts', '--coverage'],
        '覆盖率报告 (vitest --coverage)',
        'vitest',
      ),
    );

    if (!skipE2e) {
      // ── 4. E2E 核心套件 ──
      suites.push(
        runCommand(
          'pnpm',
          ['playwright', 'test', '--config', 'docs/testing/playwright.config.ts', '--grep', '@core'],
          'E2E 核心套件 (playwright @core)',
          'playwright',
        ),
      );
    }
  }

  const totalDuration = Date.now() - overallStart;
  const overallPassed = suites.every((s) => s.passed);

  // ── 构建报告 ──
  const gitInfo = getGitInfo();
  const report: Report = {
    timestamp: new Date().toISOString(),
    gitBranch: gitInfo.branch,
    gitCommit: gitInfo.commit,
    overallPassed,
    totalDurationMs: totalDuration,
    suites,
  };

  // 写入报告文件
  const md = generateMarkdown(report);
  fs.writeFileSync(REPORT_MD, md, 'utf-8');
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf-8');

  // ── 终端汇总 ──
  console.log('\n' + '='.repeat(60));
  console.log('📋 测试报告');
  console.log('='.repeat(60));
  console.log(`  时间:   ${report.timestamp}`);
  console.log(`  分支:   ${report.gitBranch} (${report.gitCommit})`);
  console.log(`  总耗时: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  结论:   ${overallPassed ? '✅ 全部通过' : '❌ 存在失败'}`);
  console.log('');
  console.log('  套件明细:');
  for (const suite of suites) {
    const icon = suite.passed ? '✅' : '❌';
    const count =
      suite.numTotal !== undefined
        ? ` [${suite.numPassed ?? '?'}/${suite.numTotal}]`
        : '';
    console.log(
      `    ${icon} ${suite.name}${count} (${(suite.durationMs / 1000).toFixed(1)}s)`,
    );
  }
  console.log('');
  console.log(`  Markdown 报告: ${REPORT_MD}`);
  console.log(`  JSON 报告:     ${REPORT_JSON}`);
  console.log('='.repeat(60));

  // 如果有失败，以非零 exit code 退出
  if (!overallPassed) process.exit(1);
}

main().catch((err) => {
  console.error('报告生成失败:', err);
  process.exit(1);
});
