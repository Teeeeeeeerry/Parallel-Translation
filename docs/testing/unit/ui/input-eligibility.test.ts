/**
 * 输入翻译：这个输入框能不能参与（#650）
 *
 * 白名单起步：多行文本框、普通文本框、搜索框放行，其余单行输入框一律
 * 不参与 —— 密码框因此由构造排除。判定是纯函数，输入全部显式传入，
 * 返回原因而不是裸布尔；后面的票（密码框静默、只读 / 禁用、长度上限、
 * contenteditable）往这里加分支。
 */
import { describe, test, expect } from 'vitest';
import { decideInputEligibility } from '~/src/ui/input-eligibility';

function input(type?: string): HTMLInputElement {
  const el = document.createElement('input');
  if (type !== undefined) el.setAttribute('type', type);
  return el;
}

describe('decideInputEligibility（#650）', () => {
  test('多行文本框放行', () => {
    expect(decideInputEligibility(document.createElement('textarea'))).toEqual({
      eligible: true,
      kind: 'textarea',
    });
  });

  test('普通文本框放行：不写 type、写 text、写错的 type（浏览器按 text 处理）', () => {
    for (const el of [input(), input('text'), input('TEXT'), input('no-such-type')]) {
      expect(decideInputEligibility(el)).toEqual({ eligible: true, kind: 'text' });
    }
  });

  test('搜索框放行', () => {
    expect(decideInputEligibility(input('search'))).toEqual({ eligible: true, kind: 'search' });
  });

  test('其余单行输入框一律不参与，密码框在内', () => {
    for (const type of ['password', 'email', 'tel', 'number', 'url', 'date', 'checkbox', 'hidden', 'submit']) {
      expect(decideInputEligibility(input(type))).toEqual({ eligible: false, reason: 'input-type' });
    }
  });

  test('不是输入框的元素不参与', () => {
    for (const el of [document.createElement('div'), document.createElement('select'), null]) {
      expect(decideInputEligibility(el)).toEqual({ eligible: false, reason: 'not-input' });
    }
  });
});
