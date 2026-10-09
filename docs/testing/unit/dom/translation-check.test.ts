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

  describe('归一化口径：首尾空白、空白折叠、大小写（#784）', () => {
    test('只差首尾空白：视为相同', () => {
      expect(checkTranslation('Release notes', ' Release notes ')).toEqual({
        ok: false,
        reason: 'same-as-source',
      });
    });

    test('只差大小写：视为相同（引擎把首字母大写了）', () => {
      expect(checkTranslation('release notes', 'Release notes')).toEqual({
        ok: false,
        reason: 'same-as-source',
      });
      expect(checkTranslation('Read more', 'READ MORE')).toEqual({
        ok: false,
        reason: 'same-as-source',
      });
    });

    test('中间空白折叠后相同：视为相同', () => {
      expect(checkTranslation('Release\n   notes', 'release notes')).toEqual({
        ok: false,
        reason: 'same-as-source',
      });
    });

    test('三种差异叠在一起：仍视为相同', () => {
      expect(checkTranslation('  read\tMORE ', 'Read more')).toEqual({
        ok: false,
        reason: 'same-as-source',
      });
    });

    test('真有实质差异：照常可以用', () => {
      expect(checkTranslation('Read more', '阅读更多')).toEqual({ ok: true });
      expect(checkTranslation('Read more', 'Read less')).toEqual({ ok: true });
      // 大小写之外还差一个标点，也是实质差异
      expect(checkTranslation('read more', 'Read more.')).toEqual({ ok: true });
    });

    test('土耳其语的带点大写 İ：按与语言环境无关的折叠，比不上就照常插入，不会错拦', () => {
      // 'İ'.toLowerCase() 是 i 加一个组合附加点，与普通的 i 不相等
      expect(checkTranslation('İstanbul', 'istanbul')).toEqual({ ok: true });
    });
  });
});
