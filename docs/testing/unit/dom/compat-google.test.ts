/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://www.google.com/search?q=test"}
 */
/**
 * dom/compat.ts — google.com OMIT_HANDLERS 精修补丁测试（#114）
 *
 * 覆盖此前零测试的 OMIT_HANDLERS 分支：AI 概览来源角标类名
 * （span.wJwe6c / .WTfRgd）。jsdom 的 location.hostname 是文件级
 * 选项，与 localhost 的 compat.test.ts 分离。
 */
import { describe, test, expect } from 'vitest';
import { shouldOmitText } from '~/src/dom/compat';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

describe('shouldOmitText（google.com）', () => {
  test('span.wJwe6c（AI 概览来源角标）→ true', () => {
    const badge = el('<span class="wJwe6c">OpenAI</span>');
    expect(shouldOmitText(badge)).toBe(true);
  });

  test('.WTfRgd → true', () => {
    const badge = el('<span class="WTfRgd">Meta</span>');
    expect(shouldOmitText(badge)).toBe(true);
  });

  test('普通正文 span → false', () => {
    const span = el('<span>plain result text</span>');
    expect(shouldOmitText(span)).toBe(false);
  });

  test('favicon 尺寸 img 的链接 → true（通用行内角标层）', () => {
    const a = el('<a href="#"><img width="16" height="16" alt="">YouTube</a>');
    expect(shouldOmitText(a)).toBe(true);
  });

  test('大尺寸 img 的链接 → false（非角标）', () => {
    const a = el('<a href="#"><img width="48" height="48" alt="">YouTube</a>');
    expect(shouldOmitText(a)).toBe(false);
  });
});
