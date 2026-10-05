/**
 * 输入翻译：译文回来时能不能写回（#646）
 *
 * 送翻时记下原文快照；译文回来时框里内容已经不是那一段，或焦点已经
 * 换到别处，就放弃写回，译文改走提示条 —— 吞掉用户刚打的字是不可逆
 * 的损失。判定是纯函数，输入全部显式传入，返回原因而不是裸布尔。
 *
 * #654：译文比框的长度上限长时不写回 —— 浏览器原生插入会把超出的部分
 * 静默截掉，用户可能把半句话发出去。必须在写回之前比对，不能靠插入之后
 * 检查；收场与 #646 一样，译文改走提示条。
 */
import { describe, test, expect } from 'vitest';
import { decideWriteBack } from '~/src/ui/input-writeback';

describe('decideWriteBack（#646）', () => {
  test('内容没变、焦点还在框里 → 写回', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界', focused: true, translation: 'Hello world', maxLength: null })).toEqual({
      write: true,
    });
  });

  test('译文回来前又打了字 → 不写回，原因是内容已变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界，再见', focused: true, translation: 'Hello world', maxLength: null })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });

  test('删掉了几个字同样算变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好', focused: true, translation: 'Hello world', maxLength: null })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });

  test('焦点换到了别处 → 不写回，原因是焦点已移走', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界', focused: false, translation: 'Hello world', maxLength: null })).toEqual({
      write: false,
      reason: 'focus-moved',
    });
  });

  test('内容变动优先于焦点：两者都发生时报内容已变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好', focused: false, translation: 'Hello world', maxLength: null })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });
});

describe('长度上限装不下译文（#654）', () => {
  const base = { snapshot: '你好世界', current: '你好世界', focused: true };

  test('译文比长度上限长一个字符 → 不写回，原因是装不下', () => {
    expect(decideWriteBack({ ...base, translation: 'Hello world', maxLength: 10 })).toEqual({
      write: false,
      reason: 'too-long',
    });
  });

  test('译文刚好等于长度上限 → 照常写回', () => {
    expect(decideWriteBack({ ...base, translation: 'Hello world', maxLength: 11 })).toEqual({ write: true });
  });

  test('没有长度上限 → 照常写回', () => {
    expect(decideWriteBack({ ...base, translation: 'x'.repeat(100_000), maxLength: null })).toEqual({ write: true });
  });

  test('长度按浏览器的口径数：UTF-16 码元，增补平面字符算两个', () => {
    // '𠮷' 是增补平面字符，占两个码元
    expect(decideWriteBack({ ...base, translation: '𠮷𠮷', maxLength: 3 })).toEqual({ write: false, reason: 'too-long' });
    expect(decideWriteBack({ ...base, translation: '𠮷𠮷', maxLength: 4 })).toEqual({ write: true });
  });

  test('上限为 0 时任何译文都装不下', () => {
    expect(decideWriteBack({ ...base, translation: 'a', maxLength: 0 })).toEqual({ write: false, reason: 'too-long' });
  });
});
