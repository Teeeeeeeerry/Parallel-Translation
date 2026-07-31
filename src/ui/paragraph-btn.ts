// Phase 5 — 段落悬停浮出按钮。
// 鼠标进入可翻译段落时，在其右侧浮出一个小按钮。
// 单个按钮实例复用，随鼠标在段落间移动，不为每段各建一个。

import { mountIsolated, unmountIsolated } from './mount';

type TranslateOneFn = (el: Element) => Promise<void>;

export function createParaBtn(translateOne: TranslateOneFn): () => void {
  const shadow = mountIsolated('para-btn');
  const btn = document.createElement('button');
  btn.className = 'pt-para-btn';
  btn.textContent = '译';
  shadow.appendChild(btn);

  let target: Element | null = null;
  let hideTimer: number | undefined;

  const DIRECT = 'p,li,dd,blockquote,h1,h2,h3,h4,h5,h6';

  document.addEventListener(
    'mouseover',
    (e) => {
      const el = (e.target as Element)?.closest?.(DIRECT);
      if (!el || el.closest('[data-pt-ui="1"]')) return;
      if (el.getAttribute('data-pt') === 'done') return;

      clearTimeout(hideTimer);
      target = el;
      position(btn, el);
    },
    true,
  );

  // 延迟隐藏，给用户从段落移动到按钮的时间；否则按钮永远点不到
  document.addEventListener('mouseout', () => {
    hideTimer = self.setTimeout(() => {
      btn.style.display = 'none';
    }, 200);
  });

  // 按钮自身 hover 时取消隐藏
  btn.addEventListener('mouseover', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseout', () => {
    hideTimer = self.setTimeout(() => {
      btn.style.display = 'none';
    }, 200);
  });

  btn.addEventListener('click', () => {
    if (target) translateOne(target);
    btn.style.display = 'none';
  });

  return () => unmountIsolated('para-btn');
}

/** 定位到段落右上角。用 getBoundingClientRect + fixed 定位，不依赖宿主布局 */
function position(btn: HTMLElement, el: Element): void {
  const r = el.getBoundingClientRect();
  btn.style.display = 'block';
  btn.style.top = `${r.top}px`;
  btn.style.left = `${r.right + 4}px`;
}
