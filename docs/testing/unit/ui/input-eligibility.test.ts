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

  test('其余单行输入框一律不参与（密码框另有独立的原因，见 #651）', () => {
    for (const type of ['email', 'tel', 'number', 'url', 'date', 'checkbox', 'hidden', 'submit']) {
      expect(decideInputEligibility(input(type))).toEqual({ eligible: false, reason: 'input-type' });
    }
  });

  test('不是输入框的元素不参与', () => {
    for (const el of [document.createElement('div'), document.createElement('select'), null]) {
      expect(decideInputEligibility(el)).toEqual({ eligible: false, reason: 'not-input' });
    }
  });
});

describe('邮箱、电话、数字、网址类型不参与（#652）', () => {
  // 这几类框里装的不是自然语言。它们不在白名单里，所以由构造排除；每类单独
  // 一条，哪一类被误放行都能直接指出来
  test('邮箱框（email）返回 input-type', () => {
    expect(decideInputEligibility(input('email'))).toEqual({ eligible: false, reason: 'input-type' });
  });

  test('电话框（tel）返回 input-type', () => {
    expect(decideInputEligibility(input('tel'))).toEqual({ eligible: false, reason: 'input-type' });
  });

  test('数字框（number）返回 input-type', () => {
    expect(decideInputEligibility(input('number'))).toEqual({ eligible: false, reason: 'input-type' });
  });

  test('网址框（url）返回 input-type', () => {
    expect(decideInputEligibility(input('url'))).toEqual({ eligible: false, reason: 'input-type' });
  });
});

describe('密码框静默不响应（#651）', () => {
  test('密码框有独立的原因 password，不与 input-type 混在一起', () => {
    expect(decideInputEligibility(input('password'))).toEqual({ eligible: false, reason: 'password' });
  });

  test('type 大小写不论', () => {
    expect(decideInputEligibility(input('PASSWORD'))).toEqual({ eligible: false, reason: 'password' });
  });

  test('只读、禁用的密码框仍按密码框算 —— 隐私红线优先于其他拒绝', () => {
    const ro = input('password');
    ro.readOnly = true;
    const off = input('password');
    off.disabled = true;
    expect(decideInputEligibility(ro)).toEqual({ eligible: false, reason: 'password' });
    expect(decideInputEligibility(off)).toEqual({ eligible: false, reason: 'password' });
  });
});

describe('显示密码切成明文之后仍按密码框算（#826）', () => {
  // 登录页的“显示密码”按钮把 type 从 password 改成 text，autocomplete 不跟着变。
  // 浏览器与密码管理器都按这两个值识别密码框，判定只看元素自身的属性
  function shown(autocomplete: string): HTMLInputElement {
    const el = input('text');
    el.setAttribute('autocomplete', autocomplete);
    return el;
  }

  test('type=text、autocomplete=current-password → password', () => {
    expect(decideInputEligibility(shown('current-password'))).toEqual({ eligible: false, reason: 'password' });
  });

  test('type=text、autocomplete=new-password → password', () => {
    expect(decideInputEligibility(shown('new-password'))).toEqual({ eligible: false, reason: 'password' });
  });

  test('密码框切换 type 前后判定一致：同一个元素从 password 改成 text 仍是 password', () => {
    const el = input('password');
    el.setAttribute('autocomplete', 'current-password');
    expect(decideInputEligibility(el)).toEqual({ eligible: false, reason: 'password' });
    el.setAttribute('type', 'text');
    expect(decideInputEligibility(el)).toEqual({ eligible: false, reason: 'password' });
  });

  test('属性值大小写不论，前面带分组与地址类标记也认（HTML 规范的写法）', () => {
    for (const v of ['Current-Password', 'NEW-PASSWORD', 'section-login current-password', 'shipping new-password']) {
      expect(decideInputEligibility(shown(v)), v).toEqual({ eligible: false, reason: 'password' });
    }
  });

  test('搜索框写了这两个值同样按密码框算', () => {
    const el = input('search');
    el.setAttribute('autocomplete', 'current-password');
    expect(decideInputEligibility(el)).toEqual({ eligible: false, reason: 'password' });
  });

  test('反向：没写这两个值的普通文本框照常放行', () => {
    expect(decideInputEligibility(input('text'))).toEqual({ eligible: true, kind: 'text' });
    for (const v of ['', 'on', 'off', 'username', 'email', 'one-time-code', 'cc-number', 'password']) {
      expect(decideInputEligibility(shown(v)), v).toEqual({ eligible: true, kind: 'text' });
    }
  });

  test('反向：name 或 id 里带 password 字样不算 —— 只认 autocomplete', () => {
    const el = input('text');
    el.name = 'password';
    el.id = 'new-password';
    expect(decideInputEligibility(el)).toEqual({ eligible: true, kind: 'text' });
  });
});

describe('只读与禁用不参与（#653）', () => {
  function field(tag: 'input' | 'textarea', attrs: { readonly?: boolean; disabled?: boolean }) {
    const el = document.createElement(tag);
    if (attrs.readonly) el.setAttribute('readonly', '');
    if (attrs.disabled) el.setAttribute('disabled', '');
    return el;
  }

  test('只读的单行框：普通文本框与搜索框都不参与', () => {
    expect(decideInputEligibility(field('input', { readonly: true }))).toEqual({
      eligible: false,
      reason: 'read-only',
    });
    const search = field('input', { readonly: true });
    search.setAttribute('type', 'search');
    expect(decideInputEligibility(search)).toEqual({ eligible: false, reason: 'read-only' });
  });

  test('只读的多行框不参与', () => {
    expect(decideInputEligibility(field('textarea', { readonly: true }))).toEqual({
      eligible: false,
      reason: 'read-only',
    });
  });

  test('禁用的单行框不参与', () => {
    expect(decideInputEligibility(field('input', { disabled: true }))).toEqual({
      eligible: false,
      reason: 'disabled',
    });
  });

  test('禁用的多行框不参与', () => {
    expect(decideInputEligibility(field('textarea', { disabled: true }))).toEqual({
      eligible: false,
      reason: 'disabled',
    });
  });

  test('只读与禁用同时存在：单行、多行都按禁用拒绝', () => {
    for (const tag of ['input', 'textarea'] as const) {
      expect(decideInputEligibility(field(tag, { readonly: true, disabled: true })), tag).toEqual({
        eligible: false,
        reason: 'disabled',
      });
    }
  });

  test('属性被去掉之后照常放行', () => {
    const ta = field('textarea', { readonly: true, disabled: true });
    ta.removeAttribute('readonly');
    ta.removeAttribute('disabled');
    expect(decideInputEligibility(ta)).toEqual({ eligible: true, kind: 'textarea' });
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
