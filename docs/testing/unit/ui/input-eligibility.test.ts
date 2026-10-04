/**
 * 输入翻译：这个输入框能不能参与（#650）
 *
 * 白名单起步：多行文本框、普通文本框、搜索框放行，其余单行输入框一律
 * 不参与 —— 密码框因此由构造排除。判定是纯函数，输入全部显式传入，
 * 返回原因而不是裸布尔；后面的票（密码框静默、只读 / 禁用、长度上限、
 * contenteditable）往这里加分支。
 *
 * #655：contenteditable 的编辑宿主（自己可编辑、父元素不可编辑的那个元素）
 * 放行。非编辑态的普通元素、嵌在可编辑区里的 contenteditable=false 子块、
 * 编辑宿主里面的普通子元素都不参与 —— 焦点在可编辑区时落在宿主上。
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

describe('contenteditable（#655）', () => {
  function el(html: string, id: string): HTMLElement {
    document.body.innerHTML = html;
    return document.getElementById(id)!;
  }

  test('编辑宿主放行：contenteditable 写 true、空值、plaintext-only，大小写不论', () => {
    for (const v of ['true', '', 'plaintext-only', 'TRUE']) {
      expect(decideInputEligibility(el(`<div id="a" contenteditable="${v}">hi</div>`, 'a')), v).toEqual({
        eligible: true,
        kind: 'contenteditable',
      });
    }
  });

  test('非编辑态的普通元素不参与：没写、写 false、写了认不出的值', () => {
    for (const html of [
      '<div id="a" tabindex="0">hi</div>',
      '<div id="a" contenteditable="false">hi</div>',
      '<div id="a" contenteditable="banana">hi</div>',
      '<div contenteditable="false"><p id="a" contenteditable="banana">hi</p></div>',
    ]) {
      expect(decideInputEligibility(el(html, 'a')), html).toEqual({ eligible: false, reason: 'not-input' });
    }
  });

  test('嵌在可编辑区里的 contenteditable=false 子块不参与', () => {
    const chip = el(
      '<div contenteditable="true">hi <span id="a" contenteditable="false" tabindex="0">@alice</span></div>',
      'a',
    );
    expect(decideInputEligibility(chip)).toEqual({ eligible: false, reason: 'not-input' });
    // 子块里的普通元素同样不可编辑
    const inner = el('<div contenteditable><span contenteditable="false"><b id="a">x</b></span></div>', 'a');
    expect(decideInputEligibility(inner)).toEqual({ eligible: false, reason: 'not-input' });
  });

  test('编辑宿主里面的普通子元素不是宿主，不参与；认不出的值跟随父元素', () => {
    for (const html of [
      '<div contenteditable="true"><p id="a">hi</p></div>',
      '<div contenteditable="true"><p id="a" contenteditable="banana">hi</p></div>',
      '<div contenteditable="true"><p id="a" contenteditable="true">hi</p></div>',
    ]) {
      expect(decideInputEligibility(el(html, 'a')), html).toEqual({ eligible: false, reason: 'not-input' });
    }
  });

  test('不可编辑子块里再开的可编辑区是它自己的编辑宿主，放行', () => {
    const caption = el(
      '<div contenteditable="true"><figure contenteditable="false"><figcaption id="a" contenteditable="true">cap</figcaption></figure></div>',
      'a',
    );
    expect(decideInputEligibility(caption)).toEqual({ eligible: true, kind: 'contenteditable' });
  });
});
