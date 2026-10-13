/**
 * 端到端 spec 的中日韩字面量检查（#814）
 *
 * 经 checkSource 断言：给一段 spec 源码，报出哪几行没有放行。只看报出的
 * 行号，不看脚本内部怎么走语法树。
 */
import { describe, test, expect } from 'vitest';
import { checkSource } from '~/scripts/check-e2e-cjk';

const lines = (src: string) => checkSource('x.spec.ts', src).map((v) => v.line);

describe('写死的中日韩字面量要放行（#814）', () => {
  test('界面文案写死成中文：报出那一行', () => {
    expect(
      lines(`test('t', async () => {
  await expect(toast).toHaveText('已复制到剪贴板');
  await expect(toast).toHaveText(await msg('copied'));
});`),
    ).toEqual([2]);
  });

  test('日文、韩文、全角标点同样报', () => {
    expect(lines(`expect(a).toBe('コピー');\nexpect(b).toBe('복사');\nexpect(c).toBe('【】');`)).toEqual([1, 2, 3]);
  });

  test('正则与模板字面量同样报', () => {
    expect(lines('expect(a).toHaveText(/失败/);\nexpect(b).toHaveText(`共 ${n} 段`);')).toEqual([1, 2]);
  });

  test('行尾写了放行注释与理由：不报', () => {
    expect(lines(`expect(box).toHaveValue('【译】你好'); // cjk-ok: 替身回显的译文`)).toEqual([]);
  });

  test('放行注释没写理由：照样报', () => {
    expect(lines(`expect(a).toBe('你好'); // cjk-ok:`)).toEqual([1]);
    expect(lines(`expect(a).toBe('你好'); // cjk-ok: `)).toEqual([1]);
  });

  test('放行只管自己这一行：上一行的放行不覆盖下一行', () => {
    expect(
      lines(`expect(a).toBe('你好'); // cjk-ok: 用例输入的原文
expect(toast).toHaveText('已复制');`),
    ).toEqual([2]);
  });

  test('放行注释写在字面量里面不算', () => {
    expect(lines(`expect(a).toBe('你好 // cjk-ok: 假的');`)).toEqual([1]);
  });

  test('跨行的模板字面量：报在它结束的那一行，放行也写在那一行', () => {
    const src = 'const html = `<p>\n第一段\n</p>`;';
    expect(lines(src)).toEqual([3]);
    expect(lines(src + ' // cjk-ok: 夹具正文')).toEqual([]);
  });

  test('模板 ${} 里嵌着的字面量单独检查', () => {
    expect(lines("const s = `a ${t('你好')} b`; // cjk-ok: 只放行了外层")).toEqual([]);
    expect(lines("const s = `a ${t('你好')} b`;")).toEqual([1]);
  });

  test('注释里的中文不报', () => {
    expect(lines(`// 这里是中文注释\n/* 块注释：中文 */\nexpect(a).toBe('ok');`)).toEqual([]);
  });

  test('不和界面比较的参数位置不报：测试标题、skip 原因、expect 的失败说明、console 与 Error', () => {
    expect(
      lines(`test.describe('整页翻译', () => {
  test('点按钮翻译', async () => {
    test.skip(isMac, '只在 Linux 上跑');
    await test.step('第一步', async () => {});
    expect(n, '译文数量').toBe(3);
    console.log('调试输出');
    throw new Error('不该到这里');
  });
});`),
    ).toEqual([]);
  });

  test('expect 的第一个参数与 getMessage 的替换参数照样要放行', () => {
    expect(lines(`expect('中文').toBe(x);`)).toEqual([1]);
    expect(lines(`await expect(t).toHaveText(await msg('imported', ['法律']));`)).toEqual([1]);
  });

  test('#813 的形状：同一文件里十一条写死的界面文案全部报出，不因为文件里别处有放行而漏', () => {
    const asserts = Array.from({ length: 11 }, (_, i) => `  await expect(toast).toHaveText('提示 ${i}');`);
    const src = [
      `test('t', async () => {`,
      `  await page.keyboard.type('你好'); // cjk-ok: 用例输入的文字`,
      ...asserts,
      `});`,
    ].join('\n');
    expect(lines(src)).toEqual(Array.from({ length: 11 }, (_, i) => i + 3));
  });
});
