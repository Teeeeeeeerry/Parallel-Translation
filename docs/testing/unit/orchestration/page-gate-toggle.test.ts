/**
 * 整页开关入口接上页面级闸门（#792）
 *
 * 页面本来就是目标语言时点整页翻译：一个请求都不发、页面一个字不动、增量
 * 补翻的观察器不启动。经整页开关入口 togglePage 断言，假消息层数请求条数。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import { collect } from '~/src/dom/walker';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';
import { mockAllBoundingRects } from '../../setup';

/** 引擎替身：每段回一个带标记的译文，并报告检测语言 detected。 */
function fakeSend(detected?: string) {
  return vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: {
      translations: req.texts.map((t) => `[译] ${t}`),
      ...(detected ? { detectedFrom: detected } : {}),
    },
  }));
}

function setup(opts: {
  pageLang: string | null;
  send?: ReturnType<typeof fakeSend>;
  hasTranslated?: () => boolean;
  restore?: () => void;
  blocked?: boolean;
}) {
  const send = opts.send ?? fakeSend();
  const pushes: string[] = [];
  const onObserverStart = vi.fn();
  const orch = createOrchestrator({
    send,
    getPageLang: () => opts.pageLang,
    hasTranslated: opts.hasTranslated ?? (() => false),
    restore: opts.restore,
    pushStatus: (s) => pushes.push(s),
    onObserverStart,
    ...(opts.blocked
      ? {
          getHostname: () => 'www.example.com',
          getSettings: () => ({
            ...DEFAULT_SETTINGS,
            enabled: true,
            siteList: { mode: 'blacklist' as const, list: ['example.com'] },
          }),
        }
      : {}),
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  return { orch, send, pushes, onObserverStart };
}

function items(n: number): TranslateItem<number>[] {
  return Array.from({ length: n }, (_, i) => ({ text: `text-${i}`, ctx: i }));
}

describe('命中闸门：零请求、页面一个字不动（#792）', () => {
  test('页面语言与目标语言相同：一个翻译请求都不发，带着原因返回', async () => {
    const { orch, send } = setup({ pageLang: 'zh-CN' });

    const result = await orch.togglePage(items(40), 'auto', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(0);
    expect(result.status).toBe('same-language');
    expect(result.gate).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    orch.stop();
  });

  test('页面一个字不动：连采集都不做（采集会把超长段落切成切块）', async () => {
    const line = (i: number) => `第 ${i} 行：采用风格排版后需替换文案内容，以免遇到公众号原创保护问题。`;
    document.body.innerHTML = `<p>${Array.from({ length: 120 }, (_, i) => line(i)).join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = vi.fn(() => collect().map((el, i) => ({ text: el.textContent!, ctx: i })));
    const { orch, send } = setup({ pageLang: 'zh-CN' });

    await orch.togglePage(collectItems, 'auto', 'zh-CN');

    restoreRects();
    expect(collectItems).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });

  test('增量补翻的观察器不启动，悬浮球不点亮完成态', async () => {
    const { orch, onObserverStart, pushes } = setup({ pageLang: 'zh-CN' });

    await orch.togglePage(items(3), 'auto', 'zh-CN');

    expect(onObserverStart).not.toHaveBeenCalled();
    expect(pushes).not.toContain('done');
    expect(pushes).not.toContain('loading');
    orch.stop();
  });

  test('悬浮球推到未翻译态 idle，而不是完成态（#793）', async () => {
    const { orch, pushes } = setup({ pageLang: 'zh-CN' });

    await orch.togglePage(items(3), 'auto', 'zh-CN');

    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('子框架不推状态（#793，同 #327）', async () => {
    const pushes: string[] = [];
    const send = fakeSend();
    const orch = createOrchestrator({
      send,
      getPageLang: () => 'zh-CN',
      hasTranslated: () => false,
      isMainFrame: () => false,
      pushStatus: (s) => pushes.push(s),
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();

    const result = await orch.togglePage(items(3), 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(pushes).toEqual([]);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });

  test('站点被禁用时仍是准入拦截：闸门排在准入之后', async () => {
    const { orch, send } = setup({ pageLang: 'zh-CN', blocked: true });

    const result = await orch.togglePage(items(3), 'auto', 'zh-CN');

    expect(result.status).toBe('blocked');
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });

  test('页面已有译文时照常还原：闸门只管翻译这一支', async () => {
    const restore = vi.fn();
    const { orch, send } = setup({ pageLang: 'zh-CN', hasTranslated: () => true, restore });

    const result = await orch.togglePage(items(3), 'auto', 'zh-CN');

    expect(result.status).toBe('restored');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('不命中：整页翻译行为与改动前完全一致（#792）', () => {
  test('页面语言与目标语言不同：照常分批送翻、推送加载与完成、启动观察器', async () => {
    const { orch, send, pushes, onObserverStart } = setup({ pageLang: 'en' });

    const result = await orch.togglePage(items(40), 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(result.gate).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
    expect(pushes).toEqual(['loading', 'done']);
    expect(onObserverStart).toHaveBeenCalledTimes(1);
    orch.stop();
  });

  test('判不出页面语言：照常翻译（#789）', async () => {
    const { orch, send } = setup({ pageLang: null });

    const result = await orch.togglePage(items(2), 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });

  test('按需采集的形式：不命中时采集一次，照常翻译', async () => {
    const collectItems = vi.fn(() => items(2));
    const { orch, send } = setup({ pageLang: 'en' });

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    expect(collectItems).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});

describe('还原之后检测语言仍在（#792）', () => {
  // 检测语言留在编排里，不随还原清掉：用户换了目标语言再点一次，闸门可能
  // 走到检测语言那一级并命中 —— 这是对的，这一页确实就是新目标语言
  test('翻过一次（引擎报告 en）→ 还原 → 目标语言改成 en 再点：闸门按检测语言命中，零新增请求', async () => {
    let translated = false;
    const send = fakeSend('en');
    const { orch } = setup({
      pageLang: null,
      send,
      hasTranslated: () => translated,
      restore: () => (translated = false),
    });

    const first = await orch.togglePage(items(2), 'auto', 'zh-CN');
    expect(first.status).toBe('translated');
    translated = true;
    expect((await orch.togglePage(items(2), 'auto', 'zh-CN')).status).toBe('restored');
    const sent = send.mock.calls.length;

    const third = await orch.togglePage(items(2), 'auto', 'en');

    expect(third.status).toBe('same-language');
    expect(third.gate).toEqual({ translate: false, reason: 'same-language', lang: 'en' });
    expect(send).toHaveBeenCalledTimes(sent);
    orch.stop();
  });
});
