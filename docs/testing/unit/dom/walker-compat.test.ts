/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/anthropics/claude-code"}
 */
/**
 * dom/walker.ts — github.com 真实排除规则在采集器里的优先级（#114）
 *
 * 与 walker.test.ts 分离：后者 mock 掉 applyCompat 只测 walker 对
 * 补丁结果的消费；本文件用真实 github.com 规则验证“排除优先于
 * 通用判定”的端到端形态 —— .BorderGrid 内本可成单元的元素被跳过，
 * 而普通正文照常采集。
 *
 * #367：github.com 的 skip 补丁已从 compat.ts 迁为内置排除数据，
 * 断言不变，迁移前后照常通过。
 */
import { describe, test, expect } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';

describe('collect × 内置排除（github.com 真实规则）', () => {
  test('.BorderGrid 内元素被排除优先拦截', () => {
    const restore = mockAllBoundingRects();
    try {
      document.body.innerHTML =
        '<div class="BorderGrid"><p id="panel">Contributors</p></div>' +
        '<p id="body">Claude Code is an agentic coding tool.</p>';
      const units = collect();
      // panel 文本完整且可见，通用判定本会采集；排除优先，只剩正文
      expect(units.map((u) => u.id)).toEqual(['body']);
    } finally {
      restore();
    }
  });

  test('blob 代码行内元素同样被排除（PRE 入口之前生效）', () => {
    const restore = mockAllBoundingRects();
    try {
      document.body.innerHTML =
        '<div class="blob-code"><pre id="code">const x = 1;</pre></div>' +
        '<p id="body">README text.</p>';
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['body']);
    } finally {
      restore();
    }
  });
});
