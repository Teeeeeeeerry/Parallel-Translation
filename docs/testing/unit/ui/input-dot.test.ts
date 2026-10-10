/**
 * 输入翻译圆点 —— 出现、消失与启停（#636）
 *
 * 经生命周期注册表启停（与悬浮球、逐段按钮同一条路）：开关关掉即刻
 * 解绑监听，打开即刻生效，启停幂等。本票圆点只用 ADR-0006 定的回落
 * 位置（框内侧右下角）。
 *
 * #639：点圆点把当前输入框交给翻译回调；框里的文字一个字不动。
 * #647：翻译进行中再点不发第二次请求；完成、失败后恢复可点。
 * #648：进行中圆点挂上进行中状态（变灰转圈），结束后回到常态。
 * #655：contenteditable 的编辑宿主获得焦点且有文字时同样浮出，位置用同一个
 * 回落位置；非编辑态的元素与可编辑区里的 contenteditable=false 子块不出现。
 * #656：受控编辑器拦下 beforeinput 自己改 DOM，不会有 input 事件 —— 编辑宿主
 * 里的文字变化同样让圆点跟着出现与消失。
 * #665：多行文本框贴文字末尾靠镜像测量，位置的真值只能在真实浏览器里断言
 * （TC-E2E-134）；jsdom 没有布局，测量算不出来，这里只覆盖回落分支。
 * #666 的单行文本框同理（真值见 TC-E2E-138）。
 * #668：字体加载完成、站点改了框的样式之后重新对齐；同样用回落分支观察。
 * #671：contenteditable 用行盒测量贴文字末尾（真值见 TC-E2E-141），停手对齐与
 * 回落沿用同一套，这里同样只覆盖回落分支。
 * #670：连续打字期间不重算位置，停手后（与逐段按钮悬停意图同一个 140ms
 * 口径）对齐一次。这里用回落分支观察：打字期间框挪了位置，圆点也不跟。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLifecycleRegistry, type LifecycleRegistry } from '~/src/ui/lifecycle-registry';
import { createInputDot } from '~/src/ui/input-dot';
import { mockBoundingRect } from '~/docs/testing/setup';
import { SHOW_DELAY } from '~/src/ui/paragraph-btn';

let registry: LifecycleRegistry;
let translate: ReturnType<typeof vi.fn>;

function dot(): HTMLElement | null {
  const host = document.getElementById('pt-host-input-dot');
  return (host?.shadowRoot?.querySelector('.pt-input-dot') as HTMLElement | null) ?? null;
}

const shown = (): boolean => dot()?.style.display === 'block';

function textarea(value: string): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = value;
  document.body.appendChild(ta);
  return ta;
}

function type(ta: HTMLTextAreaElement, value: string): void {
  ta.value = value;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  registry = createLifecycleRegistry();
  translate = vi.fn(async () => {});
  registry.register('input-dot', {
    create: () => createInputDot({ translate }),
    stop: (stop) => stop(),
  });
});

afterEach(() => {
  registry.dispose();
});

describe('出现与消失（#636）', () => {
  test('焦点落进有 2 个字符的多行文本框 → 圆点出现', () => {
    registry.ensure('input-dot', true);
    textarea('你好').focus();
    expect(shown()).toBe(true);
  });

  test('空框、只有 1 个字符时不出现；打到第 2 个字符才出现', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('');
    ta.focus();
    expect(shown()).toBe(false);
    type(ta, 'a');
    expect(shown()).toBe(false);
    type(ta, 'ab');
    expect(shown()).toBe(true);
  });

  test('删到不足 2 个字符 → 圆点消失', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('ab');
    ta.focus();
    type(ta, 'a');
    expect(shown()).toBe(false);
  });

  test('失焦即消失', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('hello');
    ta.focus();
    expect(shown()).toBe(true);
    ta.blur();
    expect(shown()).toBe(false);
  });

  test('按下圆点不夺走输入框的焦点', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('hello');
    ta.focus();
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    dot()!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('位置回落到框内侧右下角（ADR-0006）', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('hello');
    mockBoundingRect(ta, { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 });
    ta.focus();
    const left = parseFloat(dot()!.style.left);
    const top = parseFloat(dot()!.style.top);
    // 在框内，且贴近右下角
    expect(left).toBeGreaterThan(400 - 40);
    expect(left).toBeLessThan(400);
    expect(top).toBeGreaterThan(150 - 40);
    expect(top).toBeLessThan(150);
  });

  test('多行文本框量不出文字末尾（jsdom 没有布局）→ 回落框内侧右下角，照常显示，不留镜像（#665）', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('第一行\n第二行  ');
    mockBoundingRect(ta, { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 });
    ta.focus();
    expect(shown()).toBe(true);
    expect(parseFloat(dot()!.style.left)).toBeGreaterThan(400 - 40);
    expect(parseFloat(dot()!.style.top)).toBeGreaterThan(150 - 40);
    // 打字后重算同样回落
    type(ta, '第一行\n第二行\n\n');
    expect(parseFloat(dot()!.style.left)).toBeGreaterThan(400 - 40);
    // 量完立刻移除镜像：shadow root 里只有样式与圆点
    const shadow = document.getElementById('pt-host-input-dot')!.shadowRoot!;
    expect([...shadow.children].map((c) => c.tagName)).toEqual(['STYLE', 'BUTTON']);
  });

  test('单行文本框量不出文字末尾 → 同样回落框内侧右下角，照常显示，不留镜像（#666）', () => {
    registry.ensure('input-dot', true);
    const input = document.createElement('input');
    input.value = 'hello world';
    document.body.lang = 'en';
    document.body.appendChild(input);
    mockBoundingRect(input, { left: 100, top: 50, right: 400, bottom: 80, width: 300, height: 30 });
    input.focus();
    expect(shown()).toBe(true);
    expect(parseFloat(dot()!.style.left)).toBeGreaterThan(400 - 40);
    expect(parseFloat(dot()!.style.left)).toBeLessThan(400);
    const shadow = document.getElementById('pt-host-input-dot')!.shadowRoot!;
    expect([...shadow.children].map((c) => c.tagName)).toEqual(['STYLE', 'BUTTON']);
  });

  test('停手之后网页字体才加载完 → 重新对齐一次（#668）', () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
    try {
      registry.ensure('input-dot', true);
      const ta = textarea('hello');
      mockBoundingRect(ta, { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 });
      ta.focus();
      expect(parseFloat(dot()!.style.left)).toBeLessThan(400);
      // 字体换掉之后排版变了（这里用框挪位置代表）：没有输入、没有滚动
      mockBoundingRect(ta, { left: 500, top: 50, right: 800, bottom: 150, width: 300, height: 100 });
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(parseFloat(dot()!.style.left)).toBeGreaterThan(800 - 40);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  test('停手之后站点改了框的样式或 class → 重新对齐（#668）', async () => {
    registry.ensure('input-dot', true);
    const ta = textarea('hello');
    mockBoundingRect(ta, { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 });
    ta.focus();
    mockBoundingRect(ta, { left: 500, top: 50, right: 800, bottom: 150, width: 300, height: 100 });
    ta.style.fontSize = '24px';
    await Promise.resolve();
    expect(parseFloat(dot()!.style.left)).toBeGreaterThan(800 - 40);
    mockBoundingRect(ta, { left: 900, top: 50, right: 1200, bottom: 150, width: 300, height: 100 });
    ta.className = 'expanded';
    await Promise.resolve();
    expect(parseFloat(dot()!.style.left)).toBeGreaterThan(1200 - 40);
  });

  test('圆点挂在扩展自己的隔离宿主里，带跳过标记', () => {
    registry.ensure('input-dot', true);
    const host = document.getElementById('pt-host-input-dot')!;
    expect(host.dataset.ptUi).toBe('1');
    expect(host.shadowRoot).not.toBeNull();
  });
});

describe('开关启停（#636）', () => {
  test('关掉即刻解绑：宿主移除，再聚焦也不出现', () => {
    registry.ensure('input-dot', true);
    registry.ensure('input-dot', false);
    expect(document.getElementById('pt-host-input-dot')).toBeNull();
    textarea('hello').focus();
    expect(dot()).toBeNull();
  });

  test('打开即刻生效：已经聚焦的框不必重新聚焦', () => {
    const ta = textarea('hello');
    ta.focus();
    registry.ensure('input-dot', true);
    expect(shown()).toBe(true);
  });

  test('启停幂等：重复打开只有一个宿主', () => {
    registry.ensure('input-dot', true);
    registry.ensure('input-dot', true);
    expect(document.querySelectorAll('#pt-host-input-dot')).toHaveLength(1);
  });
});

describe('点圆点翻译（#639）', () => {
  test('点击把当前输入框交给翻译回调，框里的文字不动', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith(ta);
    expect(ta.value).toBe('你好世界');
  });

  test('圆点没浮出时（框里不足 2 个字符）点击不触发翻译', () => {
    registry.ensure('input-dot', true);
    textarea('a').focus();
    dot()!.click();
    expect(translate).not.toHaveBeenCalled();
  });
});

describe('翻译进行中不重复触发（#647）', () => {
  /** 一个由测试手动结束的翻译回调。 */
  function deferredTranslate() {
    const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    translate.mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    return pending;
  }

  test('进行中再点不发第二次请求，框里文字一个字不动', () => {
    const pending = deferredTranslate();
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    dot()!.click();
    dot()!.click();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(ta.value).toBe('你好世界');
    expect(pending).toHaveLength(1);
  });

  test('完成后恢复可点', async () => {
    const pending = deferredTranslate();
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    pending[0]!.resolve();
    await vi.waitFor(() => {
      dot()!.click();
      expect(translate).toHaveBeenCalledTimes(2);
    });
  });

  test('失败后恢复可点', async () => {
    const pending = deferredTranslate();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    pending[0]!.reject(new Error('boom'));
    await vi.waitFor(() => {
      dot()!.click();
      expect(translate).toHaveBeenCalledTimes(2);
    });
    err.mockRestore();
  });

  test('一个框在翻译中，另一个框照常可点', () => {
    deferredTranslate();
    registry.ensure('input-dot', true);
    const a = textarea('你好世界');
    const b = textarea('早上好');
    a.focus();
    dot()!.click();
    b.focus();
    dot()!.click();
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenLastCalledWith(b);
  });
});

