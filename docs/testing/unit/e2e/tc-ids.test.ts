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
 *
 * 用例文件用 TypeScript 解析（#513）：手写的去注释认不出正则字面量，
 * /it's/ 里的引号会让后面的注释与用例整体错位。
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

const E2E_DIR = path.resolve('docs/testing/e2e');

/** test(...) 与 test.<修饰>(...) 是用例；test.describe 与 test.step 不是 */
function isTestCall(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === 'test';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'test' &&
    callee.name.text !== 'describe' &&
    callee.name.text !== 'step'
  );
}

/**
 * 标题开头的固定文字：字符串、模板字符串第一个插值之前的部分、拼接式
 * 最左边的字符串。编号写在标题开头，带插值或拼接的标题照样统计。
 */
function titlePrefix(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return titlePrefix(node.left);
  }
  if (ts.isParenthesizedExpression(node)) return titlePrefix(node.expression);
  return null;
}

/** 用例文件里生效的用例标题（开头的固定文字） */
function testTitles(file: string, src: string): string[] {
  const titles: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTestCall(node.expression)) {
      const title = node.arguments[0] && titlePrefix(node.arguments[0]);
      if (title) titles.push(title);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
  return titles;
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
    for (const title of testTitles(file, fs.readFileSync(path.join(dir, file), 'utf-8'))) {
      const id = title.match(/TC-E2E-\d+(?:-[A-Za-z]+)?/)?.[0];
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

describe('用例编号扫描按 TypeScript 语法识别用例（#513）', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ids-ts-'));
    fs.writeFileSync(
      path.join(dir, 'c.spec.ts'),
      [
        "test('TC-E2E-10: 含引号的正则', async ({ page }) => {",
        "  expect(await page.title()).toMatch(/it's/);",
        '});',
        "// test('TC-E2E-11: 正则后面注释掉的旧用例', async () => {});",
        "test('TC-E2E-12: 正则后面的生效用例', async () => {});",
        "const sample = \"test('TC-E2E-13: 字符串里的文字不是用例')\";",
        'test.only(`TC-E2E-14: 无插值模板字符串`, async () => {});',
        'test(`TC-E2E-15: ${sample}`, async () => {});',
        "test('TC-E2E-18: ' + sample, async () => {});",
        "test.describe('TC-E2E-16: 分组不是用例', () => {});",
        "/it's/.test('TC-E2E-17: 正则的 test 方法不是用例');",
      ].join('\n'),
    );
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('只统计生效的 test(...) 调用：正则里的引号不影响后面的注释与用例，带插值或拼接的标题照样统计', () => {
    expect(Object.fromEntries(collectIds(dir))).toEqual({
      'TC-E2E-10': ['c.spec.ts'],
      'TC-E2E-12': ['c.spec.ts'],
      'TC-E2E-14': ['c.spec.ts'],
      'TC-E2E-15': ['c.spec.ts'],
      'TC-E2E-18': ['c.spec.ts'],
    });
  });
});
