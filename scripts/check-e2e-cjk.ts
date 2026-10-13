/**
 * PR 校验：端到端 spec 里不许出现没有放行注释的中日韩字面量（#814）。
 *
 * 端到端在 CI 跑的是英文界面，界面文案的断言必须在页面里用
 * chrome.i18n.getMessage 算期望值。#813 那次 e2e-full 一连红了两周，11 条真
 * 失败全是把界面文案写死成中文；完整端到端只在定时与手动触发时跑，PR 的 CI
 * 看不到，所以这条约定只能靠这里机械地拦。
 *
 * 规则：docs/testing/e2e 下每个 *.spec.ts 里，含中日韩字符的字符串、模板与
 * 正则字面量，都要在字面量结束的那一行、字面量之后写一条放行注释：
 *
 *     expect(text).toBe('【译】Hello [tl=zh-CN]'); // cjk-ok: 替身回显的译文
 *
 * 冒号后面必须写理由（夹具内容、替身回显的译文、种子数据……），空理由不算。
 * 放行只对这一行生效，没有整文件豁免：#813 那十一条就在同一个文件里。
 *
 * 不用放行的只有注释本身，以及几处按语法位置就知道不和界面比较的参数：
 * 测试标题、skip 的原因、expect 的失败说明、console 与 Error 的消息（见
 * isNonComparedArg）。
 *
 * 判断用 TypeScript 自己的语法树，不靠正则猜哪里是字符串：注释里的中文、
 * 模板字面量里跨好几行的夹具 HTML 都不会被认错。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** 中日韩：汉字（含扩展 A 与兼容区）、假名、谚文、全角标点与全角字符。 */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

/** 放行注释：`// cjk-ok: 理由`，理由至少两个字符。 */
const ESCAPE = /\/\/\s*cjk-ok:\s*\S.+$/;

/** 测试框架的调用：第一个参数是标题；skip / fixme / fail / slow 的字符串参数全是原因说明。 */
const TEST_ROOTS = new Set(['test', 'describe', 'it']);
const REASON_METHODS = new Set(['skip', 'fixme', 'fail', 'slow']);

export interface Violation {
  file: string;
  line: number;
  text: string;
}

/** 调用表达式的根标识符与最后一段属性名：test.describe.serial → ['test', 'serial']。 */
function calleeName(call: ts.CallExpression): [string, string] | null {
  let callee: ts.Expression = call.expression;
  const last = ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) ? [callee.text, last] : null;
}

/**
 * 字面量所在的位置本身就不和界面比较，不用放行：
 * - test / describe / it 及其 .step、.describe 等的标题（第一个参数）
 * - test.skip / fixme / fail / slow 的原因
 * - expect(值, 说明) 的说明（第二个参数，只在失败时打印）
 * - console.* 的参数与 new Error(...) 的消息
 * 这几处只进报告与日志。判定看的是语法位置，不看内容，所以不是豁免某类文字。
 */
function isNonComparedArg(node: ts.Node): boolean {
  const call = node.parent;
  if (!call) return false;
  if (ts.isNewExpression(call)) {
    return ts.isIdentifier(call.expression) && call.expression.text === 'Error';
  }
  if (!ts.isCallExpression(call)) return false;
  const name = calleeName(call);
  if (!name) return false;
  const [root, last] = name;
  const index = call.arguments.indexOf(node as ts.Expression);
  if (TEST_ROOTS.has(root)) return index === 0 || REASON_METHODS.has(last);
  if (root === 'expect') return index === 1;
  return root === 'console';
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => s.literal.text).join('');
  }
  return null;
}

/** 一个文件里所有没有放行的中日韩字面量。 */
export function checkSource(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Violation[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null && CJK.test(text) && !isNonComparedArg(node)) {
      const end = node.getEnd();
      const { line } = sf.getLineAndCharacterOfPosition(end);
      const lineEnd = sf.getLineEndOfPosition(end);
      // 放行注释必须在字面量之后：字面量自己的内容里写了 cjk-ok 不算
      if (!ESCAPE.test(source.slice(end, lineEnd))) {
        out.push({ file, line: line + 1, text: source.slice(node.getStart(sf), end).split('\n')[0]!.trim() });
      }
    }
    // 模板里 ${} 中的表达式照样检查；模板自身的几段文字上面已经合在一起看过
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith('.spec.ts'))
    .map((d) => join(d.parentPath, d.name))
    .sort();
}

function main(): void {
  const root = new URL('..', import.meta.url).pathname;
  const files = specFiles(join(root, 'docs/testing/e2e'));
  const violations = files.flatMap((f) => checkSource(relative(root, f), readFileSync(f, 'utf-8')));
  if (violations.length) {
    console.error(`\n[check-e2e-cjk] ${violations.length} 处中日韩字面量没有放行注释\n`);
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error(
      `\n  端到端在 CI 跑的是英文界面。界面文案的期望值请在页面里用\n` +
        `  chrome.i18n.getMessage 算，不要写死。\n` +
        `  若这是夹具内容、替身回显的译文、种子数据等测试数据，在字面量所在行的\n` +
        `  末尾写上 \`// cjk-ok: 理由\`。\n`,
    );
    process.exit(1);
  }
  console.log(`[check-e2e-cjk] 通过 —— ${files.length} 个 spec 文件里的中日韩字面量都有放行注释`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
