/**
 * e2e 用例编号唯一性检查（#466）
 *
 * A 线与 B 线并行开发，各自按看到的最大 TC-E2E 编号加 1，曾撞号
 * （TC-E2E-64 同时出现在 core 与 extended）。用例清单与测试报告按编号
 * 去重，撞号的用例会从清单里消失。这里扫描 e2e 目录下所有用例文件，
 * 让撞号在 PR 的 CI 上就失败。子目录里的用例文件一并扫描（#492）。
 *
 * 只统计生效的 test(...) 标题里的编号：注释里引用别的用例（“覆盖见
 * TC-E2E-40”）与注释掉的旧用例都不算。编号带平台后缀的变体（TC-E2E-03-Mac）
 * 是另一条用例。新增 e2e 文件不需要改这里。
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const E2E_DIR = path.resolve('docs/testing/e2e');

/** test('…') / test.skip("…") 等的标题；test.describe 与 test.step 不是用例 */
const TEST_TITLE_RE = /\btest(?:\.(?!describe\b|step\b)\w+)?\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;

/**
 * 去掉行注释与块注释（#492）：注释掉的旧用例不算，免得复用它的编号时误报。
 * 引号与模板字符串里的 // 与 /* 原样保留（标题里常有网址）。
 */
function stripComments(src: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

/**
 * 目录下各层 *.spec.ts 用例标题里的 TC-E2E 编号 → 出现的文件（相对 dir 的路径，
 * 同一文件出现两次就记两次）
 */
function collectIds(dir: string): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  const files = fs
    .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.split(path.sep).join('/'))
    .sort();
  for (const file of files) {
    const content = stripComments(fs.readFileSync(path.join(dir, file), 'utf-8'));
    for (const m of content.matchAll(TEST_TITLE_RE)) {
      const id = m[2]!.match(/TC-E2E-\d+(?:-[A-Za-z]+)?/)?.[0];
      if (id) ids.set(id, [...(ids.get(id) ?? []), file]);
    }
  }
  return ids;
}

describe('e2e 用例编号（#466）', () => {
  test('扫描得到用例编号 —— 检查本身没有空转', () => {
    expect(collectIds(E2E_DIR).size).toBeGreaterThan(50);
  });

  test('每个 TC-E2E 编号只对应一条用例', () => {
    const dups = [...collectIds(E2E_DIR)]
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id}：${files.join('、')}`);
    expect(dups, `重复的用例编号：\n${dups.join('\n')}`).toEqual([]);
  });
});

describe('用例编号扫描覆盖子目录并忽略注释（#492）', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ids-'));
    fs.mkdirSync(path.join(dir, 'sites'));
    fs.writeFileSync(
      path.join(dir, 'a.spec.ts'),
      [
        "test('TC-E2E-01: 第一条', async () => {});",
        "test('TC-E2E-02: 打开 http://example.com/a', async () => {});",
        "// test('TC-E2E-03: 注释掉的旧用例', async () => {});",
        '/*',
        "test('TC-E2E-04: 块注释里的用例', async () => {});",
        '*/',
        "test('TC-E2E-05-Mac: 平台变体', async () => {}); // 行尾注释 test('TC-E2E-06')",
        "test('TC-E2E-05: 本体', async () => {});",
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'sites', 'b.spec.ts'),
      [
        "test('TC-E2E-03: 复用注释掉的编号', async () => {});",
        "test.skip('TC-E2E-01: 撞号', async () => {});",
      ].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'sites', 'helper.ts'), "test('TC-E2E-07: 不是用例文件');");
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('子目录里的用例文件参与统计，文件记为相对 e2e 目录的路径；注释里的 test(...) 不算', () => {
    expect(Object.fromEntries(collectIds(dir))).toEqual({
      'TC-E2E-01': ['a.spec.ts', 'sites/b.spec.ts'],
      'TC-E2E-02': ['a.spec.ts'],
      'TC-E2E-03': ['sites/b.spec.ts'],
      'TC-E2E-05-Mac': ['a.spec.ts'],
      'TC-E2E-05': ['a.spec.ts'],
    });
  });
});
