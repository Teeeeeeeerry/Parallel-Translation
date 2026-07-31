// Phase 5 — 段落悬停浮出按钮。
// 鼠标进入可翻译段落时，在其右侧浮出一个小按钮。
// 单个按钮实例复用，随鼠标在段落间移动，不为每段各建一个。

import { mountIsolated, unmountIsolated } from './mount';

type TranslateOneFn = (el: Element) => Promise<void>;

/**
 * 离开段落后的隐藏延迟。
 *
 * 这个值是"按钮能不能点到"的决定性因素：它要覆盖用户从段落边缘跨过间隙、
 * 移动到按钮上的全程。阶段文档给的 200ms 在真机上偏紧 —— 指针经过间隙时
 * 落在宿主页面的其它元素上，那段时间计时器照常在跑，稍一犹豫按钮就没了。
 */
const HIDE_DELAY = 500;

/** 按钮与段落右边缘的间隙 */
const GAP = 4;
/** 钳制到视口内时留的边距 */
const MARGIN = 4;

export function createParaBtn(translateOne: TranslateOneFn): () => void {
  const shadow = mountIsolated('para-btn');
  const btn = document.createElement('button');
  btn.className = 'pt-para-btn';
  btn.textContent = '译';
  btn.setAttribute('aria-label', '翻译此段');
  shadow.appendChild(btn);

  let target: Element | null = null;
  let hideTimer: number | undefined;

  const DIRECT = 'p,li,dd,blockquote,h1,h2,h3,h4,h5,h6';

  const isOurUi = (n: EventTarget | null): boolean =>
    n instanceof Element && !!n.closest?.('[data-pt-ui="1"]');

  const show = (el: Element) => {
    clearTimeout(hideTimer);
    target = el;
    position(btn, el);
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = self.setTimeout(() => {
      btn.style.display = 'none';
      target = null;
    }, HIDE_DELAY);
  };

  const onMouseOver = (e: MouseEvent) => {
    const el = (e.target as Element)?.closest?.(DIRECT);
    if (!el || el.closest('[data-pt-ui="1"]')) return;
    if (el.getAttribute('data-pt') === 'done') return;
    show(el);
  };

  const onMouseOut = (e: MouseEvent) => {
    // relatedTarget 是指针即将进入的元素。仍在同一段落内部移动、
    // 或正移向我们自己的按钮，都不该开始倒计时 —— 否则这 500ms
    // 会被段落内的每次子元素切换白白消耗掉。
    const to = e.relatedTarget;
    if (isOurUi(to)) return;
    if (target && to instanceof Node && target.contains(to)) return;
    scheduleHide();
  };

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);

  // 按钮自身的进出：进入取消隐藏，离开重新计时
  btn.addEventListener('mouseover', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseout', scheduleHide);

  // 按钮是 fixed 定位，页面滚动时不会跟着段落走 —— 显示期间重新贴合
  const onReflow = () => {
    if (btn.style.display === 'block' && target) position(btn, target);
  };
  window.addEventListener('scroll', onReflow, { passive: true, capture: true });
  window.addEventListener('resize', onReflow, { passive: true });

  btn.addEventListener('click', () => {
    if (target) translateOne(target);
    clearTimeout(hideTimer);
    btn.style.display = 'none';
  });

  return () => {
    clearTimeout(hideTimer);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    unmountIsolated('para-btn');
  };
}

/**
 * 定位到段落右上角，并钳制在视口内。
 *
 * 不钳制的话按钮会落到屏幕外：段落通常撑满内容列宽，全宽布局下
 * `r.right` 已经接近 innerWidth，再 +4 就出界了；长段落顶部滚出视口时
 * `r.top` 同样会把按钮丢到视口上方。两种情况用户都只会觉得"按钮不见了"。
 */
function position(btn: HTMLElement, el: Element): void {
  btn.style.display = 'block';

  const r = el.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 优先放在段落右外侧；放不下就压到段落右上角内侧
  let left = r.right + GAP;
  if (left + b.width > vw - MARGIN) {
    left = Math.max(MARGIN, r.right - b.width - GAP);
  }

  const top = Math.min(Math.max(r.top, MARGIN), vh - b.height - MARGIN);

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
}
