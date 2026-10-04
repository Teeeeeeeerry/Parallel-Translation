/**
 * 输入翻译：译文回来时能不能写回（#646）
 *
 * 送翻时记下原文快照；译文回来时框里内容已经不是那一段，或焦点已经
 * 换到别处，就放弃写回，译文改走提示条 —— 吞掉用户刚打的字是不可逆
 * 的损失。判定是纯函数，输入全部显式传入，返回原因而不是裸布尔。
 */
import { describe, test, expect } from 'vitest';
import { decideWriteBack } from '~/src/ui/input-writeback';

describe('decideWriteBack（#646）', () => {
  test('内容没变、焦点还在框里 → 写回', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界', focused: true })).toEqual({
      write: true,
    });
  });

  test('译文回来前又打了字 → 不写回，原因是内容已变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界，再见', focused: true })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });

  test('删掉了几个字同样算变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好', focused: true })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });

  test('焦点换到了别处 → 不写回，原因是焦点已移走', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好世界', focused: false })).toEqual({
      write: false,
      reason: 'focus-moved',
    });
  });

  test('内容变动优先于焦点：两者都发生时报内容已变动', () => {
    expect(decideWriteBack({ snapshot: '你好世界', current: '你好', focused: false })).toEqual({
      write: false,
      reason: 'text-changed',
    });
  });
});
