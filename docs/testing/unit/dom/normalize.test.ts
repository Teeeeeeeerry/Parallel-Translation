/**
 * dom/normalize.ts — 空白归一化 单元测试
 */
import { describe, test, expect } from 'vitest';
import { normalizeText, normalizePreText } from '~/src/dom/normalize';

describe('normalizeText', () => {
  test('\\s+ → 单个空格', () => {
    expect(normalizeText('hello   world')).toBe('hello world');
  });

  test('\\n → 空格', () => {
    expect(normalizeText('hello\nworld')).toBe('hello world');
  });

  test('\\t → 空格', () => {
    expect(normalizeText('hello\tworld')).toBe('hello world');
  });

  test('连续空格 → 单个空格', () => {
    expect(normalizeText('a    b  c')).toBe('a b c');
  });

  test('首尾空白 → trim', () => {
    expect(normalizeText('  hello world  ')).toBe('hello world');
  });

  test('空字符串 → ""', () => {
    expect(normalizeText('')).toBe('');
  });

  test('纯空白 → ""', () => {
    expect(normalizeText('   \n\t  ')).toBe('');
  });

  test('正常文本不变', () => {
    expect(normalizeText('Hello World')).toBe('Hello World');
  });

  test('中文间空白 → 保留单空格', () => {
    expect(normalizeText('你好  世界')).toBe('你好 世界');
  });

  test('混合换行和空格', () => {
    expect(normalizeText('line1\n  line2\t\tline3')).toBe('line1 line2 line3');
  });

  test('\\r\\n Windows 换行 → 空格', () => {
    expect(normalizeText('a\r\nb')).toBe('a b');
  });
});

describe('normalizePreText', () => {
  test('保留硬换行，折叠行内空白', () => {
    expect(normalizePreText('* New Kernel Developer  -  Getting started\n* Academic  Researcher - Studying')).toBe(
      '* New Kernel Developer - Getting started\n* Academic Researcher - Studying',
    );
  });

  test('多行列表逐行保留（RST README 形态）', () => {
    const list = [
      '* New Kernel Developer - Getting started with kernel development',
      '* Academic Researcher - Studying kernel internals and architecture',
      '* Security Expert - Hardening and vulnerability analysis',
    ].join('\n');
    expect(normalizePreText(list)).toBe(list);
  });

  test('连续空行折叠保留为 \\n 序列', () => {
    expect(normalizePreText('a\n\n\nb')).toBe('a\n\n\nb');
  });

  test('行首缩进保留、行尾空白去除（#141）', () => {
    expect(normalizePreText('  * item  \n  * item2  ')).toBe('  * item\n  * item2');
  });

  test('嵌套列表缩进保留（#141 决策）', () => {
    const input = [
      '* Install the package:',
      '',
      '  - Use a virtual environment',
      '  - Verify the version',
      '',
      '* Report a bug:',
      '',
      '  - Open an issue',
      '  - Attach logs',
    ].join('\n');
    expect(normalizePreText(input)).toBe(input);
  });

  test('整块首行缩进同样保留、块尾换行去除（#141）', () => {
    expect(normalizePreText('  first line\n  second line\n')).toBe('  first line\n  second line');
  });

  test('纯空白 → ""', () => {
    expect(normalizePreText('   \n \n  ')).toBe('');
  });

  test('\\r\\n Windows 换行 → 统一为 \\n', () => {
    expect(normalizePreText('a\r\nb')).toBe('a\nb');
  });
});
