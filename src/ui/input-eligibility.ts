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
// 后面的票往这里加分支：密码框静默不响应（与其他拒绝区分开）、只读与
// 禁用、长度上限装不下译文。圆点等调用方只看判定结果，不自己判断元素类型。
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
       * input-type：单行输入框但类型不在白名单里
       */
      reason: 'not-input' | 'input-type';
    };

export function decideInputEligibility(el: Element | null): InputEligibility {
  if (el instanceof HTMLTextAreaElement) return { eligible: true, kind: 'textarea' };
  if (el instanceof HTMLInputElement) {
    // el.type 已经由浏览器归一化：小写，缺省或写错的 type 按 text 处理
    const kind = SINGLE_LINE_TYPES.find((t) => t === el.type);
    if (!kind) return { eligible: false, reason: 'input-type' };
    return { eligible: true, kind };
  }
  if (el instanceof HTMLElement && isEditingHost(el)) {
    return { eligible: true, kind: 'contenteditable' };
  }
  return { eligible: false, reason: 'not-input' };
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
