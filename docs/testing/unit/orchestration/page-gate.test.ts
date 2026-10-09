/**
 * orchestration/page-gate.ts — 页面级判定 单元测试（#777）
 *
 * 整页翻译开始前先问一句这一页是什么语言，与目标语言相同就不翻。判定是
 * 纯函数，目标语言、检测语言、页面语言声明全部显式传入；断言返回的结论
 * 与原因。
 */
import { describe, test, expect } from 'vitest';
import { decidePageGate } from '~/src/orchestration/page-gate';

describe('decidePageGate — 页面语言与目标语言比对（#788）', () => {
  test('页面语言与目标语言相同：不翻，带原因与判出的页面语言', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
  });

  test('不同：照常翻译', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'en' })).toEqual({
      translate: true,
    });
    expect(decidePageGate({ to: 'en', detectedLang: null, pageLang: 'ja' })).toEqual({
      translate: true,
    });
  });

  test('比对在归一化之后做：声明带地区、大小写不同仍算同一种语言', () => {
    expect(decidePageGate({ to: 'en', detectedLang: null, pageLang: 'EN-us' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'en',
    });
    expect(decidePageGate({ to: 'ja', detectedLang: null, pageLang: 'ja_JP' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'ja',
    });
  });
});

describe('判不出页面语言时放行照翻（#789）', () => {
  // 与输入翻译相反：输入翻译判不出对方语言时不猜（ADR-0005），阅读方向判不出
  // 页面语言时照翻。这组用例钉住这条取舍，不要反向改成“判不出就不翻”
  test('没有检测语言，也没有语言声明：照常翻译', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: null })).toEqual({
      translate: true,
    });
  });

  test('声明为空、畸形或不指具体语言（und、mul、zxx）：照常翻译', () => {
    for (const pageLang of ['', '  ', 'chinese', 'x', 'und', 'mul', 'zxx']) {
      expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang })).toEqual({
        translate: true,
      });
    }
  });

  test('检测语言认不出（畸形或 und）、声明也没有：照常翻译', () => {
    for (const detectedLang of ['123', 'und', '']) {
      expect(decidePageGate({ to: 'en', detectedLang, pageLang: null })).toEqual({
        translate: true,
      });
    }
  });

  test('判得出且与目标语言不同：照常翻译（不命中的那一半）', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'fr' })).toEqual({
      translate: true,
    });
  });
});
