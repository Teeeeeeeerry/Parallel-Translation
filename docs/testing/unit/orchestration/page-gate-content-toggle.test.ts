/**
 * 整页开关入口上的内容识别（#843，规格 #831）
 *
 * 闸门的第一级是本地内容识别：样本取自整页入口已有的那个采集函数（只读
 * 模式），识别结果由注入的识别函数给出。经整页开关入口 togglePage 断言，
 * 假消息层数请求条数；识别函数是浏览器本地识别的替身。
 */
import { describe, test, expect, vi } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import type { ContentLang } from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { mockAllBoundingRects } from '../../setup';

function fakeSend() {
  return vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: { translations: req.texts.map((t) => `[译] ${t}`) },
  }));
}

type Detect = (sample: string) => Promise<ContentLang | null>;

function setup(pageLang: string | null, detect?: Detect) {
  const send = fakeSend();
  const pushes: string[] = [];
  const orch = createOrchestrator({
    send,
    getPageLang: () => pageLang,
    hasTranslated: () => false,
    pushStatus: (s) => pushes.push(s),
    ...(detect ? { detectContentLang: detect } : {}),
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  return { orch, send, pushes };
}

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});

function items(texts: string[]): TranslateItem<number>[] {
  return texts.map((text, i) => ({ text, ctx: i }));
}

const STEAM = items([
  '商店',
  '社区',
  '愿望单',
  'Explore a vast open world full of secrets and survive the night with friends.',
  'Over 200 hand-crafted quests await you across five unique biomes.',
]);
const ZH = items(['风格秀 风格排版 风格设计', '采用风格排版后需替换文案内容，以免遇到公众号原创保护问题']);

describe('声明是目标语言、内容成块外文：照常翻译（#843）', () => {
  test('Steam 那一类页面：声明 zh-cn，识别说大半是英文 —— 照常送翻，不弹同语言', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 61], ['zh', 38]));
    const { orch, send, pushes } = setup('zh-cn', detect);

    const result = await orch.togglePage(STEAM, 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].texts).toHaveLength(STEAM.length);
    expect(pushes).toEqual(['loading', 'done']);
    // 识别拿到的是这批翻译单元的文字
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls[0]![0]).toContain('Explore a vast open world');
    expect(detect.mock.calls[0]![0]).toContain('愿望单');
    orch.stop();
  });
});

describe('纯目标语言页面：仍然拦下，零请求（#777 不回退）', () => {
  test('声明 zh-CN、识别说是中文：一个翻译请求都不发，带同语言原因返回', async () => {
    const { orch, send, pushes } = setup('zh-CN', async () => reliable(['zh', 95], ['en', 5]));

    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(0);
    expect(result.status).toBe('same-language');
    expect(result.gate).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('取样是只读采集：超长的 br 段落不被切成切块，页面一个字不动，零请求', async () => {
    const line = (i: number) => `第 ${i} 行：采用风格排版后需替换文案内容，以免遇到公众号原创保护问题。`;
    document.body.innerHTML =
      `<h1>风格秀 风格排版 风格设计</h1><p>采用风格排版后需替换文案内容</p>` +
      `<p>${Array.from({ length: 120 }, (_, i) => line(i)).join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = (mode?: { readOnly: boolean }) =>
      collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
    const detect = vi.fn<Detect>(async () => reliable(['zh', 100]));
    const { orch, send } = setup('zh-CN', detect);

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    restoreRects();
    expect(result.status).toBe('same-language');
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls[0]![0]).toContain('风格秀');
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.pt-chunk, [data-pt-split]')).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('声明是外文、内容其实是目标语言：拦下（#843）', () => {
  test('声明 en、识别说是中文：零请求，同语言原因', async () => {
    const { orch, send } = setup('en', async () => reliable(['zh', 96], ['en', 4]));

    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(result.gate).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('识别不可用或拿不准：整页翻译与改动前一致（#843）', () => {
  const cases: [string, Detect | undefined][] = [
    ['没注入识别', undefined],
    ['识别给不出（null）', async () => null],
    ['识别说不可靠', async () => ({ reliable: false, languages: [{ lang: 'en', percentage: 100 }] })],
    ['识别出错（reject）', async () => Promise.reject(new Error('boom'))],
    [
      '识别函数同步抛错',
      () => {
        throw new Error('boom');
      },
    ],
  ];

  for (const [name, detect] of cases) {
    test(`${name}：声明是外文照常翻译，声明是目标语言照旧拦下`, async () => {
      const a = setup('en', detect);
      expect((await a.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('translated');
      expect(a.send).toHaveBeenCalledTimes(1);
      a.orch.stop();

      const b = setup('zh-CN', detect);
      expect((await b.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('same-language');
      expect(b.send).toHaveBeenCalledTimes(0);
      b.orch.stop();

      const c = setup(null, detect);
      expect((await c.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('translated');
      c.orch.stop();
    });
  }

  test('采集函数在只读取样时抛错：当识别拿不到，照常翻译', async () => {
    let calls = 0;
    const collectItems = (mode?: { readOnly: boolean }) => {
      calls++;
      if (mode?.readOnly) throw new Error('boom');
      return STEAM;
    };
    const { orch, send } = setup('en', async () => reliable(['zh', 100]));

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(calls).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});

describe('等识别的这段时间算在飞（#326 不回退）', () => {
  test('识别还没回来时再点一次：第二次返回忙碌，只送出一轮请求', async () => {
    let release!: (v: ContentLang) => void;
    const detect = vi.fn<Detect>(() => new Promise((r) => (release = r)));
    const { orch, send } = setup('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    const second = await orch.togglePage(STEAM, 'auto', 'zh-CN');
    release(reliable(['en', 76], ['zh', 23]));

    expect(second.status).toBe('busy');
    expect((await first).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});
