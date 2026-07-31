// Phase 4 — 用户自定义 CSS 校验、作用域限定、注入。
//
// 只收 CSS 声明块（属性: 值），不收选择器。
// 这换来三重安全：改不动宿主页面、改不动扩展自身 UI、
// 商店审核层面干净。

const STYLE_ID = 'pt-custom-style';

/** 禁止出现的构造 —— 一旦允许，用户就能改宿主页面和扩展自身 UI */
const FORBIDDEN = [
  { pattern: /[{}]/, msg: '只需填写 CSS 属性，无需选择器与花括号' },
  { pattern: /@import/i, msg: '不支持 @import' },
  { pattern: /<\/?style/i, msg: '不允许 style 标签' },
  { pattern: /javascript:/i, msg: '不允许 javascript: 协议' },
  { pattern: /expression\s*\(/i, msg: '不允许 expression()' },
];

export function validateCustomCss(
  input: string,
): { ok: true } | { ok: false; msg: string } {
  for (const { pattern, msg } of FORBIDDEN) {
    if (pattern.test(input)) return { ok: false, msg };
  }
  return { ok: true };
}

/**
 * 把用户输入的声明块包进 .pt-trans 作用域后注入。
 * 用户写 `color: #555`，实际注入 `.pt-trans { color: #555 }`。
 */
export function applyCustomCss(input: string): void {
  document.getElementById(STYLE_ID)?.remove();
  const css = input.trim();
  if (!css || !validateCustomCss(css).ok) return;

  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.setAttribute('data-pt-ui', '1'); // 防止被 walker 采集
  el.textContent = `.pt-trans { ${css} }`;
  document.head.appendChild(el);
}
