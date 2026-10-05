/**
 * 输入翻译：输入超长时拒绝（#643）
 *
 * 上限与阅读侧单个翻译单元同一个常量口径（MAX_TEXT，3072 字符，去掉首尾
 * 空白后计数）。超了不发请求、提示用户，不分段翻译后拼接 —— 发给别人的
 * 文字不能有接缝。判定是纯函数，返回原因而不是裸布尔。
 */
import { describe, test, expect } from 'vitest';
import { decideInputLength } from '~/src/ui/input-length';
import { MAX_TEXT } from '~/src/dom/classify';

describe('decideInputLength（#643）', () => {
  test('上限与阅读侧单个翻译单元同一个常量：3072 字符', () => {
    expect(MAX_TEXT).toBe(3072);
    expect(decideInputLength('a'.repeat(MAX_TEXT + 1))).toEqual({ ok: false, reason: 'too-long', limit: MAX_TEXT });
  });

  test('刚好等于上限 → 放行', () => {
    expect(decideInputLength('a'.repeat(MAX_TEXT))).toEqual({ ok: true });
  });

  test('上限加一 → 拒绝，原因是超长，带上上限', () => {
    expect(decideInputLength('字'.repeat(MAX_TEXT + 1))).toEqual({ ok: false, reason: 'too-long', limit: MAX_TEXT });
  });

  test('与阅读侧一样去掉首尾空白再数：首尾空白不让刚好等于上限的文字超长', () => {
    expect(decideInputLength(`  \n${'a'.repeat(MAX_TEXT)}\n  `)).toEqual({ ok: true });
  });

  test('短文字放行', () => {
    expect(decideInputLength('你好世界')).toEqual({ ok: true });
  });
});
