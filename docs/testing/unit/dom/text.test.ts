/**
 * dom/text.ts — 文本提取与占位符 单元测试
 *
 * 覆盖 translatableTextEx、shallowTranslatableTextEx、
 * restorePreserves、hasBlockTextChildren
 */
import { describe, test, expect } from 'vitest';

// text.ts 依赖 compat.ts（shouldPreserveText / shouldOmitText）和 classify.ts（INLINE_SET）
// compat.ts 依赖 location.hostname —— 在 jsdom 中默认为 'localhost'，不会匹配任何域名补丁
// 因此 preserve 行为只在 github.com 下激活，这些用例单独处理

import {
  translatableTextEx,
  shallowTranslatableTextEx,
  restorePreserves,
  translatableText,
  shallowTranslatableText,
  hasBlockTextChildren,
} from '~/src/dom/text';

// ---- 辅助：创建 DOM 片段 ----

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

// ---- translatableTextEx ----

describe('translatableTextEx', () => {
  test('纯文本元素 → 返回 textContent，preserves 为空 Map', () => {
    const p = el('<p>Hello World</p>');
    const result = translatableTextEx(p);
    expect(result.text).toBe('Hello World');
    expect(result.preserves.size).toBe(0);
  });

  test('.notranslate 子树被跳过', () => {
    const p = el('<p>Before <span class="notranslate">skip me</span> After</p>');
    const result = translatableTextEx(p);
    expect(result.text).toContain('Before');
    expect(result.text).toContain('After');
    expect(result.text).not.toContain('skip me');
  });

  test('shouldOmitText 命中的元素被跳过（通用角标检测）', () => {
    // "+3" 结尾的内联元素命中 isGenericInlineBadge
    const p = el('<p>Text <span> +3</span> more</p>');
    const result = translatableTextEx(p);
    expect(result.text).toContain('Text');
    expect(result.text).toContain('more');
  });

  // #58 占位符 —— 需要 location.hostname === 'github.com'
  // 在 jsdom 中 hostname 为 'localhost'，故 shouldPreserveText 始终返回 null。
  // 占位符机制的“端到端”行为在 compat.test.ts 中验证；
  // 此处验证 translatableTextEx 本身的结构逻辑。

  test('translatableTextEx 结构：preserves Map 由 shouldPreserveText 决定', () => {
    const p = el('<p><span>normal text</span></p>');
    const result = translatableTextEx(p);
    // localhost 上没有 preserve handler
    expect(result.preserves.size).toBe(0);
    expect(result.text).toContain('normal text');
  });

  test('元素间自动补空格', () => {
    const p = el('<p><b>Hello</b><span>World</span></p>');
    const result = translatableTextEx(p);
    // 应包含空白分隔
    expect(result.text.trim()).toMatch(/Hello\s+World/);
  });

  test('textContent 等价于 translatableText（无跳过规则时）', () => {
    const p = el('<p>Simple paragraph text</p>');
    expect(translatableText(p)).toBe('Simple paragraph text');
  });

  test('notranslate 内嵌套结构整体跳过', () => {
    const p = el('<p>Keep <span class="notranslate"><b>skip</b> all</span> end</p>');
    const result = translatableTextEx(p);
    expect(result.text).not.toContain('skip');
    expect(result.text).not.toContain('all');
    expect(result.text).toContain('Keep');
    expect(result.text).toContain('end');
  });
});

// ---- shallowTranslatableTextEx ----

describe('shallowTranslatableTextEx', () => {
  test('只提取直接文本 + 内联子元素，块级子元素被跳过', () => {
    const li = el('<li>标签文字 <ul><li>子条目</li></ul></li>');
    const result = shallowTranslatableText(li);
    expect(result).toContain('标签文字');
    expect(result).not.toContain('子条目');
  });

  test('<li>标签文字<ul><li>子条目</li></ul></li> → 只提取"标签文字"', () => {
    const li = el('<li>Label text<ul><li>Sub item</li></ul></li>');
    expect(shallowTranslatableText(li).trim()).toBe('Label text');
  });

  test('内联子元素的 preserve 仍生效（localhost 无 preserve handler）', () => {
    const li = el('<li>Text <span>inline</span> more</li>');
    const result = shallowTranslatableTextEx(li);
    expect(result.preserves.size).toBe(0);
    expect(result.text).toContain('Text');
  });

  test('纯文本无块级子元素 → 与 translatableText 结果一致', () => {
    const p = el('<p>Simple text</p>');
    const shallow = shallowTranslatableText(p);
    const deep = translatableText(p);
    // 无块级子元素时两者应一致
    expect(shallow).toBe(deep);
  });

  test('块级子元素被跳过但内联子元素保留', () => {
    const div = el('<div>Direct <b>bold</b><p>Block child</p></div>');
    const result = shallowTranslatableText(div);
    expect(result).toContain('Direct');
    expect(result).toContain('bold');
    expect(result).not.toContain('Block child');
  });
});

