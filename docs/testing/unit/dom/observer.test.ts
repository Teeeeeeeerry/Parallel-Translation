/**
 * dom/observer.ts — 增量补翻采集去重单元测试（#158）
 *
 * 覆盖两条系统性重复请求路径：
 * - 祖先+后代同批 pending：分步 append 容器与子元素落在同一防抖窗口，
 *   collect(容器) 已覆盖子树，collect(后代) 再收集一遍 → 同一单元重复请求
 * - pre 切块二次收集：flush#1 的 collect 同步执行 splitPre 插入 .pt-chunk，
 *   插入产生的 mutation 记录若再进 pending，flush#2 会把未完成翻译的
 *   每个块再次发请求（真实引擎耗时 > 300ms 必然触发）
 *
 * jsdom 无 IntersectionObserver，startObserver 的 startWatching 需要占位 mock。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { startObserver } from '~/src/dom/observer';

class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('startObserver 采集去重（#158）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', IOStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  test('祖先+后代同批 pending：只收集祖先覆盖的子树，每单元只回调一次', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      // 分步 append：容器与子元素落在同一 300ms 防抖窗口
      const container = document.createElement('div');
      document.body.appendChild(container);
      const p = document.createElement('p');
      p.textContent = 'stepwise appended paragraph';
      container.appendChild(p);

      await vi.advanceTimersByTimeAsync(300);

      // 修复前：collect(container) 与 collect(p) 各收集一次 p → 同一文本两条请求
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(p);

      handle.stop();
    } finally {
      restore();
    }
  });

  test('characterData 变更（SPA 文本更新）→ 父元素被采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      const p = document.createElement('p');
      p.textContent = 'original text';
      document.body.appendChild(p);

      // React 式原地更新：直接改文本节点数据（无 DOM 增删）
      p.firstChild!.nodeValue = 'updated by SPA';

      await vi.advanceTimersByTimeAsync(300);

      expect(seen).toContain(p);
      handle.stop();
    } finally {
      restore();
    }
  });

  test('译文文本（.pt-trans 内）的变更 → 不触发采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      const p = document.createElement('p');
      p.textContent = '原文';
      document.body.appendChild(p);
      p.setAttribute('data-pt', 'done');
      const origin = document.createElement('span');
      origin.className = 'pt-origin';
      origin.textContent = '原文';
      const trans = document.createElement('span');
      trans.className = 'pt-trans';
      trans.textContent = '译文';
      p.append(origin, trans);

      // 页面 JS 改了译文文本 —— 不应再次采集（避免自激）
      trans.firstChild!.nodeValue = '新译文';
      await vi.advanceTimersByTimeAsync(300);
      expect(seen).toHaveLength(0);

      handle.stop();
    } finally {
      restore();
    }
  });

  test('已翻译单元的原文文本被更新（React 原地改）→ 还原并重新采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      const p = document.createElement('p');
      p.textContent = '旧原文';
      document.body.appendChild(p);
      p.setAttribute('data-pt', 'done');
      const origin = document.createElement('span');
      origin.className = 'pt-origin';
      origin.textContent = '旧原文';
      const trans = document.createElement('span');
      trans.className = 'pt-trans';
      trans.textContent = '旧译文';
      p.append(origin, trans);

      // React 式：更新原文文本节点数据（.pt-origin 内）
      origin.firstChild!.nodeValue = '新原文';

      await vi.advanceTimersByTimeAsync(300);

      // 单元被还原（data-pt 清除）并重新采集
      expect(p.getAttribute('data-pt')).toBeNull();
      expect(seen).toContain(p);
      handle.stop();
    } finally {
      restore();
    }
  });

  test('延迟 attachShadow（host 已在 DOM 后建 shadow）→ shadow 内容被采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      // host 先入 DOM，随后才 attachShadow（模拟延迟初始化的 Web Component）
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const p = document.createElement('p');
      p.textContent = 'late shadow content';
      root.appendChild(p);

      await vi.advanceTimersByTimeAsync(300);

      expect(seen).toContain(p);
      handle.stop();
    } finally {
      restore();
    }
  });

  test('pre 切块产生的 mutation 不进 pending：不二次收集未完成翻译的块', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      // 超长纯文本 pre（> MAX_TEXT），段落间空行分隔 → splitPre 切出多个 .pt-chunk
      const para = (i: number) =>
        Array.from({ length: 5 }, (_, j) => `Line ${i * 5 + j} of paragraph ${i} in a long plain text document.`).join('\n');
      const pre = document.createElement('pre');
      pre.textContent = Array.from({ length: 24 }, (_, i) => para(i)).join('\n\n');
      document.body.appendChild(pre);

      // flush#1：collect 同步切块并收集全部块 → 一次回调
      await vi.advanceTimersByTimeAsync(300);
      expect(seen.length).toBeGreaterThan(1);
      const first = new Set(seen);

      // 再等一个防抖窗口：切块插入的 mutation 若进 pending 会触发 flush#2
      await vi.advanceTimersByTimeAsync(1000);
      expect(seen.length).toBe(first.size);

      // 每块恰好一次
      for (const el of first) {
        expect(seen.filter((x) => x === el)).toHaveLength(1);
      }

      handle.stop();
    } finally {
      restore();
    }
  });
});

describe('可见性追踪弱引用与停止清理（#330）', () => {
  /** 记录 observe 目标与实例序号的 IO 桩。 */
  class CapturingIO {
    static instances: CapturingIO[] = [];
    observed: Element[] = [];
    callback: (entries: { isIntersecting: boolean; target: Element }[]) => void;

    constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
      this.callback = cb;
      CapturingIO.instances.push(this);
    }

    observe(el: Element): void {
      this.observed.push(el);
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
    CapturingIO.instances = [];
    vi.stubGlobal('IntersectionObserver', CapturingIO);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  async function load() {
    return import('~/src/dom/observer');
  }

  test('句柄创建后补挂启动前登记的隐藏单元（首轮翻译期间登记不丢失，#332）', async () => {
    const { startObserver } = await load();
    // 模拟 content 的登记缓冲：句柄创建（观察器启动）前采集到的
    // 隐藏单元，在创建后经 handle.registerHidden 补挂
    const buffered = [
      document.createElement('p'),
      document.createElement('p'),
    ];
    const handle = startObserver(() => {});
    for (const el of buffered) handle.registerHidden(el);
    expect(CapturingIO.instances[0]!.observed).toEqual(buffered);
    handle.stop();
  });

  test('句柄登记被直接观察', async () => {
    const { startObserver } = await load();
    const handle = startObserver(() => {});
    const el = document.createElement('p');
    handle.registerHidden(el);
    expect(CapturingIO.instances[0]!.observed).toContain(el);
    handle.stop();
  });

  test('观察器停止后，旧周期登记的隐藏单元不泄漏到新一轮观察', async () => {
    const { startObserver } = await load();
    const handle1 = startObserver(() => {});
    const old = document.createElement('p');
    handle1.registerHidden(old);
    expect(CapturingIO.instances[0]!.observed).toContain(old);
    handle1.stop();

    // 新一轮：旧单元不再被观察，新一轮登记照常工作
    const handle2 = startObserver(() => {});
    expect(CapturingIO.instances[1]!.observed).not.toContain(old);
    const fresh = document.createElement('p');
    handle2.registerHidden(fresh);
    expect(CapturingIO.instances[1]!.observed).toContain(fresh);
    handle2.stop();
  });

  test('停止之后句柄登记不产生效果且不抛异常', async () => {
    const { startObserver } = await load();
    const handle = startObserver(() => {});
    const before = CapturingIO.instances[0]!.observed.length;
    handle.stop();
    expect(() => handle.registerHidden(document.createElement('p'))).not.toThrow();
    expect(CapturingIO.instances[0]!.observed).toHaveLength(before);
  });
});

