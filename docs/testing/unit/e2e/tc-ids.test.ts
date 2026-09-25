/**
 * e2e 用例编号唯一性检查（#466）
 *
 * A 线与 B 线并行开发，各自按看到的最大 TC-E2E 编号加 1，曾撞号
 * （TC-E2E-64 同时出现在 core 与 extended）。用例清单与测试报告按编号
 * 去重，撞号的用例会从清单里消失。这里扫描 e2e 目录下所有用例文件，
 * 让撞号在 PR 的 CI 上就失败。
 *
 * 只统计 test(...) 标题里的编号：注释里引用别的用例（“覆盖见 TC-E2E-40”）
 * 不算。编号带平台后缀的变体（TC-E2E-03-Mac）是另一条用例。新增 e2e 文件
 * 不需要改这里。
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const E2E_DIR = path.resolve('docs/testing/e2e');

/** test('…') / test.skip("…") 等的标题；test.describe 与 test.step 不是用例 */
const TEST_TITLE_RE = /\btest(?:\.(?!describe\b|step\b)\w+)?\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;

/** 各文件用例标题里的 TC-E2E 编号 → 出现的文件（同一文件出现两次就记两次） */
function collectIds(): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const file of fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts')).sort()) {
    const content = fs.readFileSync(path.join(E2E_DIR, file), 'utf-8');
    for (const m of content.matchAll(TEST_TITLE_RE)) {
      const id = m[2]!.match(/TC-E2E-\d+(?:-[A-Za-z]+)?/)?.[0];
      if (id) ids.set(id, [...(ids.get(id) ?? []), file]);
    }
  }
  return ids;
}

describe('e2e 用例编号（#466）', () => {
  test('扫描得到用例编号 —— 检查本身没有空转', () => {
    expect(collectIds().size).toBeGreaterThan(50);
  });

  test('每个 TC-E2E 编号只对应一条用例', () => {
    const dups = [...collectIds()]
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id}：${files.join('、')}`);
    expect(dups, `重复的用例编号：\n${dups.join('\n')}`).toEqual([]);
  });
});
