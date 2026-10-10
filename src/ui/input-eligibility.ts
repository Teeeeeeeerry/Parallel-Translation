// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 输入翻译：这个输入框能不能参与（#650）—— 纯函数，输入全部显式传入。
//
// 白名单起步：只放行多行文本框、普通文本框、搜索框，其余单行输入框一律
// 不参与。密码框因此由构造排除 —— 新增放行的类型必须显式写进白名单，
// 不会因为漏写一条拒绝规则而被激活。
//
// 后面的票往这里加分支：长度上限装不下译文。圆点等调用方只看判定结果，
// 不自己判断元素类型。
//
// #651：密码框有独立的原因 password，不与 input-type 混在一起 —— 白名单本来
// 就把它排除了，单列出来是让这条隐私红线能被单独指出来、单独钉死。它是
// 静默不响应：不出圆点、不发请求，连提示都不出，提示本身就在告诉旁人这里
// 有个密码框被按了翻译键。只读、禁用的密码框也按密码框算。
//
// #653：只读与禁用的文本框写不进去，入口在那儿就是一个点了没反应的圆点。
// 两个属性同时存在时按禁用算。contenteditable 的编辑宿主没有这两个属性
// （不可编辑就不是编辑宿主），不另立一条。
//
// #655：contenteditable 只放行编辑宿主 —— 自己可编辑、父元素不可编辑的那个
// 元素。焦点在可编辑区时落在宿主上；宿主里的普通子元素不是独立的输入框，
// 嵌在可编辑区里的 contenteditable=false 子块（提及、卡片、附件）不可输入。
// 可编辑状态按 contenteditable 属性往上找，不读 isContentEditable：它取决于
// 布局，jsdom 也没有实现。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格。

/** 能参与输入翻译的输入框：多行与单行文本框，或 contenteditable 的编辑宿主（#655）。 */
export type TextInput = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

/** 输入框里的文字：文本框读 value，编辑宿主读渲染出的文字（#655）。 */
export function inputText(el: TextInput): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  // jsdom 没有 innerText，退回 textContent
  return el.innerText ?? el.textContent ?? '';
}

/** 框的长度上限（#654）：文本框没写 maxlength 时为 -1，记为 null；contenteditable 没有上限。 */
export function inputMaxLength(el: TextInput): number | null {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.maxLength >= 0 ? el.maxLength : null;
  }
  return null;
}

/** 放行的单行输入框类型。 */
const SINGLE_LINE_TYPES = ['text', 'search'] as const;

export type InputEligibility =
  | { eligible: true; kind: 'textarea' | (typeof SINGLE_LINE_TYPES)[number] | 'contenteditable' }
  | {
      eligible: false;
      /**
       * not-input：不是输入框，也不是 contenteditable 的编辑宿主；
       * password：密码框，静默不响应（#651）；
       * input-type：单行输入框但类型不在白名单里（密码框除外）；
       * disabled：禁用的文本框（#653）；
       * read-only：只读的文本框（#653）
       */
      reason: 'not-input' | 'password' | 'input-type' | 'disabled' | 'read-only';
    };

export function decideInputEligibility(el: Element | null): InputEligibility {
  if (el instanceof HTMLTextAreaElement) {
    return unwritable(el) ?? { eligible: true, kind: 'textarea' };
  }
  if (el instanceof HTMLInputElement) {
    // el.type 已经由浏览器归一化：小写，缺省或写错的 type 按 text 处理
    if (el.type === 'password') return { eligible: false, reason: 'password' };
    const kind = SINGLE_LINE_TYPES.find((t) => t === el.type);
    if (!kind) return { eligible: false, reason: 'input-type' };
    return unwritable(el) ?? { eligible: true, kind };
  }
  if (el instanceof HTMLElement && isEditingHost(el)) {
    return { eligible: true, kind: 'contenteditable' };
  }
  return { eligible: false, reason: 'not-input' };
}

/** 文本框写不进去的原因（#653）；写得进去为 null。 */
function unwritable(el: HTMLTextAreaElement | HTMLInputElement): InputEligibility | null {
  if (el.disabled) return { eligible: false, reason: 'disabled' };
  if (el.readOnly) return { eligible: false, reason: 'read-only' };
  return null;
}

/** contenteditable 属性自身给出的状态；没写或认不出的值为 null（跟随父元素）。 */
function ownEditable(el: Element): boolean | null {
  const v = el.getAttribute('contenteditable')?.toLowerCase();
  if (v === undefined) return null;
  if (v === '' || v === 'true' || v === 'plaintext-only') return true;
  if (v === 'false') return false;
  return null;
}

/** 元素是否可编辑：按 contenteditable 属性往上找第一个明确的状态。 */
function isEditable(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    const own = ownEditable(e);
    if (own !== null) return own;
  }
  return false;
}

/** 编辑宿主：自己明确可编辑，父元素不可编辑。 */
function isEditingHost(el: HTMLElement): boolean {
  return ownEditable(el) === true && !isEditable(el.parentElement);
}
