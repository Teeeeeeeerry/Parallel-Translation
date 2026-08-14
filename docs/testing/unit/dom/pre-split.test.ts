/**
 * dom/pre-split.ts — pre 切分 单元测试
 *
 * #65：超长纯文本 pre 按空行切块，#66：代码块 pre 跳过
 */
import { describe, test, expect } from 'vitest';
import { splitPre, unsplitPre } from '~/src/dom/pre-split';

function createPre(text: string, className = ''): HTMLPreElement {
  const pre = document.createElement('pre');
  if (className) pre.className = className;
  pre.textContent = text;
  return pre;
}

describe('splitPre', () => {
  test('短 pre（< MAX_TEXT）→ 返回 null，不修改 DOM', () => {
    const pre = createPre('Short text');
    const result = splitPre(pre);
    expect(result).toBeNull();
    expect(pre.textContent).toBe('Short text');
  });

  test('代码块 pre（在 .highlight 内）→ 返回 null', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'highlight';
    const pre = createPre('function hello() { return 1; }');
    wrapper.appendChild(pre);
    document.body.appendChild(wrapper);

    const result = splitPre(pre);
    expect(result).toBeNull();
  });

  test('含子元素的 pre → 返回 null', () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'some code';
    pre.appendChild(code);

    const result = splitPre(pre);
    expect(result).toBeNull();
  });

  test('含 code 子元素的超长 pre → 返回 null（代码块结构拒切）', () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'function f() { return 1; }\n'.repeat(100);
    pre.appendChild(code);

    const result = splitPre(pre);
    expect(result).toBeNull();
    expect(pre.hasAttribute('data-pt-split')).toBe(false);
  });

  test('含内联 <a> 的超长 pre → 切分，链接保留在 chunk 内', () => {
    // GitHub 对 RST README 的 .plain > pre 渲染：纯文本 + autolink <a>。
    // 两个大段各 ~2300 字符（单段不超 MAX_TEXT，全文超 3072 触发切分）。
    const para = 'The Linux kernel is the core of any Linux operating system. '.repeat(40);
    const text = [
      'Linux kernel',
      '============',
      '',
      `${para}`,
      '',
      `${para}`,
      '',
      'Quick Start',
      '-----------',
      '',
      '* Get the latest kernel: https://kernel.org',
      '* Join the community: https://lore.kernel.org/',
    ].join('\n');

    const pre = document.createElement('pre');
    pre.innerHTML = text
      .replace(
        'https://kernel.org',
        '<a href="https://kernel.org" rel="nofollow">https://kernel.org</a>',
      )
      .replace(
        'https://lore.kernel.org/',
        '<a href="https://lore.kernel.org/" rel="nofollow">https://lore.kernel.org/</a>',
      );

    const originalText = pre.textContent ?? '';

    const result = splitPre(pre);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBeGreaterThanOrEqual(3);
      // 链接必须保留在切出的 chunk 里
      const anchors = pre.querySelectorAll('a');
      expect(anchors.length).toBe(2);
      expect([...anchors].map((a) => a.getAttribute('href'))).toEqual([
        'https://kernel.org',
        'https://lore.kernel.org/',
      ]);
      for (const a of anchors) {
        expect(a.closest('span.pt-chunk')).not.toBeNull();
      }
      // 切分后文本逐字节不变
      expect(pre.textContent).toBe(originalText);
    }
  });

  test('列表条目行各自独立成翻译单元（行级对照）', () => {
    // 5 行列表条目 + 超长段落（保证全文超 MAX_TEXT 触发切分）
    const para = 'Paragraph content. '.repeat(170);
    const text = [
      '* New Kernel Developer - Getting started with kernel development',
      '* Academic Researcher - Studying kernel internals and architecture',
      '* Security Expert - Hardening and vulnerability analysis',
      '* Backport/Maintenance Engineer - Maintaining stable kernels',
      '* System Administrator - Configuring and troubleshooting',
      '',
      `${para}`,
    ].join('\n');

    const pre = createPre(text);
    const result = splitPre(pre);

    expect(result).not.toBeNull();
    if (result) {
      // 每个列表条目是独立 chunk（原文以 '* ' 开头）
      const listSpans = result.filter((s) =>
        (s.textContent ?? '').trimStart().startsWith('* '),
      );
      expect(listSpans.length).toBe(5);
      // 条目 chunk 各自只含单行文本
      for (const span of listSpans) {
        expect((span.textContent ?? '').trim()).not.toContain('\n');
      }
      // 切分后文本逐字节不变
      expect(pre.textContent).toBe(text);
    }
  });

  test('已切分的 pre → 返回 null（幂等）', () => {
    const longText = 'a'.repeat(3100);
    const pre = createPre(longText);
    pre.setAttribute('data-pt-split', '1');

    const result = splitPre(pre);
    expect(result).toBeNull();
  });

  test('在 data-pt="done" 内的 pre → 返回 null', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-pt', 'done');
    const longText = 'a'.repeat(3100);
    const pre = createPre(longText);
    wrapper.appendChild(pre);
    document.body.appendChild(wrapper);

    const result = splitPre(pre);
    expect(result).toBeNull();
  });

  test('超长纯文本 pre → 按空行切分为 .pt-chunk span', () => {
    // 构造超长文本，用空行分隔
    const chunk1 = 'First paragraph content. '.repeat(50); // ~1400 chars
    const chunk2 = 'Second paragraph content. '.repeat(50);
    const longText = `${chunk1}\n\n${chunk2}`;

    const pre = createPre(longText);
    // 需要超过 MAX_TEXT (3072)
    // chunk1 + chunk2 各约 1400，共 2800，不够 3072
    // 我们需要 3 个 chunk
    const bigText = `${chunk1}\n\n${chunk2}\n\n${chunk1}`;
    const pre2 = createPre(bigText);
    const result = splitPre(pre2);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBeGreaterThanOrEqual(2);
      // 验证都是 span.pt-chunk
      for (const span of result) {
        expect(span.tagName).toBe('SPAN');
        expect(span.className).toBe('pt-chunk');
        expect(span.getAttribute('data-pt-chunk')).toBe('1');
      }
      expect(pre2.hasAttribute('data-pt-split')).toBe(true);
    }
  });

  test('装饰行（==== -----）不成为 chunk，保留为裸文本', () => {
    const chunk1 = 'Real content line. '.repeat(100); // ~2000 chars
    // 总文本要超过 MAX_TEXT (3072)，2×2000 = 4000 > 3072
    const text = [chunk1, '========', '', '--------', '', chunk1].join('\n');
    const pre = createPre(text);
    const result = splitPre(pre);

    expect(result).not.toBeNull();
    if (result) {
      // 只有 2 个 chunk（两个 chunk1 块），装饰行不被包装为 chunk
      expect(result.length).toBe(2);
      // 重建文本应包含所有原始内容
      const rebuilt = pre.textContent ?? '';
      expect(rebuilt).toContain('Real content line');
      expect(rebuilt).toContain('========');
      expect(rebuilt).toContain('--------');
    }
  });

  test('切分后 pre 文本逐字节不变', () => {
    const chunk1 = 'Paragraph A. '.repeat(60);
    const chunk2 = 'Paragraph B. '.repeat(60);
    const original = `${chunk1}\n\n${chunk2}`;

    const pre = createPre(original);
    splitPre(pre);

    // 拼接所有子节点 textContent
    let rebuilt = '';
    for (const child of pre.childNodes) {
      rebuilt += child.textContent ?? '';
    }
    expect(rebuilt).toBe(original);
  });

  test('返回的 span 数组长度 = 可翻译块数', () => {
    const chunk = 'Paragraph content. '.repeat(60);
    const text = `${chunk}\n\n${chunk}\n\n${chunk}`;
    const pre = createPre(text);
    const result = splitPre(pre);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.length).toBe(3);
    }
  });
});

