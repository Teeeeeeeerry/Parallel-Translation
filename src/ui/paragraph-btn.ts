// Phase 5 — 段落悬停浮出按钮。
// 鼠标进入可翻译段落时，在其右侧浮出一个小按钮。
// 单个按钮实例复用，随鼠标在段落间移动，不为每段各建一个。

import { mountIsolated, unmountIsolated } from './mount';
import { closestUnit } from '../dom/classify';
import { tf } from '../i18n';

type TranslateOneFn = (el: Element) => Promise<void>;
type RestoreOneFn = (el: Element) => void;

/** 段落按钮的回调：按目标段落当前的翻译态分流 */
interface ParaBtnHandlers {
  translate: TranslateOneFn;
  restore: RestoreOneFn;
}

/**
 * 离开段落后的隐藏延迟。
 *
 * 这个值是“按钮能不能点到”的决定性因素：它要覆盖用户从段落边缘跨过间隙、
 * 移动到按钮上的全程。阶段文档给的 200ms 在真机上偏紧 —— 指针经过间隙时
 * 落在宿主页面的其它元素上，那段时间计时器照常在跑，稍一犹豫按钮就没了。
 *
 * 取 1.5 秒是用户实机试用后定的值。偏长的代价是移开鼠标后按钮还会停留一会儿，
 * 但它只占段落右上角一小块、不挡正文，比“够不着”轻得多。
 */
const HIDE_DELAY = 1500;

/**
 * 悬停意图延迟：指针在同一段落上停住这么久才浮出按钮。
 *
 * 没有这道闸门时，mouseover 一命中段落就立刻浮出并重定位 —— 鼠标从文章
 * 上方扫到下方，按钮会挨个段落跳几十次，看起来就是不停闪。HIDE_DELAY
 * 越长这个现象越显眼，因为按钮全程挂着而不是跳完就消失。
 *
 * 140ms 略低于人眼把“停顿”与“路过”区分开的阈值，有意停留时几乎无感，
 * 单纯划过则完全不触发。
 */
const SHOW_DELAY = 140;

/** 按钮与段落边缘的间隙 */
const GAP = 4;
/** 钳制到视口内时留的边距 */
const MARGIN = 4;

/**
 * 段落按钮的候选选择器：可翻译块级正文 + div 型正文容器。
 * 只做便宜的初筛 —— closest() 命中后，真正的判定（isTranslationUnit +
 * shouldSkip，与采集器同一套）在 SHOW_DELAY 计时器回调里做：
 * shouldSkip 拼 outerHTML、调 getBoundingClientRect 会强制同步布局，
 * 不能挂在每次 mouseover 上。
 */
const CANDIDATE =
  'p,li,dd,blockquote,h1,h2,h3,h4,h5,h6,' +
  'div,section,article,main,figure';

export function createParaBtn(handlers: ParaBtnHandlers): () => void {
  const { translate, restore } = handlers;
  const shadow = mountIsolated('para-btn');
  const btn = document.createElement('button');
  btn.className = 'pt-para-btn';
  btn.setAttribute('aria-label', tf('paraBtnLabel', '翻译此段'));
  shadow.appendChild(btn);

  let target: Element | null = null;
  let hideTimer: number | undefined;
  let showTimer: number | undefined;

  const isOurUi = (n: EventTarget | null): boolean =>
    n instanceof Element && !!n.closest?.('[data-pt-ui="1"]');

  const isVisible = () => btn.style.display === 'block';

  const show = (el: Element) => {
    // 从无到有时淡入；在段落之间移动时只改位置，再淡一次反而更像闪。
    // 标签页在后台时渲染挂起、过渡时间线不推进，淡入会冻在起点，
    // 直接跳过动画一步到位。
    if (!isVisible() && document.visibilityState === 'visible') {
      btn.style.opacity = '0';
    }
    target = el;

    // 双向切换：已翻译段落浮出“还原”态按钮，否则是“翻译”态。
    // 文案与 aria-label 随态切换（走 i18n，不硬编码）。
    const done = el.getAttribute('data-pt') === 'done';
    btn.textContent = done
      ? tf('paraBtnRestoreGlyph', '原')
      : tf('paraBtnGlyph', '译');
    btn.setAttribute(
      'aria-label',
      done ? tf('paraBtnRestoreLabel', '还原此段') : tf('paraBtnLabel', '翻译此段'),
    );

    // position() 内部读 getBoundingClientRect 会强制一次布局，把上面的
    // opacity: 0 与 display: block 一并提交，随后置 1 才会真正走过渡。
    //
    // 这里刻意不用 requestAnimationFrame：标签页在后台时 rAF 不回调，
    // 回调里那句 opacity = '1' 就永远不执行，按钮卡在全透明 —— 看不见
    // 却仍占着点击区域。用强制回流的失败模式只是“没有淡入动画”，
    // 而不是“按钮消失”。
    position(btn, el);
    btn.style.opacity = '1';
  };

  const scheduleHide = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = self.setTimeout(() => {
      btn.style.display = 'none';
      target = null;
    }, HIDE_DELAY);
  };

  const onMouseOver = (e: MouseEvent) => {
    // 便宜初筛：候选选择器向上找最近的段落/容器。Google 搜索摘要等
    // div 型正文不在旧的 p/li/h* 白名单里 —— 候选放宽到正文容器，
    // 判定精度交给计时器里的 closestUnit()。
    const hit = (e.target as Element)?.closest?.(CANDIDATE);
    const x = e.clientX;
    const y = e.clientY;
    clearTimeout(showTimer);
    showTimer = self.setTimeout(() => {
      // 悬停意图确认后才做精判。命中测试与 elementsFromPoint 都会强制
      // 同步布局（shouldSkip 拼 outerHTML、调 getBoundingClientRect），
      // 鼠标划过时计时器每次都被重置、只有真正停住才执行 ——
      // 划过的路上零布局成本。
      //
      // 自己的 UI（悬浮球等）不触发按钮；兜底找覆盖层也不能越过 UI。
      if (hit && hit.closest('[data-pt-ui="1"]')) return;

      // 精判（isTranslationUnit + shouldSkip）：按钮与采集器同一套标准，
      // 白名单之外的大容器（如 AI 概览的外层 li）不会再被错误命中。
      let el = hit ? closestUnit(hit) : null;
      if (!el) {
        // 整卡点击覆盖层（stretched link）的兜底：命中测试落在铺满卡片
        // 的伪元素上，而伪元素算到产生它的祖先 <a> —— closest() 只向上
        // 找，够不到被盖住的后代段落（h2/p）。
        el = findUnderOverlay(x, y);
      }
      if (!el) return;

      // 已经停在这一段上了 —— 段落内部换子元素不重定位，省掉无谓的强制布局
      if (el === target && isVisible()) return;

      clearTimeout(hideTimer);
      show(el);
    }, SHOW_DELAY);
  };

  const onMouseOut = (e: MouseEvent) => {
    // relatedTarget 是指针即将进入的元素。仍在同一段落内部移动、
    // 或正移向我们自己的按钮，都不该开始倒计时 —— 否则这 1.5 秒
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
    if (!target) return;
    // 按目标段落当前的翻译态分流：已翻译 → 还原，否则 → 翻译。
    // 翻译/还原完成后按钮隐藏，下次悬停按新状态重新判定。
    if (target.getAttribute('data-pt') === 'done') restore(target);
    else translate(target);
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    btn.style.display = 'none';
  });

  return () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    unmountIsolated('para-btn');
  };
}

