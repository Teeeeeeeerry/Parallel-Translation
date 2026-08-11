/**
 * dom/normalize.ts — 空白归一化 单元测试
 */
import { describe, test, expect } from 'vitest';
import { normalizeText } from '~/src/dom/normalize';

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
