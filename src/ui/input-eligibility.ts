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
// 禁用、长度上限装不下译文、contenteditable。圆点等调用方只看判定结果，
// 不自己判断元素类型。
//
// 返回原因而非裸 boolean，与 changelog/decide.ts 同一风格。

/** 能参与输入翻译的输入框。 */
export type TextInput = HTMLTextAreaElement | HTMLInputElement;

/** 放行的单行输入框类型。 */
const SINGLE_LINE_TYPES = ['text', 'search'] as const;

export type InputEligibility =
  | { eligible: true; kind: 'textarea' | (typeof SINGLE_LINE_TYPES)[number] }
  | {
      eligible: false;
      /** not-input：不是输入框；input-type：单行输入框但类型不在白名单里 */
      reason: 'not-input' | 'input-type';
    };

export function decideInputEligibility(el: Element | null): InputEligibility {
  if (el instanceof HTMLTextAreaElement) return { eligible: true, kind: 'textarea' };
  if (!(el instanceof HTMLInputElement)) return { eligible: false, reason: 'not-input' };
  // el.type 已经由浏览器归一化：小写，缺省或写错的 type 按 text 处理
  const kind = SINGLE_LINE_TYPES.find((t) => t === el.type);
  if (!kind) return { eligible: false, reason: 'input-type' };
  return { eligible: true, kind };
}