// ---- restorePreserves ----

describe('restorePreserves', () => {
  function makePreserves(...items: [string, string][]): Map<string, string> {
    const m = new Map<string, string>();
    for (const [ph, orig] of items) m.set(ph, orig);
    return m;
  }

  test('空 preserves → 返回原译文', () => {
    const result = restorePreserves(
      '译好的文本',
      new Map(),
      '原文',
    );
    expect(result).toBe('译好的文本');
  });

  test('⟦PT0⟧ → 用户名 → 正确替换', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@testuser']);
    const result = restorePreserves(
      '⟦PT0⟧ 发表了一条评论',
      preserves,
      '⟦PT0⟧ commented',
    );
    expect(result).toBe('@testuser 发表了一条评论');
  });

  test('多个占位符 → 全部正确替换', () => {
    const preserves = makePreserves(
      ['⟦PT0⟧', '@alice'],
      ['⟦PT1⟧', '@bob'],
    );
    const result = restorePreserves(
      '⟦PT0⟧ 和 ⟦PT1⟧ 参与了讨论',
      preserves,
      '⟦PT0⟧ and ⟦PT1⟧ joined',
    );
    expect(result).toBe('@alice 和 @bob 参与了讨论');
  });

  test('占位符数量不匹配 → 降级返回原文', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@user']);
    const originalText = '⟦PT0⟧ commented';

    // 译文中没有占位符 → 数量不匹配
    const result = restorePreserves(
      '用户发表了一条评论', // 引擎吞掉了占位符
      preserves,
      originalText,
    );
    // 降级：从原文中还原出无占位符的原文
    expect(result).toBe('@user commented');
  });

  test('占位符序号不匹配 → 降级', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@alice'], ['⟦PT1⟧', '@bob']);
    const originalText = '⟦PT0⟧ and ⟦PT1⟧';

    // 译文把 ⟦PT0⟧ 变成了 ⟦PT1⟧
    const result = restorePreserves(
      '⟦PT1⟧ and ⟦PT0⟧', // 引擎交换了顺序
      preserves,
      originalText,
    );
    // 降级
    expect(result).toBe('@alice and @bob');
  });

  test('引擎破坏了占位符格式 → 降级', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@user']);
    const originalText = '⟦PT0⟧ says hi';

    // 译文中占位符被破坏为 PT0
    const result = restorePreserves(
      'PT0 说你好',
      preserves,
      originalText,
    );
    // 降级
    expect(result).toBe('@user says hi');
  });

  test('降级结果不含任何 ⟦PT 残留', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@test']);
    const originalText = '⟦PT0⟧ wrote';

    const result = restorePreserves(
      '⟦PT0⟧ 写了', // 正确保留 → 不应降级
      preserves,
      originalText,
    );
    expect(result).toBe('@test 写了');
    expect(result).not.toContain('⟦PT');
  });

  test('preserves 有值但原文无占位符 → 返回原译文', () => {
    const preserves = makePreserves(['⟦PT0⟧', '@user']);
    // 原文没有占位符，不应降级也不会替换
    const result = restorePreserves('Hello', preserves, 'Hello');
    expect(result).toBe('Hello');
  });
});

// ---- hasBlockTextChildren ----

describe('hasBlockTextChildren', () => {
  test('含块级子元素且有文本 → true', () => {
    const div = el('<div>Direct <p>Block child</p></div>');
    expect(hasBlockTextChildren(div)).toBe(true);
  });

  test('只有内联子元素 → false', () => {
    const p = el('<p>Text <span>inline</span> <b>bold</b></p>');
    expect(hasBlockTextChildren(p)).toBe(false);
  });

  test('块级子元素但 textContent 全空 → false', () => {
    const div = el('<div>Direct text <p></p></div>');
    // p 的 textContent 为空（trim 后）
    expect(hasBlockTextChildren(div)).toBe(false);
  });

  test('无子元素 → false', () => {
    const p = el('<p>Just text</p>');
    expect(hasBlockTextChildren(p)).toBe(false);
  });
});
