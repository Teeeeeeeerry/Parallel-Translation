/**
 * 设置页悬浮 UI 实时预览（#968，父 #964）
 *
 * 预览里的球用的是网页上真实 UI 的同一份样式（injected.css 注入 shadow），
 * 尺寸读与内容脚本同一个纯函数 floatingUiVars 的输出 —— 另写一份换算，
 * 两边一旦分叉预览就会骗人。jsdom 不排版，这里钉的是“写到预览上的变量
 * 就是纯函数的输出”；实际渲染尺寸由 e2e TC-E2E-194 量。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { createFloatingPreview } from '~/entrypoints/options/floating-preview';
import { floatingUiVars } from '~/src/ui/floating-ui-size';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

describe('createFloatingPreview（#968）', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  test('预览在自己的 shadow 里放一个与网页同类名的球（样式表内容在 vitest 里是空串，实际尺寸由 e2e 量）', () => {
    createFloatingPreview(host);
    const root = host.shadowRoot!;
    expect(root.querySelector('style')).not.toBeNull();
    expect(root.querySelector('.pt-ball')).not.toBeNull();
  });

  test('写到预览上的变量与纯函数的输出逐项相同（含需要钳制的脏值）', () => {
    const preview = createFloatingPreview(host);
    for (const size of [44, 60, 999, Number.NaN]) {
      const s = { ...DEFAULT_SETTINGS, floatingBallSize: size };
      preview.update(s);
      for (const [name, value] of Object.entries(floatingUiVars(s))) {
        expect(host.style.getPropertyValue(name)).toBe(value);
      }
    }
    expect(host.style.getPropertyValue('--pt-ball-size')).toBe('44px');
  });
});
