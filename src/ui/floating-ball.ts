// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// Phase 5 — 右下角悬浮球。
// 点击触发全页翻译，再次点击还原。
// 位置可拖动并持久化到 storage.local。

import { mountIsolated, unmountIsolated } from './mount';
import { tf } from '../i18n';

function ballPosKey(): string {
  return `pt-ball-pos:${location.hostname}`;
}
const BALL_SIZE = 44;
const VIEWPORT_MARGIN = 8;

type BallState = 'idle' | 'loading' | 'done' | 'error';

/**
 * 将坐标钳制在视口内。
 * 先取上限再取下限：视口比球还小时不会算出负值。
 */
function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, vw - w - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, vh - h - VIEWPORT_MARGIN)),
  };
}

interface BallCallbacks {
  /**
   * 翻译/还原的统一入口，由 content script 提供。
   * 悬浮球不自己判断“该翻还是该还原” —— 翻译态是整个 frame 共享的，
   * 由 content script 单点持有，球只负责把状态画出来。
   */
  onToggle: () => void;
}

let currentState: BallState = 'idle';
let errorTimer: number | undefined;

export function createBall(callbacks: BallCallbacks): () => void {
  const shadow = mountIsolated('ball');

  const ball = document.createElement('button');
  ball.className = 'pt-ball';
  ball.setAttribute('aria-label', tf('translate', '翻译此页'));
  shadow.appendChild(ball);
  // 在设置里关掉又打开时，新球要接着上一次的状态画，而不是重置成 idle
  setBallState(currentState);

  // --- 拖动 ---
  let dragging = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  // 球的实际渲染尺寸，从 getBoundingClientRect 获取。
  // 页面缩放时 CSS 像素可能产生子像素差异，用实际值比硬编码 BALL_SIZE 准确。
  let ballW = BALL_SIZE;
  let ballH = BALL_SIZE;

  // 恢复持久化位置（钳制到视口内）
  const posKey = ballPosKey();
  chrome.storage.local
    .get(posKey)
    .then((r) => {
      const pos = r[posKey] as { x: number; y: number } | undefined;
      if (pos) {
        const rect = ball.getBoundingClientRect();
        const clamped = clampToViewport(pos.x, pos.y, rect.width, rect.height);
        // 钳制后与存储值不同时写回，防止下次再读到越界坐标
        if (clamped.x !== pos.x || clamped.y !== pos.y) {
          chrome.storage.local
            .set({ [posKey]: clamped })
            .catch(() => {});
        }
        ball.style.position = 'fixed';
        ball.style.right = 'auto';
        ball.style.bottom = 'auto';
        ball.style.left = `${clamped.x}px`;
        ball.style.top = `${clamped.y}px`;
      }
    })
    .catch(() => {});

  const onMouseDown = (e: MouseEvent) => {
    dragging = true;
    dragged = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = ball.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    ballW = rect.width;
    ballH = rect.height;
    // #180: 指针捕获 —— 窗口外松开时 mouseup 仍派发到球上，
    // 否则 dragging/dragged 卡在 true，期间键盘 Enter 的 click 被吞
    const pointerId = (e as MouseEvent & { pointerId?: number }).pointerId;
    try {
      if ('setPointerCapture' in ball && typeof pointerId === 'number') {
        ball.setPointerCapture(pointerId);
      }
    } catch {
      // 捕获失败（jsdom/极旧引擎）→ 依赖下方 blur/pointercancel 兜底
    }
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragged = true;
      const rawX = origX + dx;
      const rawY = origY + dy;
      const clamped = clampToViewport(rawX, rawY, ballW, ballH);
      ball.style.position = 'fixed';
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
      ball.style.left = `${clamped.x}px`;
      ball.style.top = `${clamped.y}px`;
    }
  };

  const onMouseUp = () => {
    if (dragging && dragged) {
      // 持久化新位置
      const rect = ball.getBoundingClientRect();
      chrome.storage.local
        .set({ [posKey]: { x: rect.left, y: rect.top } })
        .catch(() => {});
    }
    dragging = false;
  };

  ball.addEventListener('mousedown', onMouseDown);
  // 拖动跨越整个视口，mousemove/mouseup 必须挂在 document 上；
  // 相应地卸载时也必须由这里摘除，mount.ts 只管 host 元素的增删。
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // #180: 窗口外松开 / 拖拽中失焦（alt-tab 等）→ 立即复位拖动状态，
  // 防止 dragged 卡 true 吞掉后续点击
  const onDragReset = () => {
    dragging = false;
    dragged = false;
  };
  window.addEventListener('blur', onDragReset);
  ball.addEventListener('pointercancel', onDragReset);

  // --- 点击 ---
  // 翻译还是还原由 content script 决定，球只转发点击。
  ball.addEventListener('click', () => {
    if (dragged) return;
    if (currentState === 'loading') return; // 翻译进行中，忽略重复点击
    callbacks.onToggle();
  });

  // --- 窗口 resize 时重新贴合 ---
  // 窗口缩小后，曾经合法的拖动位置可能落出视口。
  // 仅在球被手动定位（position= fixed）时才需要做这件事；
  // 默认右下角锚点由 host 的 right/bottom 保证，不受 resize 影响。
  const onResize = () => {
    // 拖动过程中不干预 —— onMouseMove 已经在做钳制
    if (dragging) return;
    // 没有手动定位的球靠 host 的 right/bottom 锚定，无需处理
    if (ball.style.position !== 'fixed') return;
    const rect = ball.getBoundingClientRect();
    const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
    if (clamped.x !== rect.left || clamped.y !== rect.top) {
      ball.style.left = `${clamped.x}px`;
      ball.style.top = `${clamped.y}px`;
      chrome.storage.local
        .set({ [posKey]: { x: clamped.x, y: clamped.y } })
        .catch(() => {});
    }
  };
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onDragReset);
    ball.removeEventListener('pointercancel', onDragReset);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    clearTimeout(errorTimer);
    unmountIsolated('ball');
  };
}

const GLYPH: Record<BallState, string> = {
  get idle() { return tf('ballGlyph', '译'); },
  loading: '…',
  done: '✓',
  error: '!',
};

/**
 * 状态切换的唯一入口。content script 在翻译的各个节点上调用，
 * 因此悬浮球、popup、快捷键三个入口看到的永远是同一个状态。
 */
export function setBallState(s: BallState): void {
  currentState = s;
  clearTimeout(errorTimer);

  const ball = document
    .getElementById('pt-host-ball')
    ?.shadowRoot?.querySelector('.pt-ball') as HTMLElement | null;
  if (ball) {
    ball.dataset.state = s;
    ball.textContent = GLYPH[s];
  }

  // error 是瞬时态：停留 3 秒让用户看见，然后回到可再次点击的 idle
  if (s === 'error') {
    errorTimer = self.setTimeout(() => {
      if (currentState === 'error') setBallState('idle');
    }, 3000);
  }
}
