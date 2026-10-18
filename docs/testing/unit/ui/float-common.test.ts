/**
 * 悬浮控件共用的口径挪到中立模块（#1080，父 #1070）
 *
 * 当前焦点元素（穿透 shadow DOM）与逐段翻译按钮的间隙、显示延迟两个常量放在
 * src/ui/float-common.ts，圆点、逐段翻译按钮、输入翻译各自从这里引用：输入翻译
 * 的业务入口不再依赖圆点这个 UI 部件，圆点也不再依赖逐段翻译按钮。
 */
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'fs';
import { GAP, SHOW_DELAY, deepActiveElement } from '~/src/ui/float-common';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('数值不变', () => {
  test('间隙 4px，显示延迟 140 毫秒', () => {
    expect(GAP).toBe(4);
    expect(SHOW_DELAY).toBe(140);
  });
});

describe('当前焦点元素穿透 shadow DOM', () => {
  test('焦点在 shadow root 里的输入框上：返回那个输入框，不是宿主', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(host);
    expect(deepActiveElement()).toBe(input);
  });

  test('焦点在普通输入框上：就是它', () => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    expect(deepActiveElement()).toBe(input);
  });
});

describe('依赖方向', () => {
  const imports = (file: string) =>
    [...fs.readFileSync(`src/ui/${file}`, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);

  test('输入翻译入口不引用圆点模块；圆点不引用逐段翻译按钮模块', () => {
    expect(imports('input-translate.ts')).not.toContain('./input-dot');
    expect(imports('input-dot.ts')).not.toContain('./paragraph-btn');
  });

  test('三者都从中立模块引用', () => {
    for (const f of ['input-translate.ts', 'input-dot.ts', 'paragraph-btn.ts']) {
      expect(imports(f)).toContain('./float-common');
    }
  });
});
