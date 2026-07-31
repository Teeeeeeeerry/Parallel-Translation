// Phase 5 — 右下角悬浮球。
// 点击触发全页翻译，再次点击还原。
// 位置可拖动并持久化到 storage.local。

import { mountIsolated, unmountIsolated } from './mount';
import { tf } from '../i18n';

const BALL_POS_KEY = 'pt-ball-pos';

type BallState = 'idle' | 'loading' | 'done' | 'error';

interface BallCallbacks {
  /**
   * 翻译/还原的统一入口，由 content script 提供。
   * 悬浮球不自己判断"该翻还是该还原" —— 翻译态是整个 frame 共享的，
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

  // 恢复持久化位置
  chrome.storage.local
    .get(BALL_POS_KEY)
    .then((r) => {
      const pos = r[BALL_POS_KEY] as { x: number; y: number } | undefined;
      if (pos) {
        ball.style.position = 'fixed';
        ball.style.right = 'auto';
        ball.style.bottom = 'auto';
        ball.style.left = `${pos.x}px`;
        ball.style.top = `${pos.y}px`;
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
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragged = true;
      ball.style.position = 'fixed';
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
      ball.style.left = `${origX + dx}px`;
      ball.style.top = `${origY + dy}px`;
    }
  };

  const onMouseUp = () => {
    if (dragging && dragged) {
      // 持久化新位置
      const rect = ball.getBoundingClientRect();
      chrome.storage.local
        .set({ [BALL_POS_KEY]: { x: rect.left, y: rect.top } })
        .catch(() => {});
    }
    dragging = false;
  };

  ball.addEventListener('mousedown', onMouseDown);
  // 拖动跨越整个视口，mousemove/mouseup 必须挂在 document 上；
  // 相应地卸载时也必须由这里摘除，mount.ts 只管 host 元素的增删。
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // --- 点击 ---
  // 翻译还是还原由 content script 决定，球只转发点击。
  ball.addEventListener('click', () => {
    if (dragged) return;
    if (currentState === 'loading') return; // 翻译进行中，忽略重复点击
    callbacks.onToggle();
  });

  return () => {
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