describe('单行文本框与搜索框（#650）', () => {
  function input(type: string, value: string): HTMLInputElement {
    const el = document.createElement('input');
    el.type = type;
    el.value = value;
    document.body.appendChild(el);
    return el;
  }

  test('普通文本框与搜索框里有 2 个字符 → 圆点出现，点击交给翻译回调', () => {
    registry.ensure('input-dot', true);
    for (const type of ['text', 'search']) {
      const el = input(type, '你好');
      el.focus();
      expect(shown()).toBe(true);
      dot()!.click();
      expect(translate).toHaveBeenLastCalledWith(el);
    }
  });

  test('密码框与其余类型的单行输入框不出现圆点', () => {
    registry.ensure('input-dot', true);
    for (const type of ['password', 'email', 'number', 'url', 'tel']) {
      input(type, type === 'number' ? '12' : 'hello@example.com').focus();
      expect(shown()).toBe(false);
    }
  });

  // #652：邮箱、电话、数字、网址各一条 —— 框里有字、获得焦点、再打字都不出现，点击不触发翻译
  for (const [type, value] of [
    ['email', 'me@example.com'],
    ['tel', '+86 138 0000 0000'],
    ['number', '42'],
    ['url', 'https://example.com/path'],
  ] as const) {
    test(`${type} 类型的输入框不出现圆点（#652）`, () => {
      registry.ensure('input-dot', true);
      const el = input(type, value);
      el.focus();
      expect(shown()).toBe(false);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(shown()).toBe(false);
      dot()!.click();
      expect(translate).not.toHaveBeenCalled();
    });
  }

  test('在密码框里打字也不出现', () => {
    registry.ensure('input-dot', true);
    const pw = input('password', '');
    pw.focus();
    pw.value = 'secret';
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shown()).toBe(false);
    dot()!.click();
    expect(translate).not.toHaveBeenCalled();
  });
});

