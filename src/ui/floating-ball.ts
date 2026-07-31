// Phase 5 — 右下角悬浮球。
// 点击触发全页翻译，再次点击还原。
// 位置可拖动并持久化到 storage.local。

import { mountIsolated, unmountIsolated } from './mount';

const BALL_POS_KEY = 'pt-ball-pos';

type BallState = 'idle' | 'loading' | 'done' | 'error';

interface BallCallbacks {
  onTranslate: () => Promise<string>;
  onRestore: () => void;
}

let currentState: BallState = 'idle';

export function createBall(callbacks: BallCallbacks): () => void {
  const shadow = mountIsolated('ball');

  const ball = document.createElement('button');
  ball.className = 'pt-ball';
  ball.setAttribute('aria-label', '翻译此页');
  ball.textContent = '译';
  shadow.appendChild(ball);

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

  ball.addEventListener('mousedown', (e) => {
    dragging = true;
    dragged = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = ball.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
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
  });

  document.addEventListener('mouseup', () => {
    if (dragging && dragged) {
      // 持久化新位置
      const rect = ball.getBoundingClientRect();
      chrome.storage.local
        .set({ [BALL_POS_KEY]: { x: rect.left, y: rect.top } })
        .catch(() => {});
    }
    dragging = false;
  });

  // --- 点击 ---
  ball.addEventListener('click', async () => {
    if (dragged) return;

    if (currentState === 'idle' || currentState === 'done') {
      const willTranslate = currentState !== 'done';
      setState(willTranslate ? 'loading' : 'idle');
      try {
        const status = willTranslate
          ? await callbacks.onTranslate()
          : (callbacks.onRestore(), 'restored');
        setState(status === 'translated' ? 'done' : 'idle');
      } catch {
        setState('error');
        setTimeout(() => {
          if (currentState === 'error') setState('idle');
        }, 3000);
      }
    }
  });

  function setState(s: BallState) {
    currentState = s;
    ball.dataset.state = s;
    ball.textContent =
      s === 'loading' ? '…' : s === 'done' ? '✓' : s === 'error' ? '!' : '译';
  }

  // 监听设置中的开关
  return () => {
    unmountIsolated('ball');
    // mousemove/mouseup listener 清理由 mount 统一处理
  };
}

/** 暴露状态切换给外部，content script 内翻译完成后调用 */
export function setBallState(s: BallState) {
  currentState = s;
  const ball = document
    .getElementById('pt-host-ball')
    ?.shadowRoot?.querySelector('.pt-ball') as HTMLElement | null;
  if (ball) {
    ball.dataset.state = s;
    ball.textContent =
      s === 'loading'
        ? '…'
        : s === 'done'
          ? '✓'
          : s === 'error'
            ? '!'
            : '译';
  }
}
