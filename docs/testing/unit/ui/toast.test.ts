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
 * #747：译文到达时等待态就地变成译文 —— 同一条提示换了内容，不是先摘掉再
 * 弹一条新的；替换之后按内容类的时长计时。失败到达时的就地替换是 #748 的事，
 * 这里只钉住失败时等待态不会留在屏幕上。
 *
 * #742：内容类带关闭按钮，点了立即消失、计时一并清掉；状态类与等待态没有。
 *
 * #740：鼠标悬停在内容类提示上时不计时；状态类不受影响。
 *
 * #741：鼠标移开后重新开始完整计时，不是接着剩余时间；移回去再次停住。
 *
 * #745：译文特别长时在提示内部纵向滚动；滚动期间提示不消失 —— 鼠标在提示上
 * 时走悬停不计时，鼠标不在提示上的惯性滚动、键盘滚动每滚一下重新完整计时。
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

describe('译文到达时就地替换等待态（#747）', () => {
  const sentence = '这是一句四五十个字的译文，'.repeat(3);

  test('等待态原地变成译文：还是那一条提示，转圈没了', () => {
    toastPending('翻译中');
    const before = toasts()[0];
    toast(sentence, { purpose: 'content' });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toBe(before);
    expect(shown()).toEqual([sentence]);
    expect(toasts()[0]?.querySelector('.pt-toast-spinner')).toBeNull();
  });

  test('替换过程中页面上始终只有一条提示，旧的从没被摘下', () => {
    toastPending('翻译中');
    const root = document.getElementById('pt-host-toast')!.shadowRoot!;
    let removed = 0;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        removed += Array.from(r.removedNodes).filter(
          (n) => n instanceof HTMLElement && n.classList.contains('pt-toast'),
        ).length;
      }
    });
    mo.observe(root, { childList: true });
    toast(sentence, { purpose: 'content' });
    mo.takeRecords().forEach((r) => {
      removed += Array.from(r.removedNodes).filter(
        (n) => n instanceof HTMLElement && n.classList.contains('pt-toast'),
      ).length;
    });
    mo.disconnect();
    expect(removed).toBe(0);
    expect(toasts()).toHaveLength(1);
  });

  test('替换之后按内容类的时长计时：与直接显示同一段译文停留一样久', () => {
    const direct = lifetime(sentence, 'content');
    toastPending('翻译中');
    vi.advanceTimersByTime(2_000); // 等了一会儿译文才到
    const viaPending = lifetime(sentence, 'content');
    expect(viaPending).toBe(direct);
    expect(viaPending).toBeGreaterThan(lifetime('翻译失败', 'status'));
  });

  test('发起方收尾不会收掉已经就地变成译文的那一条', () => {
    const pending = toastPending('翻译中');
    toast(sentence, { purpose: 'content' });
    pending.dismiss();
    expect(shown()).toEqual([sentence]);
  });

  test('失败到达时等待态不会留在屏幕上：失败提示接替，按状态类计时后消失', () => {
    const pending = toastPending('翻译中');
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    pending.dismiss();
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(3000);
    expect(shown()).toEqual([]);
  });
});

