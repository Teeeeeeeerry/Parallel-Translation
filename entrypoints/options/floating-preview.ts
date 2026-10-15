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
/* 网页上的按钮是 fixed 定位、平时隐藏，由 paragraph-btn.ts 浮出；预览里跟在示例
   文字末尾常驻显示。尺寸相关的声明一条不覆盖，仍由 injected.css 与变量决定 */
.pt-preview-stage .pt-para-btn {
  position: static;
  display: inline-block;
  margin-left: 4px;
  vertical-align: middle;
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
  // #971: 逐段翻译按钮贴在示例文字末尾，与网页上浮在段落文字末尾的位置一致。
  // 元素必须与网页上的一样是 button：button 的浏览器默认样式是 border-box，换成
  // span 就成了 content-box，最小边长再加上内边距与描边，预览比网页上高出 10px。
  // 预览只给人看，不进 Tab 序列
  const paraBtn = document.createElement('button');
  paraBtn.type = 'button';
  paraBtn.tabIndex = -1;
  paraBtn.className = 'pt-para-btn';
  paraBtn.textContent = tf('paraBtnGlyph', '译');
  text.append(paraBtn);
  // 与网页上的球同一种元素（button），浏览器默认样式一致
  const ball = document.createElement('button');
  ball.type = 'button';
  ball.tabIndex = -1;
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
