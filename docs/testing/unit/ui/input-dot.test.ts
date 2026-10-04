/**
 * 输入翻译圆点 —— 出现、消失与启停（#636）
 *
 * 经生命周期注册表启停（与悬浮球、逐段按钮同一条路）：开关关掉即刻
 * 解绑监听，打开即刻生效，启停幂等。本票圆点只用 ADR-0006 定的回落
 * 位置（框内侧右下角），点下去还不做任何事。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createLifecycleRegistry, type LifecycleRegistry } from '~/src/ui/lifecycle-registry';
import { createInputDot } from '~/src/ui/input-dot';
import { mockBoundingRect } from '~/docs/testing/setup';

let registry: LifecycleRegistry;

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
  registry.register('input-dot', {
    create: () => createInputDot(),
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
