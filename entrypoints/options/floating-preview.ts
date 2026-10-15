// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 设置页悬浮 UI 的实时预览（#968，父 #964）。
//
// 预览里的球用的是注入网页的同一份样式（injected.css，放进预览自己的
// shadow root，与 mountIsolated 同样隔开设置页的样式），尺寸读与内容脚本
// 同一个纯函数 floatingUiVars 的输出，写在预览容器上 —— 与内容脚本把变量
// 写在文档根上是同一套继承链。不另写尺寸换算：两份换算一旦分叉，预览就会骗人。
//
// 形态沿用外观分区的样式预览：设置挂在预览容器上，onSettingsChanged 里重算。

import injected from '@/src/styles/injected.css?inline';
import type { Settings } from '~/src/storage/schema';
import { floatingUiVars } from '~/src/ui/floating-ui-size';
import { tf } from '~/src/i18n';

/** 只给预览用的排版：网页上球靠 host 定位在右下角，预览里放在一行示例文字的右侧 */
const PREVIEW_CSS = `
.pt-preview-stage {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 88px;
  font-family: var(--pt-font-ui);
  font-size: 13px;
  color: var(--pt-forest);
}
.pt-preview-stage .pt-ball {
  flex: none;
  cursor: default;
}
`;

export interface FloatingPreview {
  update: (s: Pick<Settings, 'floatingBallSize' | 'paraBtnSize'>) => void;
}

export function createFloatingPreview(host: HTMLElement): FloatingPreview {
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = injected + PREVIEW_CSS;

  const stage = document.createElement('div');
  stage.className = 'pt-preview-stage';
  const text = document.createElement('span');
  text.textContent = tf('previewOrigin', 'The quick brown fox jumps over the lazy dog.');
  const ball = document.createElement('div');
  ball.className = 'pt-ball';
  ball.dataset.state = 'idle';
  ball.textContent = tf('ballGlyph', '译');
  stage.append(text, ball);
  shadow.append(style, stage);

  return {
    update(s) {
      for (const [name, value] of Object.entries(floatingUiVars(s))) {
        host.style.setProperty(name, value);
      }
    },
  };
}
