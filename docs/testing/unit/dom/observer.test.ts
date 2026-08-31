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
      const stop = startObserver((els) => seen.push(...els));

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

      stop();
    } finally {
      restore();
    }
  });

  test('characterData 变更（SPA 文本更新）→ 父元素被采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const stop = startObserver((els) => seen.push(...els));

      const p = document.createElement('p');
      p.textContent = 'original text';
      document.body.appendChild(p);

      // React 式原地更新：直接改文本节点数据（无 DOM 增删）
      p.firstChild!.nodeValue = 'updated by SPA';

      await vi.advanceTimersByTimeAsync(300);

      expect(seen).toContain(p);
      stop();
    } finally {
      restore();
    }
  });

  test('译文文本（.pt-trans 内）的变更 → 不触发采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const stop = startObserver((els) => seen.push(...els));

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

      stop();
    } finally {
      restore();
    }
  });

  test('已翻译单元的原文文本被更新（React 原地改）→ 还原并重新采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const stop = startObserver((els) => seen.push(...els));

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
      stop();
    } finally {
      restore();
    }
  });

  test('延迟 attachShadow（host 已在 DOM 后建 shadow）→ shadow 内容被采集（#179）', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const stop = startObserver((els) => seen.push(...els));

      // host 先入 DOM，随后才 attachShadow（模拟延迟初始化的 Web Component）
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const p = document.createElement('p');
      p.textContent = 'late shadow content';
      root.appendChild(p);

      await vi.advanceTimersByTimeAsync(300);

      expect(seen).toContain(p);
      stop();
    } finally {
      restore();
    }
  });

  test('pre 切块产生的 mutation 不进 pending：不二次收集未完成翻译的块', async () => {
    const restore = mockAllBoundingRects();
    try {
      const seen: Element[] = [];
      const stop = startObserver((els) => seen.push(...els));

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

      stop();
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

  test('隐藏单元登记走弱引用（WeakRef），集合不持有强引用', async () => {
    const RealWeakRef = globalThis.WeakRef;
    const spy = vi
      .spyOn(globalThis, 'WeakRef')
      .mockImplementation((target: object) => new RealWeakRef(target));
    try {
      const { registerHidden } = await load();
      const el = document.createElement('p');
      registerHidden(el);
      expect(spy).toHaveBeenCalledWith(el);
    } finally {
      spy.mockRestore();
    }
  });

  test('IO 启动前登记的隐藏单元在启动时被补挂观察', async () => {
    const { registerHidden, startObserver } = await load();
    const el = document.createElement('p');
    registerHidden(el);

    const stop = startObserver(() => {});
    expect(CapturingIO.instances[0]!.observed).toContain(el);
    stop();
  });

  test('IO 启动后登记的隐藏单元被直接观察', async () => {
    const { registerHidden, startObserver } = await load();
    const stop = startObserver(() => {});
    const el = document.createElement('p');
    registerHidden(el);
    expect(CapturingIO.instances[0]!.observed).toContain(el);
    stop();
  });

  test('观察器停止后，旧周期登记的隐藏单元不泄漏到新一轮观察', async () => {
    const { registerHidden, startObserver } = await load();
    const old = document.createElement('p');
    registerHidden(old);

    const stop1 = startObserver(() => {});
    expect(CapturingIO.instances[0]!.observed).toContain(old);
    stop1();

    // 新一轮：旧单元不再被观察，新一轮登记照常工作
    const stop2 = startObserver(() => {});
    expect(CapturingIO.instances[1]!.observed).not.toContain(old);
    const fresh = document.createElement('p');
    registerHidden(fresh);
    expect(CapturingIO.instances[1]!.observed).toContain(fresh);
    stop2();
  });

  test('停止之后再登记隐藏单元：不抛异常，进入新一轮待观察队列', async () => {
    const { registerHidden, startObserver } = await load();
    const stop = startObserver(() => {});
    stop();
    expect(() => registerHidden(document.createElement('p'))).not.toThrow();
  });
});
