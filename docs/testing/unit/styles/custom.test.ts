/**
 * styles/custom.ts — 自定义 CSS 校验与注入 单元测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { validateCustomCss, applyCustomCss } from '~/src/styles/custom';

describe('validateCustomCss', () => {
  test('合法声明块 → ok', () => {
    const result = validateCustomCss('color: #555; font-size: 14px');
    expect(result.ok).toBe(true);
  });

  test('空字符串 → ok', () => {
    expect(validateCustomCss('').ok).toBe(true);
  });

  test('含花括号 → 拒绝', () => {
    const result = validateCustomCss('.pt-trans { color: red; }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('花括号');
  });

  test('含 @import → 拒绝', () => {
    const result = validateCustomCss('@import url("evil.css");');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('@import');
  });

  test('含 <style> → 拒绝', () => {
    // style 标签内容同时含 <> 和 {}，先命中最前面的禁止项（花括号）
    const result = validateCustomCss('<style>body { color: red; }</style>');
    expect(result.ok).toBe(false);
    // 花括号检查先于 style 标签检查
    if (!result.ok) expect(result.msg).toContain('花括号');
  });

  test('含 url() → 拒绝（#168）', () => {
    const result = validateCustomCss('background: url("https://track.example/x.gif")');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('url()');
  });

  test('含反斜杠 → 拒绝（#168）', () => {
    const result = validateCustomCss('color: red\\; } .evil {');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('花括号');
  });

  test('含 javascript: → 拒绝', () => {
    const result = validateCustomCss('color: javascript:alert(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('javascript:');
  });

  test('含 expression() → 拒绝', () => {
    const result = validateCustomCss('width: expression(alert(1))');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.msg).toContain('expression()');
  });
});

describe('applyCustomCss', () => {
  beforeEach(() => {
    // 清理之前注入的 style
    const existing = document.getElementById('pt-custom-style');
    if (existing) existing.remove();
  });

  test('合法输入 → 注入 <style> 到 <head>，选择器为 .pt-trans.pt-trans（#168 特异性）', () => {
    applyCustomCss('color: #555');

    const styleEl = document.getElementById('pt-custom-style');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.tagName).toBe('STYLE');
    // #168: 双类选择器（0,2,0）与预设 .pt-style-fade .pt-trans 同级，
    // 自定义 opacity 等属性才能覆盖预设
    expect(styleEl!.textContent).toContain('.pt-trans.pt-trans');
    expect(styleEl!.textContent).toContain('color: #555');
  });

  test('非法输入 → 不注入，且保留已有旧样式（#168）', () => {
    applyCustomCss('color: red');
    const old = document.getElementById('pt-custom-style');
    expect(old).not.toBeNull();

    applyCustomCss('@import url("evil.css");');
    // 旧样式未被清掉（修复前先删后校验，用户样式被无声清除）
    const still = document.getElementById('pt-custom-style');
    expect(still).not.toBeNull();
    expect(still!.textContent).toContain('color: red');
  });

  test('非法输入 → 不注入', () => {
    applyCustomCss('@import url("evil.css");');

    const styleEl = document.getElementById('pt-custom-style');
    expect(styleEl).toBeNull();
  });

  test('再次调用 → 先移除旧 <style> 再注入新的', () => {
    applyCustomCss('color: red');
    applyCustomCss('color: blue');

    // 只有一个 style 元素
    const styles = document.querySelectorAll('#pt-custom-style');
    expect(styles.length).toBe(1);
    expect(styles[0]!.textContent).toContain('color: blue');
  });

  test('注入的 style 标记 data-pt-ui="1" → walker 跳过', () => {
    applyCustomCss('color: #555');

    const styleEl = document.getElementById('pt-custom-style')!;
    expect(styleEl.getAttribute('data-pt-ui')).toBe('1');
  });

  test('空字符串输入 → 移除旧 style 但不注入新', () => {
    applyCustomCss('color: red');
    applyCustomCss('');

    const styleEl = document.getElementById('pt-custom-style');
    expect(styleEl).toBeNull();
  });
});
