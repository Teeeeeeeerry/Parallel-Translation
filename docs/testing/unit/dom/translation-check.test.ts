/**
 * dom/translation-check.ts — 译文与原文比对 单元测试（#783）
 *
 * 引擎把文字原样还回来时，这份“译文”插进页面只会让每行重复一遍。
 * 比对是纯函数，原文与译文显式传入，返回能不能用以及不能用的原因。
 */
import { describe, test, expect } from 'vitest';
import { checkTranslation } from '~/src/dom/translation-check';

describe('checkTranslation', () => {
  test('译文与原文一字不差：不能用，原因是与原文相同', () => {
    expect(checkTranslation('我的H5 我的图文 我的文档', '我的H5 我的图文 我的文档')).toEqual({
      ok: false,
      reason: 'same-as-source',
    });
  });

  test('译文确实不同：可以用', () => {
    expect(checkTranslation('Hello world', '你好，世界')).toEqual({ ok: true });
  });

  test('原文与译文只差首尾空白与中间的连续空白：同样视为相同（沿用取文本处的归一化）', () => {
    expect(checkTranslation('  回收站\n', '回收站')).toEqual({
      ok: false,
      reason: 'same-as-source',
    });
    expect(checkTranslation('风格秀   风格排版\n风格设计', '风格秀 风格排版 风格设计')).toEqual({
      ok: false,
      reason: 'same-as-source',
    });
  });

  test('只多出一个字也算不同：照常可以用', () => {
    expect(checkTranslation('回收站', '回收站。')).toEqual({ ok: true });
  });
});