describe('观察器句柄化（#331）', () => {
  class CapturingIO {
    static instances: CapturingIO[] = [];
    observed: Element[] = [];
    callback: (entries: { isIntersecting: boolean; target: Element }[]) => void;

    constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
      this.callback = cb;
      CapturingIO.instances.push(this);
    }

    observe(el: Element): void {
      this.observed.push(el);
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.resetModules();
    CapturingIO.instances = [];
    vi.stubGlobal('IntersectionObserver', CapturingIO);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  async function load() {
    return import('~/src/dom/observer');
  }

  test('句柄提供停止与隐藏单元登记两项能力', async () => {
    const { startObserver } = await load();
    const handle = startObserver(() => {});
    expect(typeof handle.stop).toBe('function');
    expect(typeof handle.registerHidden).toBe('function');
    handle.stop();
  });

  test('停止之后产生 DOM 变更，补翻回调不再被调用', async () => {
    vi.useFakeTimers();
    const restore = mockAllBoundingRects();
    try {
      const { startObserver } = await load();
      const seen: Element[] = [];
      const handle = startObserver((els) => seen.push(...els));

      const p = document.createElement('p');
      p.textContent = 'first';
      document.body.appendChild(p);
      await vi.advanceTimersByTimeAsync(300);
      expect(seen).toContain(p);

      handle.stop();
      const p2 = document.createElement('p');
      p2.textContent = 'second';
      document.body.appendChild(p2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(seen).not.toContain(p2);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  test('停止是幂等的：连续调用两次不抛异常、无副作用', async () => {
    const { startObserver } = await load();
    const handle = startObserver(() => {});
    expect(() => {
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });

  test('连续「启动 → 停止 → 启动」后行为与首次一致，前一轮隐藏单元不泄漏', async () => {
    const { startObserver } = await load();
    const seen: Element[] = [];
    const handle1 = startObserver((els) => seen.push(...els));
    const el1 = document.createElement('p');
    handle1.registerHidden(el1);
    expect(CapturingIO.instances[0]!.observed).toContain(el1);
    handle1.stop();

    const handle2 = startObserver((els) => seen.push(...els));
    // 前一轮的隐藏单元不进入新一轮观察
    expect(CapturingIO.instances[1]!.observed).not.toContain(el1);
    // 新一轮登记照常被观察
    const el2 = document.createElement('p');
    handle2.registerHidden(el2);
    expect(CapturingIO.instances[1]!.observed).toContain(el2);
    handle2.stop();
  });

  test('单测不依赖跨用例共享的模块级状态：各句柄状态互不可见', async () => {
    const { startObserver } = await load();
    const a = startObserver(() => {});
    const b = startObserver(() => {});
    const ea = document.createElement('p');
    const eb = document.createElement('p');
    a.registerHidden(ea);
    b.registerHidden(eb);
    // 各自的登记只进各自的观察实例
    expect(CapturingIO.instances[0]!.observed).toContain(ea);
    expect(CapturingIO.instances[0]!.observed).not.toContain(eb);
    expect(CapturingIO.instances[1]!.observed).toContain(eb);
    expect(CapturingIO.instances[1]!.observed).not.toContain(ea);
    a.stop();
    b.stop();
  });
});
