/**
 * 输入翻译：译成哪种语言（#640）
 *
 * ADR-0005：目标语言取设置里的源语言。源语言不是具体语言码（auto）时
 * 不猜，返回「判不出来」的原因，调用方提示用户去设置里指定源语言。
 * 判定是纯函数，输入全部显式传入，返回原因而不是裸布尔；页面语言声明
 * （#658）与引擎检测语言（#659、#660）以后作为新的一级接在这里。
 *
 * #658：源语言是 auto 时读页面的语言声明（`<html lang>`），取语言码主段；
 * 缺失、为空、畸形时仍判不出来。
 *
 * #660：本页引擎检测语言排在页面语言声明之前 —— 大量中文站点把声明写成
 * en，而引擎是照着真实文字判的。
 */
import { describe, test, expect } from 'vitest';
import { decideInputTarget } from '~/src/ui/input-target-lang';

describe('decideInputTarget（#640）', () => {
  test('源语言是具体语言码 → 译成它，来源是源语言设置', () => {
    expect(decideInputTarget({ from: 'en', pageLang: null, detectedLang: null })).toEqual({ ok: true, lang: 'en', via: 'source-setting' });
    expect(decideInputTarget({ from: 'ja', pageLang: null, detectedLang: null })).toEqual({ ok: true, lang: 'ja', via: 'source-setting' });
    expect(decideInputTarget({ from: 'zh-TW', pageLang: null, detectedLang: null })).toEqual({
      ok: true,
      lang: 'zh-TW',
      via: 'source-setting',
    });
  });

  test('源语言是 auto → 判不出来，不猜', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: null, detectedLang: null })).toEqual({ ok: false, reason: 'undetermined' });
  });

  test('源语言为空同样判不出来', () => {
    expect(decideInputTarget({ from: '', pageLang: null, detectedLang: null })).toEqual({ ok: false, reason: 'undetermined' });
  });
});

describe('页面语言声明（#658）', () => {
  test('源语言是 auto、页面声明了语言 → 译成声明的语言码主段', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: 'ja', detectedLang: null })).toEqual({
      ok: true,
      lang: 'ja',
      via: 'page-lang',
    });
    for (const pageLang of ['en-US', 'EN', 'en_GB', '  en-us  ', 'zh-Hant-TW']) {
      const d = decideInputTarget({ from: 'auto', pageLang, detectedLang: null });
      expect(d).toEqual({ ok: true, lang: pageLang.trim().slice(0, 2).toLowerCase(), via: 'page-lang' });
    }
  });

  test('三个字母的主段同样认得', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: 'fil-PH', detectedLang: null })).toEqual({
      ok: true,
      lang: 'fil',
      via: 'page-lang',
    });
  });

  test('源语言是具体语言码时不看页面声明', () => {
    expect(decideInputTarget({ from: 'de', pageLang: 'en', detectedLang: null })).toEqual({
      ok: true,
      lang: 'de',
      via: 'source-setting',
    });
  });

  test('声明缺失或为空 → 判不出来', () => {
    for (const pageLang of [null, '', '   ']) {
      expect(decideInputTarget({ from: 'auto', pageLang, detectedLang: null })).toEqual({
        ok: false,
        reason: 'undetermined',
      });
    }
  });

  test('声明畸形或不指具体语言 → 判不出来，不猜', () => {
    for (const pageLang of ['english', 'e', '12', 'en US', '-en', 'x-klingon', 'und', 'mul', 'zxx']) {
      expect(decideInputTarget({ from: 'auto', pageLang, detectedLang: null })).toEqual({
        ok: false,
        reason: 'undetermined',
      });
    }
  });
});

describe('判定链的优先级（#660）', () => {
  test('检测语言与页面声明都有 → 用检测语言', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: 'en', detectedLang: 'zh' })).toEqual({
      ok: true,
      lang: 'zh',
      via: 'detected-lang',
    });
  });

  test('只有页面声明 → 用声明', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: 'en-US', detectedLang: null })).toEqual({
      ok: true,
      lang: 'en',
      via: 'page-lang',
    });
  });

  test('只有检测语言 → 用检测语言', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: null, detectedLang: 'ja' })).toEqual({
      ok: true,
      lang: 'ja',
      via: 'detected-lang',
    });
  });

  test('都没有 → 判不出来，提示去指定源语言', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: null, detectedLang: null })).toEqual({
      ok: false,
      reason: 'undetermined',
    });
    expect(decideInputTarget({ from: 'auto', pageLang: 'english', detectedLang: null })).toEqual({
      ok: false,
      reason: 'undetermined',
    });
  });

  test('检测语言认不出时退到页面声明', () => {
    expect(decideInputTarget({ from: 'auto', pageLang: 'fr', detectedLang: '??' })).toEqual({
      ok: true,
      lang: 'fr',
      via: 'page-lang',
    });
  });

  test('源语言是具体语言码时两者都不看', () => {
    expect(decideInputTarget({ from: 'ko', pageLang: 'en', detectedLang: 'zh' })).toEqual({
      ok: true,
      lang: 'ko',
      via: 'source-setting',
    });
  });
});