describe('只读的框不出现圆点（#653）', () => {
  test('只读的多行框获得焦点、框里有字 → 不出现，点击不触发翻译', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('写不进去的框');
    ta.readOnly = true;
    ta.focus();
    expect(shown()).toBe(false);
    dot()!.click();
    expect(translate).not.toHaveBeenCalled();
  });

  test('只读的单行框获得焦点、框里有字 → 不出现', () => {
    registry.ensure('input-dot', true);
    const el = document.createElement('input');
    el.value = '写不进去的框';
    el.readOnly = true;
    document.body.appendChild(el);
    el.focus();
    expect(shown()).toBe(false);
  });
});

describe('进行中状态长在圆点上（#648）', () => {
  function deferredTranslate() {
    const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    translate.mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    return pending;
  }

  const busy = (): boolean => dot()!.dataset.state === 'busy';

  test('点下去即刻进入进行中，结束后回到常态', async () => {
    const pending = deferredTranslate();
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    expect(busy()).toBe(false);
    dot()!.click();
    expect(busy()).toBe(true);
    expect(dot()!.getAttribute('aria-busy')).toBe('true');
    pending[0]!.resolve();
    await vi.waitFor(() => expect(busy()).toBe(false));
    expect(dot()!.getAttribute('aria-busy')).toBeNull();
  });

  test('失败后同样回到常态', async () => {
    const pending = deferredTranslate();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    pending[0]!.reject(new Error('boom'));
    await vi.waitFor(() => expect(busy()).toBe(false));
    err.mockRestore();
  });

  test('翻译回调里写回触发的 input 不会让圆点卡在进行中', async () => {
    translate.mockImplementation(async (el: HTMLTextAreaElement) => {
      await Promise.resolve();
      type(el, '【译】你好世界');
    });
    registry.ensure('input-dot', true);
    const ta = textarea('你好世界');
    ta.focus();
    dot()!.click();
    await vi.waitFor(() => expect(ta.value).toBe('【译】你好世界'));
    await vi.waitFor(() => expect(busy()).toBe(false));
    expect(shown()).toBe(true);
  });

  test('状态跟着输入框走：焦点换到另一个框显示常态，回来仍是进行中', () => {
    deferredTranslate();
    registry.ensure('input-dot', true);
    const a = textarea('你好世界');
    const b = textarea('早上好');
    a.focus();
    dot()!.click();
    expect(busy()).toBe(true);
    b.focus();
    expect(busy()).toBe(false);
    a.focus();
    expect(busy()).toBe(true);
  });
});

