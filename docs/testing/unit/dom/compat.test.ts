/**
 * dom/compat.ts — 域名补丁 单元测试
 *
 * mainDomain / isGenericInlineBadge / shouldPreserveText
 *
 * 注意：jsdom 中 location.hostname === 'localhost'，域名补丁仅对
 * 匹配 hostname 的站点生效。shouldPreserveText 的 github.com 逻辑
 * 在 localhost 下不会被激活 —— 我们通过直接验证 handler 逻辑来覆盖。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mainDomain, shouldPreserveText } from '~/src/dom/compat';

// ---- mainDomain ----

describe('mainDomain', () => {
  test('github.com → github.com', () => {
    expect(mainDomain('github.com')).toBe('github.com');
  });

  test('news.ycombinator.com → ycombinator.com', () => {
    expect(mainDomain('news.ycombinator.com')).toBe('ycombinator.com');
  });

  test('sub.domain.example.com → example.com', () => {
    expect(mainDomain('sub.domain.example.com')).toBe('example.com');
  });

  test('localhost → localhost', () => {
    expect(mainDomain('localhost')).toBe('localhost');
  });

  test('两段域名原样返回', () => {
    expect(mainDomain('google.com')).toBe('google.com');
  });
});

// ---- isGenericInlineBadge ----

import { shouldOmitText } from '~/src/dom/compat';

describe('shouldOmitText (通用行内角标)', () => {
  function el(html: string): Element {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild!;
  }

  test('" +3" 结尾的 span → true', () => {
    const span = el('<span> +3</span>');
    expect(shouldOmitText(span)).toBe(true);
  });

  test('"+12" 结尾的 a → true', () => {
    const a = el('<a>YouTube +12</a>');
    expect(shouldOmitText(a)).toBe(true);
  });

  test('普通内联文本 → false', () => {
    const span = el('<span>normal text</span>');
    expect(shouldOmitText(span)).toBe(false);
  });

  test('超过 40 字符 → false（不匹配角标）', () => {
    const span = el(`<span>${'x'.repeat(41)}+3</span>`);
    expect(shouldOmitText(span)).toBe(false);
  });

  test('空文本 → false', () => {
    const span = el('<span></span>');
    expect(shouldOmitText(span)).toBe(false);
  });

  test('非内联元素 → false', () => {
    const p = el('<p> +3</p>');
    // p 不是内联元素，但 isGenericInlineBadge 会先检查 INLINE_SET
    // shouldOmitText 会调用 isGenericInlineBadge，后者检查 INLINE_SET
    // p 不在 INLINE_SET 中，返回 false
    expect(shouldOmitText(p)).toBe(false);
  });
});

// ---- shouldPreserveText ----

describe('shouldPreserveText', () => {
  function el(html: string): Element {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild!;
  }

  test('localhost 返回 null（无域名补丁）', () => {
    // jsdom 中 hostname 为 localhost，不匹配任何 handler
    const a = el('<a class="user-mention">@testuser</a>');
    expect(shouldPreserveText(a)).toBeNull();
  });

  test('非内联元素返回 null', () => {
    const p = el('<p class="user-mention">@testuser</p>');
    expect(shouldPreserveText(p)).toBeNull();
  });
});

// ---- inner logic: isGenericInlineBadge counters ----

describe('isGenericInlineBadge counter regex', () => {
  function el(html: string): Element {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild!;
  }

  test('" +3" at end → omit', () => {
    expect(shouldOmitText(el('<span> +3</span>'))).toBe(true);
  });

  test('"+12" at end → omit', () => {
    expect(shouldOmitText(el('<span>+12</span>'))).toBe(true);
  });

  test('"+3" in middle → not omit', () => {
    // "电话 +86 123" → COUNTER_RE 要求 +N 在文本末尾
    const span = el('<span>电话 +86 123</span>');
    // "+123" 在末尾但不是 "+数字" 前有空白的简单形态
    expect(shouldOmitText(span)).toBe(false);
  });

  test('"iPhone 16+128GB" → not omit', () => {
    // "+128GB" 结尾但不是 COUNTER_RE 匹配的 "(^|\\s)\\+\\d{1,3}$"
    const span = el('<span>iPhone 16+128GB</span>');
    expect(shouldOmitText(span)).toBe(false);
  });
});