/**
 * 沿 elementsFromPoint 的命中栈找被覆盖层遮住的段落（stretched link 兜底）。
 * 命中栈按 z 序从顶层元素排到 <html>，被伪元素盖住的后代段落也在栈里 ——
 * 对每层做 closest(CANDIDATE) 再 closestUnit() 精判，即可捞到覆盖层
 * 下方可翻的 h2/p/div 型正文。
 *
 * 只取前 8 层：覆盖层 → 卡片容器 → 标题包裹层 → 段落的典型结构在
 * 3~5 层内，更深处在深层嵌套页面上会捞到远处无关元素。
 */
function findUnderOverlay(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y);
  for (const n of stack.slice(0, 8)) {
    const el = n.closest?.(CANDIDATE);
    if (!el || el.closest('[data-pt-ui="1"]')) continue;
    const unit = closestUnit(el);
    if (unit) return unit;
  }
  return null;
}

/**
 * 取元素内文字的实际行盒矩形列表（`Range.getClientRects()`）。
 * 空列表意味着元素内容全是浮动/绝对定位子元素等没有行盒的情况。
 */
function textRects(el: Element): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()];
}

/**
 * 定位到段落文字末尾，并钳制在视口内。
 *
 * 改用文字实际占据的行盒而非元素边框盒定位：块级元素默认撑满容器宽度，
 * `getBoundingClientRect().right` 是容器右边缘，与文字实际排到哪里无关。
 * 列表这类“容器很宽、每行文字很短”的排版下，按钮和它所指的那行字之间
 * 会被拉开一大段空白。
 *
 * 行盒取首行（竖直方向保持贴段落顶部的现有行为），单行条目紧贴文字末尾，
 * 多行段落首行通常是满行，位置与现在一致。
 *
 * 视口钳制保留不动 —— 宽屏满行段落仍然需要右侧放不下的兜底分支。
 */
function position(btn: HTMLElement, el: Element): void {
  btn.style.display = 'block';

  const rects = textRects(el);
  const b = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left: number;
  let top: number;

  if (rects.length > 0) {
    const isRtl = getComputedStyle(el).direction === 'rtl';
    const first = rects[0]!;
    top = first.top;

    if (isRtl) {
      // RTL：文字末尾在左边，按钮贴在文字左侧。
      left = first.left - GAP - b.width;
    } else {
      // LTR：文字末尾在右边，按钮贴在文字右侧。
      left = first.right + GAP;
    }
  } else {
    // 空 rects 兜底（子元素全是浮动/绝对定位）：退回到 getBoundingClientRect。
    const r = el.getBoundingClientRect();
    top = r.top;
    left = r.right + GAP;
  }

  if (left + b.width > vw - MARGIN) {
    // 右侧放不下（宽屏满行段落仍是这个情况）。退到段落右上角，
    // 并优先浮到段落**上方**的行间空白里 —— 压在正文上会遮住正在读的
    // 那一行，视觉上同样像“闪”。上方也没地方时才落回段落内。
    const r = el.getBoundingClientRect();
    left = Math.max(MARGIN, r.right - b.width - GAP);
    const above = r.top - b.height - GAP;
    if (above >= MARGIN) top = above;
  }

  // RTL 段落按钮贴左侧时可能超出左边界，做一次左侧钳制。
  if (left < MARGIN) left = MARGIN;

  // 先取上限再取下限：视口比按钮还矮时（极端窄窗、部分嵌入式 webview），
  // 反过来写会让 Math.min 选中负的上限，把按钮推到视口外。
  top = Math.max(MARGIN, Math.min(top, vh - b.height - MARGIN));

  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
}