describe('contenteditable 富文本框（#655）', () => {
  function rich(html: string): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }

  test('编辑宿主获得焦点且有 2 个字符 → 圆点出现，点击交给翻译回调', () => {
    registry.ensure('input-dot', true);
    const host = rich('你好');
    host.focus();
    expect(shown()).toBe(true);
    dot()!.click();
    expect(translate).toHaveBeenLastCalledWith(host);
  });

  test('空的、只有 1 个字符时不出现；打到第 2 个字符才出现', () => {
    registry.ensure('input-dot', true);
    const host = rich('');
    host.focus();
    expect(shown()).toBe(false);
    host.textContent = 'a';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shown()).toBe(false);
    host.innerHTML = '<p>a</p><p>b</p>';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(shown()).toBe(true);
  });

  test('非编辑态的普通元素获得焦点不出现', () => {
    registry.ensure('input-dot', true);
    const div = document.createElement('div');
    div.tabIndex = 0;
    div.textContent = 'Static text block';
    document.body.appendChild(div);
    div.focus();
    expect(shown()).toBe(false);
  });

  test('可编辑区里的 contenteditable=false 子块获得焦点不出现', () => {
    registry.ensure('input-dot', true);
    const host = rich('hello <span contenteditable="false" tabindex="0">@alice</span>');
    host.focus();
    expect(shown()).toBe(true);
    (host.querySelector('span') as HTMLElement).focus();
    expect(shown()).toBe(false);
  });

  test('受控编辑器自己改 DOM、没有 input 事件：文字够了照样浮出，删空了消失（#656）', async () => {
    registry.ensure('input-dot', true);
    const host = rich('');
    host.focus();
    expect(shown()).toBe(false);
    host.textContent = '你好';
    await Promise.resolve();
    expect(shown()).toBe(true);
    host.textContent = '';
    await Promise.resolve();
    expect(shown()).toBe(false);
  });

  test('焦点离开后编辑宿主里的变化不再让圆点出现（#656）', async () => {
    registry.ensure('input-dot', true);
    const host = rich('');
    host.focus();
    host.blur();
    host.textContent = '你好';
    await Promise.resolve();
    expect(shown()).toBe(false);
  });

  test('量不出文字末尾（jsdom 没有行盒）→ 位置回落到框内侧右下角（ADR-0006；#671 起贴末尾，真值见 TC-E2E-141）', () => {
    registry.ensure('input-dot', true);
    const host = rich('hello');
    mockBoundingRect(host, { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 });
    host.focus();
    const left = parseFloat(dot()!.style.left);
    const top = parseFloat(dot()!.style.top);
    expect(left).toBeGreaterThan(400 - 40);
    expect(left).toBeLessThan(400);
    expect(top).toBeGreaterThan(150 - 40);
    expect(top).toBeLessThan(150);
  });
});

