/**
 * engines/openai.ts — parseNumbered 单元测试
 *
 * 风险：输出长度 ≠ 输入长度 → 译文批量错位，比漏翻严重 100 倍
 */
import { describe, test, expect } from 'vitest';
import { parseNumbered } from '~/src/engines/openai';

describe('parseNumbered', () => {
  // ── 基础：三种编号格式 ──

  test('1. 格式能解析', () => {
    const input = '1. Hello\n2. World';
    expect(parseNumbered(input, 2)).toEqual(['Hello', 'World']);
  });

  test('1、 格式能解析', () => {
    const input = '1、你好\n2、世界';
    expect(parseNumbered(input, 2)).toEqual(['你好', '世界']);
  });

  test('1) 格式能解析', () => {
    const input = '1) Hello\n2) World';
    expect(parseNumbered(input, 2)).toEqual(['Hello', 'World']);
  });

  test('混合编号格式仍正确提取', () => {
    const input = '1. Hello\n2、World\n3) Test';
    expect(parseNumbered(input, 3)).toEqual(['Hello', 'World', 'Test']);
  });

  test('编号后有空格的容错："1.  Hello" → "Hello"', () => {
    const input = '1.  Hello\n2.  World';
    expect(parseNumbered(input, 2)).toEqual(['Hello', 'World']);
  });

  test('编号前有空格容错："  1. Hello" → "Hello"', () => {
    const input = '  1. Hello\n  2. World';
    expect(parseNumbered(input, 2)).toEqual(['Hello', 'World']);
  });

  // ── 长度不变性（最关键的一组） ──

  test('输出长度恒等于 expected 参数', () => {
    const input = '1. A\n2. B\n3. C';
    for (const expected of [1, 2, 3, 5, 10]) {
      expect(parseNumbered(input, expected).length).toBe(expected);
    }
  });

  test('expected=0 返回空数组', () => {
    expect(parseNumbered('1. Hello', 0)).toEqual([]);
  });

  test('expected=100 返回长度 100', () => {
    const result = parseNumbered('1. Only', 100);
    expect(result.length).toBe(100);
    expect(result[0]).toBe('Only');
    // 其余 99 个应为空串
    for (let i = 1; i < 100; i++) {
      expect(result[i]).toBe('');
    }
  });

  // ── 漏行与多行 ──

  test('缺行：输入 1/3/5，expected=5 → 缺的行填空串，不错位', () => {
    const input = '1. First\n3. Third\n5. Fifth';
    const result = parseNumbered(input, 5);
    expect(result).toEqual(['First', '', 'Third', '', 'Fifth']);
  });

  test('多行：输入 1-6，expected=3 → 只取前 3，多余的被忽略', () => {
    const input = '1. A\n2. B\n3. C\n4. D\n5. E\n6. F';
    expect(parseNumbered(input, 3)).toEqual(['A', 'B', 'C']);
  });

  test('编号乱序：输入 3/1/2 → 输出按 expected 索引对齐', () => {
    const input = '3. Third\n1. First\n2. Second';
    expect(parseNumbered(input, 3)).toEqual(['First', 'Second', 'Third']);
  });

  // ── 边界 ──

  test('空字符串输入 → expected 长度的空串数组', () => {
    expect(parseNumbered('', 3)).toEqual(['', '', '']);
  });

  test('正文包含 "1." 样式的编号列表 → 只有行首编号被当成分隔符', () => {
    const input = '1. Step 1.2 is important\n2. Step 2.0 follows';
    const result = parseNumbered(input, 2);
    // 行首编号是真正的分隔符，行内 "1.2" / "2.0" 不会被误判
    expect(result).toEqual(['Step 1.2 is important', 'Step 2.0 follows']);
  });

  test('编号超过 expected 的行被忽略', () => {
    const input = '1. A\n2. B\n5. E\n10. J';
    // expected=2，只有 1 和 2 会被取用
    expect(parseNumbered(input, 2)).toEqual(['A', 'B']);
  });

  test('编号为 0 或负数的行视为正文', () => {
    // LLM 一般不会输出编号 0，但正则不匹配 0 和负数
    const input = '0. Zero\n-1. Negative\n1. Valid';
    expect(parseNumbered(input, 1)).toEqual(['Valid']);
  });

  test('单行不含编号 → 返回空串数组', () => {
    expect(parseNumbered('No numbering here', 1)).toEqual(['']);
    expect(parseNumbered('Plain text', 3)).toEqual(['', '', '']);
  });

  test('编号与正文间无空格也能解析', () => {
    // 正则中的 \s* 允许零个空白，所以 "1.Hello" 也能匹配
    const input = '1.Hello\n2.World';
    const result = parseNumbered(input, 2);
    expect(result).toEqual(['Hello', 'World']);
  });

  test('最大编号远大于 expected 时仍正确', () => {
    const input = '1. A\n999. Far';
    // expected=1，只取 #1
    expect(parseNumbered(input, 1)).toEqual(['A']);
  });

  test('重复编号 → 后面的覆盖前面的', () => {
    const input = '1. First\n1. Override';
    expect(parseNumbered(input, 1)).toEqual(['Override']);
  });
});