describe('unsplitPre', () => {
  test('把 .pt-chunk 文本放回 pre 并移除 span', () => {
    const original = 'Line 1\nLine 2\n\nLine 3';
    const pre = createPre(original);

    // 模拟切分后的状态
    pre.textContent = '';
    const span1 = document.createElement('span');
    span1.className = 'pt-chunk';
    span1.setAttribute('data-pt-chunk', '1');
    span1.textContent = 'Line 1\nLine 2';
    pre.appendChild(span1);

    pre.appendChild(document.createTextNode('\n\n'));

    const span2 = document.createElement('span');
    span2.className = 'pt-chunk';
    span2.setAttribute('data-pt-chunk', '1');
    span2.textContent = 'Line 3';
    pre.appendChild(span2);

    pre.setAttribute('data-pt-split', '1');

    unsplitPre(pre);

    expect(pre.textContent).toBe(original);
    expect(pre.querySelectorAll('.pt-chunk').length).toBe(0);
    expect(pre.hasAttribute('data-pt-split')).toBe(false);
  });

  test('移除 data-pt-split 属性', () => {
    const pre = createPre('text');
    pre.setAttribute('data-pt-split', '1');
    unsplitPre(pre);
    expect(pre.hasAttribute('data-pt-split')).toBe(false);
  });

  test('无 chunk 的 pre → 无操作', () => {
    const pre = createPre('plain text');
    const htmlBefore = pre.innerHTML;
    unsplitPre(pre);
    expect(pre.innerHTML).toBe(htmlBefore);
  });
});