describe('内容类的关闭按钮（#742）', () => {
  const closeBtn = () => toasts()[0]?.querySelector<HTMLButtonElement>('.pt-toast-close') ?? null;

  test('内容类有关闭按钮：真正的按钮元素，带无障碍标签，不往译文里加字', () => {
    toast('你好世界', { purpose: 'content' });
    const btn = closeBtn();
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.type).toBe('button');
    expect(btn!.getAttribute('aria-label')).toBeTruthy();
    expect(shown()).toEqual(['你好世界']);
  });

  test('点了立即消失，计时一并清掉，不留残余', () => {
    toast('你好世界', { purpose: 'content' });
    closeBtn()!.click();
    expect(shown()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('关掉之后再来一条，按它自己的时长计时，不受前一条影响', () => {
    toast('第一段译文', { purpose: 'content' });
    closeBtn()!.click();
    const fresh = lifetime('第二段译文', 'content');
    expect(fresh).toBe(lifetime('第三段译文', 'content'));
  });

  test('等待态就地变成译文后同样有关闭按钮；等待态本身没有', () => {
    toastPending('翻译中');
    expect(closeBtn()).toBeNull();
    toast('你好世界', { purpose: 'content' });
    expect(closeBtn()).not.toBeNull();
  });

  test('状态类不受影响：没有关闭按钮，仍是 3 秒消失', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(closeBtn()).toBeNull();
    expect(toasts()[0]?.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });
});

describe('悬停在内容类提示上时不计时（#740）', () => {
  const hover = () => toasts()[0]!.dispatchEvent(new MouseEvent('mouseenter'));

  test('一出现就悬停：超过它本应消失的时刻仍在', () => {
    const msg = '这是一句四五十个字的译文，'.repeat(3);
    const natural = lifetime(msg, 'content');
    toast(msg, { purpose: 'content' });
    hover();
    vi.advanceTimersByTime(natural * 3);
    expect(shown()).toEqual([msg]);
  });

  test('读到一半才把鼠标放上去：从那一刻起停住，过了本应消失的时刻仍在', () => {
    const msg = '你好世界';
    const natural = lifetime(msg, 'content');
    toast(msg, { purpose: 'content' });
    vi.advanceTimersByTime(natural - 100);
    hover();
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual([msg]);
  });

  test('等待态就地变成译文后悬停同样停住', () => {
    toastPending('翻译中');
    toast('你好世界', { purpose: 'content' });
    hover();
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual(['你好世界']);
  });

  test('悬停时点关闭照样立即消失', () => {
    toast('你好世界', { purpose: 'content' });
    hover();
    toasts()[0]!.querySelector<HTMLButtonElement>('.pt-toast-close')!.click();
    expect(shown()).toEqual([]);
  });

  test('状态类不受影响：悬停也满 3 秒消失，没有关闭按钮', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    hover();
    expect(toasts()[0]?.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });
});

describe('鼠标移开后重新开始计时（#741）', () => {
  const hover = () => toasts()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
  const leave = () => toasts()[0]!.dispatchEvent(new MouseEvent('mouseleave'));
  /** 从现在起到提示消失经过的时间（逐步推进假定时器观察，十分钟封顶）。 */
  function remaining(msg: string): number {
    let elapsed = 0;
    while (shown().includes(msg) && elapsed < 600_000) {
      vi.advanceTimersByTime(100);
      elapsed += 100;
    }
    return elapsed;
  }
  const msg = '这是一句四五十个字的译文，'.repeat(3);

  test('移开后重新开始完整计时：快到点时才悬停，移开后仍停满一整轮', () => {
    const natural = lifetime(msg, 'content');
    toast(msg, { purpose: 'content' });
    vi.advanceTimersByTime(natural - 100);
    hover();
    vi.advanceTimersByTime(10_000);
    leave();
    expect(remaining(msg)).toBe(natural);
  });

  test('移开之后会自己走，不赖着', () => {
    toast(msg, { purpose: 'content' });
    hover();
    vi.advanceTimersByTime(600_000);
    leave();
    expect(remaining(msg)).toBeLessThan(600_000);
    expect(shown()).toEqual([]);
  });

  test('移开再移回，计时再次停住', () => {
    const natural = lifetime(msg, 'content');
    toast(msg, { purpose: 'content' });
    hover();
    leave();
    vi.advanceTimersByTime(natural - 100);
    hover();
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual([msg]);
    leave();
    expect(remaining(msg)).toBe(natural);
  });

  test('等待态就地变成译文后，悬停再移开同样重新完整计时', () => {
    const natural = lifetime('你好世界', 'content');
    toastPending('翻译中');
    toast('你好世界', { purpose: 'content' });
    hover();
    leave();
    expect(remaining('你好世界')).toBe(natural);
  });

  test('状态类不受影响：悬停、移开都不改它的 3 秒', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    vi.advanceTimersByTime(2000);
    hover();
    leave();
    vi.advanceTimersByTime(999);
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });
});

describe('长译文在提示内部滚动，滚动期间不消失（#745）', () => {
  const body = () => toasts()[0]!.querySelector<HTMLElement>('.pt-toast-body');
  const scroll = () => body()!.dispatchEvent(new Event('scroll'));
  const hover = () => toasts()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
  const msg = '这是一句四五十个字的译文，'.repeat(3);
  function remaining(text: string): number {
    let elapsed = 0;
    while (shown().includes(text) && elapsed < 600_000) {
      vi.advanceTimersByTime(100);
      elapsed += 100;
    }
    return elapsed;
  }

  test('内容类的译文放在可滚动的内层里，提示文字仍只有译文', () => {
    toast(msg, { purpose: 'content' });
    expect(body()?.textContent).toBe(msg);
    expect(shown()).toEqual([msg]);
  });

  test('鼠标不在提示上时滚动（惯性、键盘）：每滚一下重新完整计时，滚动期间不消失', () => {
    const natural = lifetime(msg, 'content');
    toast(msg, { purpose: 'content' });
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(natural - 100);
      scroll();
    }
    expect(shown()).toEqual([msg]);
    expect(remaining(msg)).toBe(natural);
  });

  test('鼠标在提示上滚动：走悬停不计时，滚动不会把计时重新开起来', () => {
    toast(msg, { purpose: 'content' });
    hover();
    scroll();
    vi.advanceTimersByTime(600_000);
    expect(shown()).toEqual([msg]);
  });

  test('等待态就地变成译文后同样在内层里滚动', () => {
    toastPending('翻译中');
    toast(msg, { purpose: 'content' });
    expect(body()?.textContent).toBe(msg);
    expect(toasts()[0]?.querySelector('.pt-toast-spinner')).toBeNull();
  });

  test('状态类不受影响：没有可滚动的内层，仍满 3 秒消失', () => {
    toast('翻译失败', { purpose: 'status', kind: 'error' });
    expect(body()).toBeNull();
    toasts()[0]!.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(2999);
    expect(shown()).toEqual(['翻译失败']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
  });
});
