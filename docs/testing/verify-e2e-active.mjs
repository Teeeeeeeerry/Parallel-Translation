/**
 * E2E 激活校验 — 防止测试"永远绿"回归。
 *
 * CI 中运行：检查 Playwright JSON 报告中 skipped 测试数量，
 * 超过阈值则失败。确保 E2E 测试不会因为 test.skip 被静默跳过。
 *
 * 用法：node docs/testing/verify-e2e-active.mjs [--json results.json] [--threshold 50]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOGS_DIR = resolve('docs/testing/logs');
const resultsFile = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : resolve(LOGS_DIR, 'playwright-results.json');

const thresholdArgIdx = process.argv.indexOf('--threshold');
const threshold = thresholdArgIdx >= 0
  ? Number(process.argv[thresholdArgIdx + 1])
  : 30; // 默认允许 ≤ 30 个 skip（@real 测试在 core 套件里自然跳过）

let raw;
try {
  raw = readFileSync(resultsFile, 'utf-8');
} catch {
  console.error(`无法读取测试结果: ${resultsFile}`);
  process.exit(2);
}

const data = JSON.parse(raw);
const suites = data.suites ?? [];

// 递归统计
function countStats(node) {
  let total = 0;
  let skipped = 0;
  let failed = 0;

  if (node.specs) {
    for (const spec of node.specs) {
      for (const test of spec.tests ?? []) {
        total++;
        for (const result of test.results ?? []) {
          if (result.status === 'skipped') skipped++;
          if (result.status === 'failed' || result.status === 'timedOut') failed++;
        }
      }
    }
  }
  if (node.suites) {
    for (const child of node.suites) {
      const s = countStats(child);
      total += s.total;
      skipped += s.skipped;
      failed += s.failed;
    }
  }
  return { total, skipped, failed };
}

const stats = countStats({ suites });

console.log(`E2E 测试统计: ${stats.total} 总, ${stats.skipped} skip, ${stats.failed} fail`);
console.log(`Skip 阈值: ${threshold}`);

if (stats.failed > 0) {
  // 失败的测试已经被 Playwright 报告了，这里不额外退出
  console.log(`${stats.failed} 个测试失败`);
}

if (stats.skipped > threshold) {
  console.error(
    `\n⛔ E2E 跳过过多: ${stats.skipped} > ${threshold}（阈值）\n` +
    `这可能意味着测试被静默跳过而非真正执行。\n` +
    `检查是否有过多的 test.skip() 调用。`,
  );
  process.exit(1);
}

if (stats.total === 0) {
  console.error('\n⛔ E2E 测试数为 0！Playwright 可能没有找到任何测试文件。');
  process.exit(1);
}

console.log('✅ E2E 激活校验通过');
