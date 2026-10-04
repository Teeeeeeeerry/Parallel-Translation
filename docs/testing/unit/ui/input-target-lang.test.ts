/**
 * 输入翻译：译成哪种语言（#640）
 *
 * ADR-0005：目标语言取设置里的源语言。源语言不是具体语言码（auto）时
 * 不猜，返回「判不出来」的原因，调用方提示用户去设置里指定源语言。
 * 判定是纯函数，输入全部显式传入，返回原因而不是裸布尔；页面语言声明
 * （#658）与引擎检测语言（#659、#660）以后作为新的一级接在这里。
 */
import { describe, test, expect } from 'vitest';
import { decideInputTarget } from '~/src/ui/input-target-lang';

describe('decideInputTarget（#640）', () => {
  test('源语言是具体语言码 → 译成它，来源是源语言设置', () => {
    expect(decideInputTarget({ from: 'en' })).toEqual({ ok: true, lang: 'en', via: 'source-setting' });
    expect(decideInputTarget({ from: 'ja' })).toEqual({ ok: true, lang: 'ja', via: 'source-setting' });
    expect(decideInputTarget({ from: 'zh-TW' })).toEqual({
      ok: true,
      lang: 'zh-TW',
      via: 'source-setting',
    });
  });

  test('源语言是 auto → 判不出来，不猜', () => {
    expect(decideInputTarget({ from: 'auto' })).toEqual({ ok: false, reason: 'undetermined' });
  });

  test('源语言为空同样判不出来', () => {
    expect(decideInputTarget({ from: '' })).toEqual({ ok: false, reason: 'undetermined' });
  });
});
