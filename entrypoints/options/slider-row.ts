// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 设置页的滑块行（#967，父 #964）：标签 + 滑块 + 当前值读数。
//
// 悬浮球大小、逐段翻译按钮大小、按钮显示时长三项共用这一个工厂，
// 不各抄一份。拖动时读数与 onInput（预览）立刻跟着走；写盘防抖 ——
// storage.sync 有写入频率配额，每个 input 事件写一次会被限流，表现是
// 改了设置过一会儿才生效、或者干脆丢。

import { tf } from '~/src/i18n';

/** 停手多久后写盘：与外观分区自定义 CSS 输入框的防抖同一个值 */
export const SLIDER_SAVE_DELAY = 400;

export interface SliderRowSpec {
  /** 滑块的 id，标签经 for 关联它 */
  id: string;
  labelKey: string;
  labelFallback: string;
  min: number;
  max: number;
  step: number;
  /** 读数后面的单位（px、s），与数字之间空一格 */
  unit: string;
  /** 存储值 → 读数里的数字（显示时长按秒显示时在这里换算） */
  format: (v: number) => string;
  /** 读当前存储值 */
  get: () => number;
  /** 写盘（已防抖） */
  set: (v: number) => void;
  /** 拖动过程中每一步都调用，不等写盘（实时预览用） */
  onInput?: (v: number) => void;
}

export interface SliderRow {
  row: HTMLElement;
  /** 按存储值重画；还有没写盘的拖动时跳过，不把滑块拽回旧值 */
  sync: () => void;
}

export function createSliderRow(spec: SliderRowSpec): SliderRow {
  const row = document.createElement('div');
  row.className = 'pt-row pt-slider-row';

  const label = document.createElement('label');
  label.className = 'pt-row-label';
  label.htmlFor = spec.id;
  label.textContent = tf(spec.labelKey, spec.labelFallback);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'pt-slider';
  input.id = spec.id;
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);

  const readout = document.createElement('output');
  readout.className = 'pt-slider-value';
  readout.htmlFor.add(spec.id);

  const control = document.createElement('div');
  control.className = 'pt-slider-control';
  control.append(input, readout);
  row.append(label, control);

  const render = (v: number) => {
    const text = `${spec.format(v)} ${spec.unit}`;
    readout.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    spec.set(Number(input.value));
  };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    render(v);
    spec.onInput?.(v);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SLIDER_SAVE_DELAY);
  });
  // 松手立即写，不让用户等防抖；键盘方向键每按一下也会触发 change
  input.addEventListener('change', flush);

  const sync = () => {
    if (saveTimer !== undefined) return;
    input.value = String(spec.get());
    // 存储里的值可能在滑块范围之外（直接写过存储），读数跟滑块实际停的位置走
    render(Number(input.value));
  };
  sync();

  return { row, sync };
}
