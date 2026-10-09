/**
 * orchestration/text-notice.ts — 逐段翻译与划词翻译拿到结果后的提示
 *
 * 从编排模块的单文本入口（逐段与划词共用）出发，经真实的渲染器与提示组件，
 * 断言外部可观察的结果：段落有没有变、提示走哪一类、显示了什么文字。
 */
import { describe, test, expect, vi, afterEach, afterAll } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { paraNotice } from '~/src/orchestration/text-notice';
import { render } from '~/src/dom/renderer';
import { toast } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';

/** 页面上当前的提示（挂在隔离的 shadow root 里）。 */
function toasts(): HTMLElement[] {
  const root = document.getElementById('pt-host-toast')?.shadowRoot;
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

/** 单文本入口：引擎按 reply 回文字。 */
async function translateText(text: string, reply: (t: string) => string) {
  const orch = createOrchestrator({
    send: vi.fn(async (req: { texts: string[] }) => ({
      ok: true,
      data: { translations: req.texts.map(reply) },
    })),
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  const result = await orch.translateText(text, 'auto', 'zh-CN');
  orch.stop();
  return result;
}

afterEach(() => {
  toasts().forEach((el) => el.remove());
});

afterAll(() => {
  unmountIsolated('toast');
});

describe('逐段翻译命中兜底（#786）', () => {
  /** 逐段翻译：单文本入口 → 渲染 → 提示，与 content script 同一口径。 */
  async function translateParagraph(p: Element, reply: (t: string) => string): Promise<void> {
    const source = p.textContent!;
    const result = await translateText(source, reply);
    const notice = paraNotice(render(p, result.translation!, 'para', source));
    if (notice) toast(notice.message, notice);
  }

  test('这一段已经是目标语言：弹状态类提示说明，段落一个字不动', async () => {
    document.body.innerHTML = '<p>采用风格排版后需替换<b>文案内容</b></p>';
    const p = document.querySelector('p')!;
    const before = p.outerHTML;

    await translateParagraph(p, (t) => t);

    expect(p.outerHTML).toBe(before);
    expect(p.hasAttribute('data-pt')).toBe(false);
    const [t] = toasts();
    expect(toasts()).toHaveLength(1);
    expect(t!.textContent).toBe(chrome.i18n.getMessage('toastParaSameAsSource'));
    expect(t!.dataset.purpose).toBe('status');
    expect(t!.dataset.kind).toBe('info');
  });

  test('译文确实不同：照常插入，不弹提示', async () => {
    document.body.innerHTML = '<p>Recycle bin</p>';
    const p = document.querySelector('p')!;

    await translateParagraph(p, () => '回收站');

    expect(p.querySelector('.pt-trans')!.textContent).toBe('回收站');
    expect(p.getAttribute('data-pt-src')).toBe('para');
    expect(toasts()).toHaveLength(0);
  });

  test('含图片/按钮被拒：仍是“该区域无法单独翻译”，两种拒绝说的话不同', () => {
    expect(paraNotice({ rendered: false, reason: 'non-text-content' })).toEqual({
      message: chrome.i18n.getMessage('toastNotTranslatable'),
      purpose: 'status',
      kind: 'error',
    });
  });
});
