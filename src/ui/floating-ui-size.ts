// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 悬浮 UI 尺寸（#964）：把设置映射成 CSS 自定义属性。
//
// 纯函数，不碰 DOM、不读存储。内容脚本把结果写到文档根上（applySettings），
// 设置页的预览读同一份输出 —— 尺寸换算只有这一处，预览不会和网页上的真实
// UI 分叉。变量名与 injected.css 里的 var() 一一对应，回落值也在那里。

import type { Settings } from '../storage/schema';
import { clampBallSize, clampParaBtnSize } from '../storage/schema';

export type FloatingUiVars = Record<`--pt-${string}`, string>;

/**
 * 逐段翻译按钮的字号与最小边长之比：原来是 12px 字号配 24px 下限。
 * 一个值同时驱动两者，按钮调大时字跟着长，不出现大框小字
 */
const PARA_BTN_FONT_RATIO = 12 / 24;

/**
 * 悬浮球的字号与球径之比（#986）：原来是 11px 字号配 44px 球。
 * 球调大时字形等比跟着长，72px 的球里不再飘着一个 11px 的字
 */
const BALL_FONT_RATIO = 11 / 44;

export function floatingUiVars(
  s: Pick<Settings, 'floatingBallSize' | 'paraBtnSize'>,
): FloatingUiVars {
  // 存储读出来的值不经写入口（直接写 storage 的旧数据），再钳一次：
  // 脏值写成 'NaNpx' 会让 var() 在计算值时刻失效，球的宽高变成 auto 塌掉
  const ball = clampBallSize(s.floatingBallSize);
  const btn = clampParaBtnSize(s.paraBtnSize);
  return {
    '--pt-ball-size': `${ball}px`,
    '--pt-ball-font': `${ball * BALL_FONT_RATIO}px`,
    '--pt-para-btn-size': `${btn}px`,
    '--pt-para-btn-font': `${btn * PARA_BTN_FONT_RATIO}px`,
  };
}
