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
