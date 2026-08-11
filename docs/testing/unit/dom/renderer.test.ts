/**
 * dom/renderer.ts — 三模式渲染器 单元测试
 *
 * render / unrender / applyMode / applyStyle
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { render, unrender, applyMode, applyStyle } from '~/src/dom/renderer';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

describe('render', () => {
  test('创建 .pt-origin + .pt-trans 子元素', () => {
    const p = el('<p>Hello World</p>');
    const result = render(p, '你好世界');
    expect(result).toBe(true);
    expect(p.querySelector(':scope > .pt-origin')).not.toBeNull();
    expect(p.querySelector(':scope > .pt-trans')).not.toBeNull();
  });

  test('原文子节点搬入 .pt-origin（while+appendChild）', () => {
    const p = el('<p>Hello <b>World</b></p>');
    const b = p.querySelector('b');
    render(p, '你好世界');
    const origin = p.querySelector(':scope > .pt-origin')!;
    expect(origin.children.length).toBeGreaterThanOrEqual(0);
    // b 被搬入 origin 内部
    expect(origin.contains(b)).toBe(true);
  });

  test('译文设到 .pt-trans.textContent', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    const trans = p.querySelector(':scope > .pt-trans')!;
    expect(trans.textContent).toBe('你好');
  });

  test('元素标记 data-pt="done"', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    expect(p.getAttribute('data-pt')).toBe('done');
  });

  test('元素标记 data-pt-src="page"（默认）', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    expect(p.getAttribute('data-pt-src')).toBe('page');
  });

  test('元素标记 data-pt-src="para"', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好', 'para');
    expect(p.getAttribute('data-pt-src')).toBe('para');
  });

  test('pre 内译文自动加 .pt-pre 类（#66）', () => {
    const pre = el('<pre>Some long text for testing</pre>');
    document.body.appendChild(pre);
    render(pre, '用于测试的长文本');
    const trans = pre.querySelector(':scope > .pt-trans')!;
    expect(trans.classList.contains('pt-pre')).toBe(true);
  });

  test('含非文本内容 → 返回 false（纵深防御）', () => {
    // img 包裹在 block 级元素中，阻断翻译
    const div = el('<div><p><img src="x.png"></p> text</div>');
    const result = render(div, '译文');
    expect(result).toBe(false);
  });

  test('已标记 done → 返回 true（幂等，不二次渲染）', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    const result = render(p, '再次渲染');
    expect(result).toBe(true);
    // 译文不变化
    expect(p.querySelector(':scope > .pt-trans')!.textContent).toBe('你好');
  });
});

describe('unrender', () => {
  test('把 .pt-origin 子节点放回元素', () => {
    const p = el('<p>Hello <b>World</b></p>');
    const childCountBefore = p.childNodes.length;
    render(p, '你好世界');
    unrender(p);

    // 还原后不应有 .pt-origin / .pt-trans
    expect(p.querySelector(':scope > .pt-origin')).toBeNull();
    expect(p.querySelector(':scope > .pt-trans')).toBeNull();
    // 原文节点应回到原位
    expect(p.textContent).toContain('Hello');
    expect(p.textContent).toContain('World');
  });

  test('移除 .pt-origin 和 .pt-trans', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    unrender(p);
    expect(p.querySelector(':scope > .pt-origin')).toBeNull();
    expect(p.querySelector(':scope > .pt-trans')).toBeNull();
  });

  test('移除 data-pt 和 data-pt-src 属性', () => {
    const p = el('<p>Hello</p>');
    render(p, '你好');
    unrender(p);
    expect(p.hasAttribute('data-pt')).toBe(false);
    expect(p.hasAttribute('data-pt-src')).toBe(false);
  });

  test('无 .pt-origin → 无操作', () => {
    const p = el('<p>Hello</p>');
    const htmlBefore = p.innerHTML;
    unrender(p);
    expect(p.innerHTML).toBe(htmlBefore);
  });
});

describe('applyMode', () => {
  beforeEach(() => {
    document.documentElement.className = '';
  });

  test('bilingual → html 上无 pt-only-trans-page 类', () => {
    applyMode('bilingual', 'follow');
    expect(document.documentElement.classList.contains('pt-only-trans-page')).toBe(false);
  });

  test('translation-only → html 上有 pt-only-trans-page 类', () => {
    applyMode('translation-only', 'follow');
    expect(document.documentElement.classList.contains('pt-only-trans-page')).toBe(true);
  });

  test('paraMode=follow → 跟随 pageMode', () => {
    applyMode('translation-only', 'follow');
    expect(document.documentElement.classList.contains('pt-only-trans-para')).toBe(true);
  });

  test('paraMode 独立值 → 独立生效', () => {
    // page=bilingual, para=translation-only
    applyMode('bilingual', 'translation-only');
    expect(document.documentElement.classList.contains('pt-only-trans-page')).toBe(false);
    expect(document.documentElement.classList.contains('pt-only-trans-para')).toBe(true);
  });
});

describe('applyStyle', () => {
  test('替换 pt-style-* 类名', () => {
    document.documentElement.classList.add('pt-style-default');
    applyStyle('underline');
    expect(document.documentElement.classList.contains('pt-style-default')).toBe(false);
    expect(document.documentElement.classList.contains('pt-style-underline')).toBe(true);
  });

  test('不会残留旧样式类', () => {
    document.documentElement.classList.add('pt-style-fade');
    document.documentElement.classList.add('pt-style-bold');
    applyStyle('dim');
    const styleClasses = [...document.documentElement.classList].filter((c) =>
      c.startsWith('pt-style-'),
    );
    expect(styleClasses).toEqual(['pt-style-dim']);
  });
});
