/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * dom/compat.ts — github.com 域名补丁测试
 *
 * 与 compat.test.ts 分离的原因：jsdom 的 location.hostname 默认是
 * localhost，域名补丁不激活。本文件用文件顶部的
 * @vitest-environment-options 把 jsdom 的 url 设为 github.com 页面，
 * 使补丁走 github.com 处理器 —— 这是文件级选项，
 * 不能与依赖 localhost 的用例同文件。
 *
 * #367：github.com 的 skip 补丁已迁为内置排除数据，applyCompat 的
 * 用例（含 #93 回归）改在采集入口验证，见 site-rules-github.test.ts。
 */
import { describe, test, expect } from 'vitest';
import { shouldPreserveText } from '~/src/dom/compat';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

// ---- shouldPreserveText（github.com，#114 补覆盖） ----

describe('shouldPreserveText（github.com）', () => {
  test('a.user-mention（评论 @mention）→ 保留用户名', () => {
    const a = el('<a class="user-mention">@torvalds</a>');
    expect(shouldPreserveText(a)).toBe('@torvalds');
  });

  test('[data-hovercard-url^="/users/"] → 保留用户名', () => {
    const a = el('<a data-hovercard-url="/users/torvalds">torvalds</a>');
    expect(shouldPreserveText(a)).toBe('torvalds');
  });

  test('[rel="author"] → 保留作者名', () => {
    const a = el('<a rel="author">Linus Torvalds</a>');
    expect(shouldPreserveText(a)).toBe('Linus Torvalds');
  });

  test('[itemprop="author"] → 保留作者名', () => {
    const a = el('<a itemprop="author">octocat</a>');
    expect(shouldPreserveText(a)).toBe('octocat');
  });

  test('普通链接 → null（不保留）', () => {
    const a = el('<a href="https://github.com/foo/bar">foo/bar</a>');
    expect(shouldPreserveText(a)).toBeNull();
  });

  test('空文本链接 → null', () => {
    const a = el('<a class="user-mention">  </a>');
    expect(shouldPreserveText(a)).toBeNull();
  });
});
