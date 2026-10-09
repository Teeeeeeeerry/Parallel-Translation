/**
 * 页面级闸门只管整页翻译（#794）
 *
 * 在中文页面上划中一段英文引文单独翻译完全合理。闸门命中的页面上，经划词
 * 与逐段共用的单文本入口：外文照常送翻、照常插入或弹出译文；选中的本来
 * 就是目标语言的文字走 #787 的说明，不是被闸门拦住。
 */
import { describe, test, expect, vi, afterEach, afterAll } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { pageNotice, emptyRenderStats } from '~/src/orchestration/page-summary';
import { paraNotice, selectionNotice } from '~/src/orchestration/text-notice';
import { render } from '~/src/dom/renderer';
import { toast, toastPending } from '~/src/ui/toast';
import { unmountIsolated } from '~/src/ui/mount';

function toasts(): HTMLElement[] {
  const root = document.getElementById('pt-host-toast')?.shadowRoot;
  return root ? Array.from(root.querySelectorAll<HTMLElement>('.pt-toast')) : [];
}

/** 中文页面（声明 zh-CN）、目标语言 zh-CN：整页翻译先命中闸门。引擎回带标记的译文，或原样还回来。 */
async function gatedPage(reply: (t: string) => string = (t) => `[译] ${t}`) {
  const send = vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: { translations: req.texts.map(reply) },
  }));
  const orch = createOrchestrator({
    send,
    getPageLang: () => 'zh-CN',
    hasTranslated: () => false,
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  const page = await orch.togglePage([{ text: '我的文档', ctx: 0 }], 'auto', 'zh-CN');
  expect(page.status).toBe('same-language');
  expect(send).toHaveBeenCalledTimes(0);
  return { orch, send };
}

afterEach(() => {
  toasts().forEach((el) => el.remove());
});

afterAll(() => {
  unmountIsolated('toast');
});

describe('闸门命中的页面上，逐段与划词照常工作（#794）', () => {
  test('逐段翻译：外文段落照常送翻并插入译文', async () => {
    const { orch, send } = await gatedPage();
    document.body.innerHTML = '<p>Design is not just what it looks like.</p>';
    const p = document.querySelector('p')!;
    const source = p.textContent!;

    const result = await orch.translateText(source, 'auto', 'zh-CN', { recordDetectedLang: true });
    const notice = paraNotice(render(p, result.translation!, 'para', source));

    expect(result.admission).toBe('allowed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(p.querySelector('.pt-trans')!.textContent).toBe(`[译] ${source}`);
    expect(p.getAttribute('data-pt')).toBe('done');
    expect(notice).toBeNull();
    orch.stop();
  });

  test('划词翻译：选中的外文照常送翻，译文按内容类弹出', async () => {
    const { orch, send } = await gatedPage();
    const text = 'Design is how it works.';
    const pending = toastPending(chrome.i18n.getMessage('toastTranslating'));

    const result = await orch.translateText(text, 'auto', 'zh-CN');
    const notice = selectionNotice(text, result.translation!);
    toast(notice.message, notice);
    pending.dismiss();

    expect(send).toHaveBeenCalledTimes(1);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.dataset.purpose).toBe('content');
    expect(toasts()[0]!.querySelector('.pt-toast-body')!.textContent).toBe(`[译] ${text}`);
    orch.stop();
  });

  test('划词选中的本来就是目标语言：走 #787 的说明，不是闸门的“本页已经是目标语言”', async () => {
    const { orch, send } = await gatedPage((t) => t);
    const text = '采用风格排版后需替换文案内容';
    const pending = toastPending(chrome.i18n.getMessage('toastTranslating'));

    const result = await orch.translateText(text, 'auto', 'zh-CN');
    const notice = selectionNotice(text, result.translation!);
    toast(notice.message, notice);
    pending.dismiss();

    // 单文本入口不判页面级闸门：照常送翻，由单元级兜底判断
    expect(result.admission).toBe('allowed');
    expect(send).toHaveBeenCalledTimes(1);
    const [t] = toasts();
    expect(toasts()).toHaveLength(1);
    expect(t!.textContent).toBe(chrome.i18n.getMessage('toastSelectionSameAsSource'));
    expect(t!.textContent).not.toBe(
      pageNotice(
        { status: 'same-language', admission: 'allowed' } as Parameters<typeof pageNotice>[0],
        emptyRenderStats(),
      )!.message,
    );
    orch.stop();
  });
});
