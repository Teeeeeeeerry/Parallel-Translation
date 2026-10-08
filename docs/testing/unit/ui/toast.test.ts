/**
 * 提示组件 —— 状态类与内容类（#726）
 *
 * #738：调用方显式表明用途，组件不猜文本内容。状态类（失败、配额、站点
 * 禁用等）的停留时长、样式与替换行为与改动前完全一致；内容类（划词译文）
 * 先沿用同样的行为，后面的票再逐条改它。
 *
 * 只看外部可观察的行为：提示里显示了什么文字、过了多久还在不在、同一时刻
 * 页面上有几条提示。假定时器推进时间。
 */
import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { toast } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';

/** 页面上当前的提示（挂在隔离的 shadow root 里）。 */
function toasts(): HTMLElement[] {
  const root = document.getElementById('pt-host-toast')?.shadowRoot;
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

function shown(): string[] {
  return toasts().map((el) => el.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  toasts().forEach((el) => el.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => {
  unmountIsolated('toast');
});

describe('状态类：行为与改动前一致（#738）', () => {
  test('显示文字，3 秒内一直在，满 3 秒消失', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });

  test('失败用错误样式，其余用常规样式', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(toasts()[0]?.dataset.kind).toBe('error');
    toast('扩展已开启', { purpose: 'status' });
    expect(toasts()[0]?.dataset.kind).toBe('info');
  });

  test('新的一条直接替换旧的，并从头计时', () => {
    toast('第一条', { purpose: 'status' });
    vi.advanceTimersByTime(2000);
    toast('第二条', { purpose: 'status' });
    expect(shown()).toEqual(['第二条']);
    // 旧的计时不再作数：从第二条出现起算，2 秒后仍在
    vi.advanceTimersByTime(2000);
    expect(shown()).toEqual(['第二条']);
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual([]);
  });
});

describe('内容类：显式标明用途，行为先与改动前相同（#738）', () => {
  test('显示译文，满 3 秒消失', () => {
    toast('你好世界', { purpose: 'content' });
    expect(shown()).toEqual(['你好世界']);
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual(['你好世界']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });

  test('用常规样式', () => {
    toast('你好世界', { purpose: 'content' });
    expect(toasts()[0]?.dataset.kind).toBe('info');
  });

  test('与状态类共用一个位置：互相替换，页面上始终只有一条', () => {
    toast('你好世界', { purpose: 'content' });
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(shown()).toEqual(['翻译失败']);
    toast('再见', { purpose: 'content' });
    expect(shown()).toEqual(['再见']);
  });

  test('用途由调用方决定，不看文字长短：很长的错误消息仍按状态类', () => {
    const longError = 'DeepL 返回 456：本月配额已用完。'.repeat(20);
    toast(longError, { purpose: 'status', kind: 'error' });
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);
  });
});
