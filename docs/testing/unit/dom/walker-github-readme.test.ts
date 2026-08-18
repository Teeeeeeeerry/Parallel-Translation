/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://github.com/torvalds/linux"}
 */
/**
 * dom/walker.ts — GitHub RST README 采集回归
 *
 * torvalds/linux 等仓库的 README 是 RST 格式，GitHub 用
 * .plain > pre（纯文本 + autolink <a>）渲染。修复前 splitPre 因
 * pre 含子元素而拒切，整篇远超 MAX_TEXT / MAX_HTML，
 * 采集 0 个翻译单元 —— 翻译静默失败（[data-pt="done"] 永不出现）。
 *
 * 与 compat-github.test.ts 同原因分离：jsdom 的 location.hostname
 * 需设为 github.com 页面，@vitest-environment-options 是文件级选项。
 */
import { describe, test, expect } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';

/**
 * 真实 README 片段的浓缩形态（2026-08 抓取自 github.com/torvalds/linux）：
 * 标题 + 装饰行 + 空行分隔的短段落 + RST 列表（URL 被 GitHub autolink 成 <a>）。
 * 单段均短于 MAX_TEXT（3072），全文超过 3072 才能触发 splitPre 切分路径。
 */
function buildReadmeFragment(): string {
  const para = (i: number) =>
    `Paragraph ${i}: The Linux kernel manages hardware, system resources, ` +
    `and provides the fundamental services for all other software running ` +
    `on the system, including device drivers and filesystem implementations.`;

  const lines = [
    '<div class="plain"><pre style="white-space: pre-wrap">',
    'Linux kernel',
    '============',
    '',
  ];
  for (let i = 0; i < 15; i++) {
    lines.push(para(i), '');
  }
  lines.push(
    'Quick Start',
    '-----------',
    '',
    '* Report a bug: See Documentation/admin-guide/reporting-issues.rst',
    '* Get the latest kernel: <a href="https://kernel.org" rel="nofollow">https://kernel.org</a>',
    '* Build the kernel: See Documentation/admin-guide/quickly-build-trimmed-linux.rst',
    '* Join the community: <a href="https://lore.kernel.org/" rel="nofollow">https://lore.kernel.org/</a>',
    '',
    '</pre></div>',
  );
  return lines.join('\n');
}

describe('collect（github.com RST README 回归）', () => {
  test('README 正文被采集为翻译单元（修复前为 0 单元）', () => {
    document.body.innerHTML = buildReadmeFragment();

    // jsdom 里 getBoundingClientRect 默认全 0 → 全部判不可见。
    // stub 为可见，模拟真实浏览器（原型级：覆盖 splitPre 新建的 span）。
    const restore = mockAllBoundingRects();

    let units: Element[] = [];
    try {
      units = collect();
    } finally {
      restore();
    }

    expect(units.length).toBeGreaterThan(0);

    // 首段正文在采集结果里（段落级锚点，而非只断言数量 > 0）
    const firstParaUnit = units.find((u) =>
      (u.textContent ?? '').includes('Paragraph 0:'),
    );
    expect(firstParaUnit).toBeDefined();
    expect(firstParaUnit!.tagName).toBe('SPAN');
    expect(firstParaUnit!.className).toBe('pt-chunk');
  });

  test('collect 后 autolink <a> 保留在切出的 chunk 内', () => {
    document.body.innerHTML = buildReadmeFragment();

    const restore = mockAllBoundingRects();
    try {
      collect();
    } finally {
      restore();
    }

    const anchors = document.querySelectorAll('div.plain > pre a');
    expect(anchors.length).toBe(2);
    expect([...anchors].map((a) => a.getAttribute('href'))).toEqual([
      'https://kernel.org',
      'https://lore.kernel.org/',
    ]);
    // 链接随所在行进入 .pt-chunk，未被丢弃
    for (const a of anchors) {
      expect(a.closest('span.pt-chunk')).not.toBeNull();
    }
  });
});