describe('打字期间不重算位置，停手后对齐一次（#670）', () => {
  const RECT_A = { left: 100, top: 50, right: 400, bottom: 150, width: 300, height: 100 };
  const RECT_B = { left: 100, top: 250, right: 400, bottom: 350, width: 300, height: 100 };
  const top = (): number => parseFloat(dot()!.style.top);

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('延迟与逐段翻译按钮的悬停意图同一个常量：140ms', () => {
    expect(SHOW_DELAY).toBe(140);
  });

  test('连续打字期间位置不动；停手满 140ms 才对齐到新位置', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('你好');
    mockBoundingRect(ta, RECT_A);
    ta.focus();
    const before = top();
    expect(before).toBeLessThan(150);

    // 打字期间框挪到了别处：圆点不跟（不做测量）
    mockBoundingRect(ta, RECT_B);
    for (const v of ['你好世', '你好世界', '你好世界！']) {
      type(ta, v);
      vi.advanceTimersByTime(SHOW_DELAY - 1);
      expect(top()).toBe(before);
    }
    // 停手：差 1ms 不动，满 140ms 对齐一次
    vi.advanceTimersByTime(1);
    expect(top()).toBeGreaterThan(250);
    expect(top()).toBeLessThan(350);
  });

  test('打字时第一次浮出就有位置（回落位置），不必等停手', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('');
    mockBoundingRect(ta, RECT_B);
    ta.focus();
    type(ta, '你好');
    expect(shown()).toBe(true);
    expect(top()).toBeGreaterThan(250);
    expect(top()).toBeLessThan(350);
  });

  test('contenteditable 同一套：编辑器改 DOM 期间不动，停手满 140ms 才对齐（#671）', async () => {
    registry.ensure('input-dot', true);
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    host.textContent = '你好';
    document.body.appendChild(host);
    mockBoundingRect(host, RECT_A);
    host.focus();
    const before = top();

    // 受控编辑器自己重新渲染（没有 input 事件），框挪到了别处：圆点不跟
    mockBoundingRect(host, RECT_B);
    host.textContent = '你好世界';
    await Promise.resolve();
    vi.advanceTimersByTime(SHOW_DELAY - 1);
    expect(top()).toBe(before);
    vi.advanceTimersByTime(1);
    expect(top()).toBeGreaterThan(250);
  });

  test('停手前失焦：不再对齐，也不报错', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('你好');
    mockBoundingRect(ta, RECT_A);
    ta.focus();
    type(ta, '你好世界');
    ta.blur();
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(shown()).toBe(false);
  });

  test('聚焦时即刻对齐，不等延迟', () => {
    registry.ensure('input-dot', true);
    const ta = textarea('你好');
    mockBoundingRect(ta, RECT_B);
    ta.focus();
    expect(top()).toBeGreaterThan(250);
  });
});
