/**
 * 以 br 分行的超长段落：增量补翻同样按行切，切块不被反复翻译（#716，规格 #694）
 *
 * 无限滚动、单页应用切换后出现的超长段落同样要被按行切开、逐行翻译。回归
 * 要害在后半句：采集切分段落时插入的切块、搬回原位的 br 与裸内容、渲染时
 * 插入的译文包装，都会产生 DOM 变更记录；增量补翻每一轮都会重新经过采集，
 * 观察器若把扩展自己插入的东西当成页面新内容，切块就会被一轮轮重复送翻，
 * 越翻越多（#158 在 pre 切块上治过同一个问题，这里复用同一条忽略规则）。
 *
 * 经观察器入口 startObserver（假定时器推进防抖，IntersectionObserver 用替身
 * 手动触发）、真实渲染器与还原断言：每一轮采到了哪些单元、同一个切块被采到
 * 几次、译文数量随轮数是否增长、还原之后 DOM 是否逐字节回到原样。端到端
 * TC-E2E-190 在真实浏览器里走一遍滚动后补翻。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { startObserver } from '~/src/dom/observer';
import { render } from '~/src/dom/renderer';
import { unitTextEx } from '~/src/dom/text';
import { brLines, fakeTranslate, line, restorePage } from './br-split-harness';

const N = 60;

/** IntersectionObserver 替身：记下被观察的元素，测试里手动宣布它们可见。 */
class IOStub {
  static last: IOStub | null = null;
  readonly observed = new Set<Element>();
  constructor(private readonly cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    IOStub.last = this;
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  /** 宣布当前被观察的元素全部可见。 */
  fire(): void {
    this.cb([...this.observed].map((target) => ({ target, isIntersecting: true })));
  }
}

/**
 * 盒子替身：一律可见，只有带 hidden 属性的祖先下面是 0×0（与采集的可见性判定
 * 同一口径）。jsdom 不排版，可见与否只能这样模拟。
 */
function mockRectsHonoringHidden(): () => void {
  const restore = mockAllBoundingRects();
  const proto = HTMLElement.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const visible = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.closest('[hidden]') ? ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } as DOMRect) : visible.call(this);
  };
  return restore;
}

let restoreRects: () => void;
let seen: Element[][];
let handle: ReturnType<typeof startObserver>;

beforeEach(() => {
  document.body.innerHTML = '<div id="feed"><p>The first short post in the feed, already on the page.</p></div>';
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', IOStub);
  restoreRects = mockRectsHonoringHidden();
  seen = [];
  handle = startObserver((els) => seen.push(els));
});
afterEach(() => {
  handle.stop();
  restoreRects();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 推进一个防抖窗口之后再多等一会：这期间产生的变更都已经 flush 完。 */
const settle = () => vi.advanceTimersByTimeAsync(1_000);

/** 把采到的单元按替身引擎的译文渲染（模拟一轮补翻的请求回来了）。 */
function renderAll(els: Element[]): void {
  for (const el of els) render(el, fakeTranslate(unitTextEx(el).text), 'page');
}

/** 滚动后追加一篇以 br 分行的超长帖子，返回追加前的 HTML 片段。 */
function appendPost(id: string, attrs = ''): string {
  const html = `<p id="${id}"${attrs}>${brLines(N)}</p>`;
  document.getElementById('feed')!.insertAdjacentHTML('beforeend', html);
  return html;
}

/** 追加一段普通短帖：触发新的一轮增量补翻。 */
function appendShort(i: number): HTMLElement {
  const p = document.createElement('p');
  p.id = `short-${i}`;
  p.textContent = `Short post number ${i} that appeared after another scroll.`;
  document.getElementById('feed')!.appendChild(p);
  return p;
}

describe('增量补翻：新出现的超长段落按行切开，切块只翻一次（#716）', () => {
  test('滚动后追加的超长段落：一轮采到 60 个切块，按原顺序，每行一个', async () => {
    appendPost('post');
    await settle();
    const all = seen.flat();
    expect(all).toHaveLength(N);
    expect(all.every((el) => el.classList.contains('pt-chunk'))).toBe(true);
    expect(all.map((el) => (el.textContent ?? '').trim())).toEqual(Array.from({ length: N }, (_, i) => line(i)));
  });

  test('切块还没翻完（请求在飞）时，切分产生的变更不触发第二轮把它们再采一遍', async () => {
    appendPost('post');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.flat()).toHaveLength(N);
    // 切分插入切块、把 br 搬回原位都会产生变更记录；再等几个防抖窗口
    await settle();
    await settle();
    expect(seen.flat()).toHaveLength(N);
  });

  test('多轮补翻之后：每个切块只被采到一次，切块上的译文数量不随轮数增长', async () => {
    appendPost('post');
    await settle();
    renderAll(seen.flat());
    const post = document.getElementById('post')!;
    const transCount = () => post.querySelectorAll('.pt-trans').length;
    expect(transCount()).toBe(N);

    for (let round = 1; round <= 5; round++) {
      const before = seen.length;
      const short = appendShort(round);
      await settle();
      // 这一轮只采到新追加的那段短帖
      expect(seen.slice(before).flat()).toEqual([short]);
      renderAll(seen.slice(before).flat());
      expect(transCount()).toBe(N);
    }

    // 每个切块在所有轮次里加起来恰好一次
    const counts = new Map<Element, number>();
    for (const el of seen.flat()) counts.set(el, (counts.get(el) ?? 0) + 1);
    for (const chunk of post.querySelectorAll(':scope > .pt-chunk')) expect(counts.get(chunk)).toBe(1);
    expect(post.querySelectorAll('.pt-chunk .pt-chunk')).toHaveLength(0);
  });

  test('单页应用把已经翻好的帖子挪了个位置（节点重新插入）：不重新切分、不再采到任何切块', async () => {
    appendPost('post');
    await settle();
    renderAll(seen.flat());
    const post = document.getElementById('post')!;
    const html = post.outerHTML;
    const before = seen.length;
    // 框架常见的做法：把同一个节点重新插到列表开头，观察器会看到它作为新节点被加入
    document.getElementById('feed')!.prepend(post);
    await settle();
    expect(seen.slice(before).flat()).toEqual([]);
    expect(post.outerHTML).toBe(html);
    expect(post.querySelectorAll('.pt-chunk .pt-chunk')).toHaveLength(0);
  });

  test('出现时不可见的超长段落：可见之后按延迟队列补翻，同样每行一次', async () => {
    appendPost('later', ' hidden');
    await settle();
    // 不可见时一个也没采到，切块登记进了延迟队列
    expect(seen.flat()).toHaveLength(0);
    const later = document.getElementById('later')!;
    later.removeAttribute('hidden');
    IOStub.last!.fire();
    const all = seen.flat();
    expect(all).toHaveLength(N);
    expect(all.every((el) => el.classList.contains('pt-chunk') && el.parentElement === later)).toBe(true);
    // 再来几轮，不重复
    renderAll(all);
    appendShort(1);
    await settle();
    IOStub.last!.fire();
    expect(seen.flat().filter((el) => el.parentElement === later)).toHaveLength(N);
  });
});

describe('还原之后逐字节回到原样（#716）', () => {
  test('增量补翻翻出的超长段落经过多轮之后还原：段落 HTML 与追加时一字不差', async () => {
    const html = appendPost('post');
    await settle();
    renderAll(seen.flat());
    for (let round = 1; round <= 3; round++) {
      appendShort(round);
      await settle();
      renderAll(seen.at(-1)!);
    }
    restorePage();
    expect(document.getElementById('post')!.outerHTML).toBe(html);
  });
});
