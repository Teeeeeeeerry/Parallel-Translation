/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * dom/compat.ts — github.com 域名补丁测试（#93 回归）
 *
 * 与 compat.test.ts 分离的原因：jsdom 的 location.hostname 默认是
 * localhost，域名补丁不激活。本文件用文件顶部的
 * @vitest-environment-options 把 jsdom 的 url 设为 github.com 页面，
 * 使 applyCompat 走 github.com 处理器 —— 这是文件级选项，
 * 不能与依赖 localhost 的用例同文件。
 *
 * #93：github.com 处理器第二段 el.closest() 的选择器拼接每行都带
 * 尾随逗号（'.repository-lang-stats,'），是无效 CSS 选择器，closest()
 * 抛 SyntaxError。walker 的 try-catch 逐元素静默吞掉后，GitHub 页面
 * 整页采集 0 个翻译单元 —— 翻译静默失败（[data-pt="done"] 永不出现）。
 */
import { describe, test, expect } from 'vitest';
import { applyCompat, shouldPreserveText } from '~/src/dom/compat';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

describe('applyCompat（github.com，#93 回归）', () => {
  test('普通正文元素不抛异常并返回 null（交回通用逻辑）', () => {
    // README 正文段落 —— 修复前此处抛 SyntaxError（无效选择器）
    const p = el('<p>Claude Code is an agentic coding tool.</p>');
    expect(() => applyCompat(p)).not.toThrow();
    expect(applyCompat(p)).toBeNull();
  });

  test('.BorderGrid 内元素 → skip（贡献者面板）', () => {
    const inner = el('<div class="BorderGrid"><p>Contributors</p></div>')
      .querySelector('p')!;
    expect(applyCompat(inner)).toEqual({ skip: true });
  });

  test('.repository-lang-stats 内元素 → skip（语言统计条）', () => {
    const inner = el('<div class="repository-lang-stats"><span>Python 79.7%</span></div>')
      .querySelector('span')!;
    expect(applyCompat(inner)).toEqual({ skip: true });
  });

  test('.file-tree 内元素 → skip（blob 页文件树）', () => {
    const inner = el('<div class="file-tree"><span>src</span></div>')
      .querySelector('span')!;
    expect(applyCompat(inner)).toEqual({ skip: true });
  });

  test('.blob-code 内元素 → skip（代码行）', () => {
    // td 必须放在 table 上下文里 —— jsdom 会按 HTML 规范丢弃 div 中的 td
    const table = document.createElement('table');
    table.innerHTML = '<tr><td class="blob-code"><span>const x = 1;</span></td></tr>';
    const inner = table.querySelector('span')!;
    expect(applyCompat(inner)).toEqual({ skip: true });
  });

  test('含行内 code 的正文元素仍返回 null', () => {
    const p = el('<p>Run <code>pnpm build</code> first.</p>');
    expect(() => applyCompat(p)).not.toThrow();
    expect(applyCompat(p)).toBeNull();
  });
});

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
