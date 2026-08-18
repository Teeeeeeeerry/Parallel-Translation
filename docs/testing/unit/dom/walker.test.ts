/**
 * dom/walker.ts — 采集器单元测试（#114）
 *
 * 覆盖此前零测试的路径：
 * - Web Components 节点访问 textContent / compat 判定抛 DOMException →
 *   不崩溃、跳过该节点、其余节点继续采集（#54）
 * - compat 补丁 skip/take 优先于通用判定（take 分支此前完全不可达）
 * - 含媒体/交互控件的容器跳过自身、子元素仍可翻译（#50，#55 行内不阻断）
 * - 不可见单元记入 onHidden 回调（#23）
 * - shadowRoot 递归穿透、pt-ui 拒绝、SKIP_SET 拒绝、pre 切分入口
 *
 * applyCompat 在本文件统一 mock：compat 自身的各站点逻辑由
 * compat.test.ts / compat-github.test.ts / compat-youtube.test.ts /
 * compat-google.test.ts 覆盖，这里只测 walker 对补丁结果的消费。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mockAllBoundingRects, mockBoundingRect } from '../../setup';
import { collect } from '~/src/dom/walker';
import { applyCompat } from '~/src/dom/compat';

vi.mock('~/src/dom/compat', () => ({
  applyCompat: vi.fn(),
}));

const mockedCompat = vi.mocked(applyCompat);

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('collect（walker 基础路径）', () => {
  beforeEach(() => {
    setBody('');
    mockedCompat.mockReset();
    mockedCompat.mockReturnValue(null);
  });

  test('p / li 等翻译单元被采集，行内元素不采集', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<p id="a">alpha</p><li id="b">beta</li><span id="c">gamma</span>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['a', 'b']);
    } finally {
      restore();
    }
  });

  test('data-pt-ui="1" 扩展自身 UI：整棵子树拒绝（acceptNode REJECT）', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<div data-pt-ui="1"><p id="ui">extension ui</p></div><p id="ok">regular text</p>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['ok']);
    } finally {
      restore();
    }
  });

  test('SKIP_SET（button）整棵子树拒绝', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<button><span id="label">click me</span></button><p id="ok">regular text</p>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['ok']);
    } finally {
      restore();
    }
  });

  test('shadow host 递归穿透 shadowRoot，light + shadow 单元都采集', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<div id="host"><p id="light">light text</p></div>');
      const host = document.getElementById('host')!;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<p id="shadow">shadow text</p>';

      const units = collect();
      expect(units.map((u) => u.id).sort()).toEqual(['light', 'shadow']);
    } finally {
      restore();
    }
  });

  test('pre 走 splitPre 入口，短文本 pre 自身仍是翻译单元', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<pre id="p">short pre text</pre>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['p']);
    } finally {
      restore();
    }
  });
});

describe('collect（#54：Web Components 异常降级）', () => {
  beforeEach(() => {
    setBody('');
    mockedCompat.mockReset();
    mockedCompat.mockReturnValue(null);
  });

  test('applyCompat 抛 DOMException → 跳过该节点，其余继续采集', () => {
    mockedCompat.mockImplementation((el) => {
      if (el.classList.contains('wc')) {
        throw new DOMException('blocked', 'InvalidStateError');
      }
      return null;
    });

    const restore = mockAllBoundingRects();
    try {
      setBody('<p id="a">first</p><p class="wc" id="wc">bad node</p><p id="b">second</p>');
      expect(() => collect()).not.toThrow();
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['a', 'b']);
    } finally {
      restore();
    }
  });

  test('单元自身 textContent 访问抛 DOMException → 跳过，不崩溃（#54 形态）', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<p id="a">first</p><p id="wc">web component text</p><p id="b">second</p>');
      const wc = document.getElementById('wc')!;
      Object.defineProperty(wc, 'textContent', {
        get() {
          throw new DOMException('blocked', 'InvalidStateError');
        },
      });

      expect(() => collect()).not.toThrow();
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['a', 'b']);
    } finally {
      restore();
    }
  });
});

describe('collect（compat 补丁优先于通用判定）', () => {
  beforeEach(() => {
    setBody('');
    mockedCompat.mockReset();
    mockedCompat.mockReturnValue(null);
  });

  test('skip 优先：本可成为翻译单元的元素被补丁跳过', () => {
    mockedCompat.mockImplementation((el) =>
      el.classList.contains('compat-skip') ? { skip: true } : null,
    );

    const restore = mockAllBoundingRects();
    try {
      setBody('<p class="compat-skip" id="s">ui metadata</p><p id="ok">real text</p>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['ok']);
    } finally {
      restore();
    }
  });

  test('take 优先：行内非单元元素被补丁直接收为单元', () => {
    mockedCompat.mockImplementation((el) =>
      el.id === 't' ? { take: el } : null,
    );

    const restore = mockAllBoundingRects();
    try {
      setBody('<div><em id="t">inline but taken</em></div>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['t']);
    } finally {
      restore();
    }
  });

  test('take 自身后继续遍历：seen 去重同一元素，后续单元照常采集', () => {
    // take 分支 seen.add(el) + out.push(patched.take)：真实补丁 take 恒等于 el。
    // 元素经 take 入列后，同一 collect 内不会再被通用判定重复采集。
    mockedCompat.mockImplementation((el) =>
      el.id === 'a' ? { take: el } : null,
    );

    const restore = mockAllBoundingRects();
    try {
      setBody('<p id="a">alpha</p><p id="b">beta</p>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['a', 'b']);
    } finally {
      restore();
    }
  });
});

describe('collect（#50 / #55：非文本内容容器）', () => {
  beforeEach(() => {
    setBody('');
    mockedCompat.mockReset();
    mockedCompat.mockReturnValue(null);
  });

  test('含 video 的容器跳过自身，子元素仍可翻译', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody(
        '<div id="box">direct text<video></video><p id="child">child paragraph</p></div>',
      );
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['child']);
    } finally {
      restore();
    }
  });

  test('行内 img 不阻断：段落照常采集（#55 位置性判定）', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<p id="p">text <img src="icon.png" alt=""> more</p>');
      const units = collect();
      expect(units.map((u) => u.id)).toEqual(['p']);
    } finally {
      restore();
    }
  });
});

describe('collect（#23：不可见单元 → onHidden）', () => {
  beforeEach(() => {
    setBody('');
    mockedCompat.mockReset();
    mockedCompat.mockReturnValue(null);
  });

  test('不可见单元不入列、记入 onHidden；可见单元正常采集', () => {
    setBody('<p id="vis">visible text</p><p id="hid">hidden text</p>');
    mockAllBoundingRects();
    mockBoundingRect(document.getElementById('hid')!, { width: 0, height: 0 });

    const onHidden = vi.fn();
    const units = collect(document.body, onHidden);

    expect(units.map((u) => u.id)).toEqual(['vis']);
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(onHidden.mock.calls[0]![0]).toBe(document.getElementById('hid'));
  });

  test('shouldSkipNonVisual 跳过的单元（notranslate）静默跳过，不进 onHidden', () => {
    const restore = mockAllBoundingRects();
    try {
      setBody('<p class="notranslate" id="nt">skip me please</p><p id="ok">regular text</p>');
      const onHidden = vi.fn();
      const units = collect(document.body, onHidden);
      expect(units.map((u) => u.id)).toEqual(['ok']);
      expect(onHidden).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
