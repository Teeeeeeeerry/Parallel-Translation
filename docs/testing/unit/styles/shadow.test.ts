/**
 * styles/shadow.ts — shadow root 样式注入（#163）
 *
 * 扩展 CSS 不跨 shadow 边界，shadow 内译文须经 <style> 注入
 * tokens + presets + :host-context 变体才能被模式/样式预设控制。
 */
import { describe, test, expect } from 'vitest';
import { injectShadowStyles } from '~/src/styles/shadow';

describe('shadow 样式注入（#163）', () => {
  test('注入 <style>，含 :host-context 变体与基础结构规则', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    injectShadowStyles(root);

    const style = root.querySelector('style');
    expect(style).toBeTruthy();
    const css = style!.textContent ?? '';
    // 仅译文模式变体（文档侧类经宿主祖先链生效）
    expect(css).toContain(":host-context(.pt-only-trans-page) [data-pt-src='page'] .pt-origin");
    // 样式预设变体
    expect(css).toContain(':host-context(.pt-style-default) .pt-trans');
    // 元素级基础规则
    expect(css).toContain('.pt-trans');
  });

  test('幂等：重复注入只产生一个 <style>', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    injectShadowStyles(root);
    injectShadowStyles(root);
    expect(root.querySelectorAll('style')).toHaveLength(1);
  });

  test('不同 shadow root 各自注入', () => {
    const h1 = document.createElement('div');
    const h2 = document.createElement('div');
    const r1 = h1.attachShadow({ mode: 'open' });
    const r2 = h2.attachShadow({ mode: 'open' });
    injectShadowStyles(r1);
    injectShadowStyles(r2);
    expect(r1.querySelectorAll('style')).toHaveLength(1);
    expect(r2.querySelectorAll('style')).toHaveLength(1);
  });
});
