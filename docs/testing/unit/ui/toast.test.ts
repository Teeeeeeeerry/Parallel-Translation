/**
 * 提示组件 —— 状态类与内容类（#726）
 *
 * #738：调用方显式表明用途，组件不猜文本内容。状态类（失败、配额、站点
 * 禁用等）的停留时长、样式与替换行为与改动前完全一致；内容类（划词译文）
 * 先沿用同样的行为，后面的票再逐条改它。
 *
 * #739：内容类按字数换算停留时长，有下限有上限；状态类的时长不随长度变化。
 * 断言的是“长比短久”“都落在上下限之间”这类关系，不写死毫秒数。
 *
 * #746：等待态 —— 发起划词翻译时显示“翻译中”并带转圈，它自己不会超时
 * 消失；下一条提示到来时被替换，发起方收尾时把仍在等待的那一条收掉。
 *
 * 只看外部可观察的行为：提示里显示了什么文字、过了多久还在不在、同一时刻
 * 页面上有几条提示。假定时器推进时间。
 */
import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { toast, toastPending } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';

/** 页面上当前的提示（挂在隔离的 shadow root 里）。 */
function toasts(): HTMLElement[] {
  const root = document.getElementById('pt-host-toast')?.shadowRoot;
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

/** 一条提示从出现到消失经过的时间（逐步推进假定时器观察，十分钟封顶）。 */
function lifetime(msg: string, purpose: 'status' | 'content'): number {
  toast(msg, { purpose });
  const step = 100;
  let elapsed = 0;
  while (shown().includes(msg) && elapsed < 600_000) {
    vi.advanceTimersByTime(step);
    elapsed += step;
  }
  return elapsed;
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

describe('内容类：显式标明用途（#738）', () => {
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

describe('内容类按长度决定停留多久（#739）', () => {
  const sentence = '这是一句四五十个字的译文，'.repeat(3); // 约 40 字
  const paragraph = '选一整段去翻译，译文有三四百个字，三秒连三分之一都读不完。'.repeat(12);

  test('长译文比短译文停留得久', () => {
    expect(lifetime(paragraph, 'content')).toBeGreaterThan(lifetime(sentence, 'content'));
  });

  test('一句话的译文停留得比状态提示久，不再三秒就消失', () => {
    expect(lifetime(sentence, 'content')).toBeGreaterThan(lifetime(sentence, 'status'));
  });

  test('下限：再短的译文也不一闪而过，一个字与三个字停留一样久，且比状态提示久', () => {
    const one = lifetime('好', 'content');
    expect(lifetime('你好吗', 'content')).toBe(one);
    expect(one).toBeGreaterThan(lifetime('好', 'status'));
  });

  test('上限：特别长的译文也会自己走，再长也不更久', () => {
    const huge = lifetime('很长很长的译文。'.repeat(1000), 'content');
    expect(huge).toBeLessThan(600_000);
    expect(lifetime('很长很长的译文。'.repeat(2000), 'content')).toBe(huge);
  });

  test('一句话、一整段都落在上下限之间', () => {
    const floor = lifetime('好', 'content');
    const ceiling = lifetime('很长很长的译文。'.repeat(1000), 'content');
    for (const text of [sentence, paragraph]) {
      const t = lifetime(text, 'content');
      expect(t).toBeGreaterThanOrEqual(floor);
      expect(t).toBeLessThanOrEqual(ceiling);
    }
    expect(lifetime(sentence, 'content')).toBeGreaterThan(floor);
  });

  test('英文译文同样按长度：长段落比一句话停留得久', () => {
    const en = 'This is a short translated sentence. ';
    expect(lifetime(en.repeat(10), 'content')).toBeGreaterThan(lifetime(en, 'content'));
  });
});

describe('状态类的时长不随长度变化（#739）', () => {
  test('短状态与长错误消息停留一样久', () => {
    const short = lifetime('翻译失败', 'status');
    expect(lifetime('DeepL 返回 456：本月配额已用完，请到账户页查看。'.repeat(20), 'status')).toBe(short);
  });
});

describe('等待态（#746）', () => {
  test('立即显示“翻译中”并带转圈', () => {
    toastPending('翻译中');
    expect(shown()).toEqual(['翻译中']);
    expect(toasts()[0]?.querySelector('.pt-toast-spinner')).not.toBeNull();
  });

  test('自己不会超时消失：十分钟后仍在', () => {
    toastPending('翻译中');
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual(['翻译中']);
  });

  test('之前那条提示的计时不会把它带走', () => {
    toast('扩展已开启', { purpose: 'status' });
    vi.advanceTimersByTime(2000);
    toastPending('翻译中');
    vi.advanceTimersByTime(5000);
    expect(shown()).toEqual(['翻译中']);
  });

  test('结果到来时被替换，页面上只有一条', () => {
    toastPending('翻译中');
    toast('你好世界', { purpose: 'content' });
    expect(shown()).toEqual(['你好世界']);
    expect(toasts()[0]?.querySelector('.pt-toast-spinner')).toBeNull();
  });

  test('失败到来时同样被替换，按状态类计时后消失', () => {
    toastPending('翻译中');
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);
  });

  test('发起方收尾：没有任何提示替换它时（如准入拦截不提示）收掉', () => {
    const pending = toastPending('翻译中');
    pending.dismiss();
    expect(shown()).toEqual([]);
  });

  test('发起方收尾不碰已经替换它的提示', () => {
    const pending = toastPending('翻译中');
    toast('你好世界', { purpose: 'content' });
    pending.dismiss();
    expect(shown()).toEqual(['你好世界']);
  });

  test('发起方收尾不碰后来另一次发起的等待态', () => {
    const first = toastPending('翻译中');
    toastPending('翻译中');
    first.dismiss();
    expect(shown()).toEqual(['翻译中']);
  });
});
