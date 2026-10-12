/**
 * 整页开关入口上的内容识别（#843，规格 #831）
 *
 * 闸门的第一级是本地内容识别：样本取自整页入口已有的那个采集函数（只读
 * 模式），识别结果由注入的识别函数给出。经整页开关入口 togglePage 断言，
 * 假消息层数请求条数；识别函数是浏览器本地识别的替身。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator, CONTENT_DETECT_TIMEOUT_MS } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import {
  CONTENT_SAMPLE_MIN_CHARS,
  longestUnitTexts,
  type ContentLang,
} from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { pageNotice, emptyRenderStats } from '~/src/orchestration/page-summary';
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

/** 一段正常长度的中文正文（真实 DOM 的用例里用，让只读取样够得着下限）。 */
const PARA =
  '排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布。如果文章里引用了别人的内容，' +
  '请在文末注明出处并附上原文链接。有任何排版上的问题可以在下面留言，我们会在一个工作日内回复。';

/**
 * 一次整页开关里识别被调用几次（#892）：全页样本一次，加上按文字长度排在
 * 最前面、够外文块下限的那几个单元各一次。
 */
function oneRound(list: { text: string }[]): number {
  return 1 + longestUnitTexts(list.map((item) => item.text)).length;
}

/** 可控的识别替身：release 之前每一次调用都在飞，release 时一起兑现。 */
function heldDetect() {
  const pending: ((v: ContentLang | null) => void)[] = [];
  const detect = vi.fn<Detect>(() => new Promise((r) => pending.push(r)));
  return { detect, release: (v: ContentLang | null) => pending.splice(0).forEach((r) => r(v)) };
}

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
// #859：样本要够长才按占比判，这里取真实页面的量级（真实页面的样本最短也有五百多字符）
const ZH = items([
  '风格秀 风格排版 风格设计',
  '采用风格排版后需替换文案内容，以免遇到公众号原创保护问题',
  '排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布',
  '如果文章里引用了别人的内容，请在文末注明出处，并附上原文链接',
  '有任何排版上的问题，可以在下面留言，我们会在一个工作日内回复',
]);

describe('声明是目标语言、内容成块外文：照常翻译（#843）', () => {
  test('Steam 那一类页面：声明 zh-cn，识别说大半是英文 —— 照常送翻，不弹同语言', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 61], ['zh', 38]));
    const { orch, send, pushes } = setup('zh-cn', detect);

    const result = await orch.togglePage(STEAM, 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].texts).toHaveLength(STEAM.length);
    expect(pushes).toEqual(['loading', 'done']);
    // 识别拿到的是这批翻译单元的文字（第一次是全页样本，其余是单元，#892）
    expect(detect).toHaveBeenCalledTimes(oneRound(STEAM));
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
      // #859：样本不到下限就不送去识别，补一段正常长度的正文，让样本到真实页面的量级
      `<p>${PARA}</p>` +
      `<p>${Array.from({ length: 120 }, (_, i) => line(i)).join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = (mode?: { readOnly: boolean }) =>
      collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
    const detect = vi.fn<Detect>(async () => reliable(['zh', 100]));
    const { orch, send } = setup('zh-CN', detect);
    const round = oneRound(collectItems({ readOnly: true }));

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    restoreRects();
    expect(result.status).toBe('same-language');
    expect(detect).toHaveBeenCalledTimes(round);
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

describe('识别器拿不准或拿不到结果：照常翻译，不回落到声明（#889，取代 #865）', () => {
  test('识别器说不可靠、声明是目标语言：照常翻译，送出整页请求', async () => {
    // #851 实测里被误拦的 5 张外文页都是这个形状：中文界面，声明 zh，识别器对
    // 样本报不可靠（Amazon MacBook Pro：en 51、zh 39）
    const detect = vi.fn<Detect>(async () => ({
      ...reliable(['en', 51], ['zh', 39]),
      reliable: false,
    }));
    const { orch, send, pushes } = setup('zh-cn', detect);

    const result = await orch.togglePage(STEAM, 'auto', 'zh-CN');

    expect(detect).toHaveBeenCalledTimes(oneRound(STEAM));
    expect(result.status).toBe('translated');
    expect(result.gate).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].texts).toHaveLength(STEAM.length);
    expect(pushes).toEqual(['loading', 'done']);
    orch.stop();
  });

  const cases: [string, Detect][] = [
    ['识别给不出（null）', async () => null],
    ['识别说不可靠', async () => ({ reliable: false, languages: [{ lang: 'zh', percentage: 100 }] })],
    ['识别出错（reject）', async () => Promise.reject(new Error('boom'))],
    [
      '识别函数同步抛错',
      () => {
        throw new Error('boom');
      },
    ],
  ];

  for (const [name, detect] of cases) {
    test(`${name}：声明是外文、目标语言或没有声明，都照常翻译`, async () => {
      for (const pageLang of ['en', 'zh-CN', null]) {
        const a = setup(pageLang, detect);
        expect((await a.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('translated');
        expect(a.send).toHaveBeenCalledTimes(1);
        a.orch.stop();
      }
    });
  }
});

describe('没注入识别：整页翻译与改动前一致（#843）', () => {
  test('声明是外文照常翻译，声明是目标语言照旧拦下，没有声明照常翻译', async () => {
    const a = setup('en');
    expect((await a.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('translated');
    expect(a.send).toHaveBeenCalledTimes(1);
    a.orch.stop();

    const b = setup('zh-CN');
    expect((await b.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('same-language');
    expect(b.send).toHaveBeenCalledTimes(0);
    b.orch.stop();

    const c = setup(null);
    expect((await c.orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('translated');
    c.orch.stop();
  });

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
    const { detect, release } = heldDetect();
    const { orch, send } = setup('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    const second = await orch.togglePage(STEAM, 'auto', 'zh-CN');
    release(reliable(['en', 76], ['zh', 23]));

    expect(second.status).toBe('busy');
    expect((await first).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    // 只识别了一轮：忙碌的那一下没有再送去识别
    expect(detect).toHaveBeenCalledTimes(oneRound(STEAM));
    orch.stop();
  });
});

describe('识别的回调永远不来：到时间上限就当拿不到，照常翻译（#866、#889）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 识别替身永不兑现，模拟 chrome.i18n.detectLanguage 的回调一直不来
  const hang: Detect = () => new Promise<ContentLang | null>(() => {});

  test('声明是外文：上限之前算在飞，到上限后走回落照常翻译，在飞回落、悬浮球停在完成态', async () => {
    vi.useFakeTimers();
    const detect = vi.fn<Detect>(hang);
    const { orch, send, pushes } = setup('en', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS - 1);
    // 上限之前仍在等识别：再点一次是忙碌，一个请求都还没发
    expect((await orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('busy');
    expect(send).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    const result = await first;
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].texts).toHaveLength(STEAM.length);
    expect(pushes).toEqual(['loading', 'done']);

    // 在飞标记已经回落：再点一次不是忙碌，而是又走一轮（识别照样挂住、照样到点放弃）
    const again = orch.togglePage(STEAM, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS);
    expect((await again).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(2);
    expect(pushes.at(-1)).toBe('done');
    orch.stop();
  });

  test('声明是目标语言：到上限后当拿不到结果，照常翻译（#889，以前按声明拦下）', async () => {
    vi.useFakeTimers();
    const { orch, send, pushes } = setup('zh-CN', hang);

    const first = orch.togglePage(ZH, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS - 1);
    expect(send).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await first;

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['loading', 'done']);
    orch.stop();
  });

  test('识别在上限之内回来：用识别的结论，不等到上限', async () => {
    vi.useFakeTimers();
    const { detect, release } = heldDetect();
    const { orch, send } = setup('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(5);
    release(reliable(['en', 76], ['zh', 23]));
    await vi.advanceTimersByTimeAsync(0);
    const result = await first;

    // 声明是 zh-cn，按回落会拦下；照常翻译说明用的是识别的结论
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});

describe('识别在飞时中止：纪元变了就丢弃识别结果（#862，#328 的中止纪元）', () => {
  /** 可控的识别替身：release 之前一直在飞。 */
  const pendingDetect = heldDetect;

  /** 页面有没有译文由用例控制：识别在飞时用户可以逐段翻译一段，再点悬浮球就是还原。 */
  function setupWithPage(pageLang: string | null, detect: Detect) {
    const send = fakeSend();
    const pushes: string[] = [];
    const page = { translated: false };
    const restore = vi.fn(() => {
      page.translated = false;
    });
    const orch = createOrchestrator({
      send,
      getPageLang: () => pageLang,
      hasTranslated: () => page.translated,
      restore,
      pushStatus: (s) => pushes.push(s),
      detectContentLang: detect,
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();
    return { orch, send, pushes, page, restore };
  }

  test('识别在飞时点还原：还原立即完成，不等识别返回', async () => {
    const { detect } = pendingDetect();
    const { orch, page, restore, pushes } = setupWithPage('zh-cn', detect);

    void orch.togglePage(STEAM, 'auto', 'zh-CN');
    // 识别在飞期间逐段翻译了一段，页面有了译文，再点悬浮球就是还原
    page.translated = true;
    const restored = await orch.togglePage(STEAM, 'auto', 'zh-CN');

    // 识别一直没放行，还原照样走完
    expect(restored.status).toBe('restored');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('还原之后识别才回来：结果丢弃，不翻译、不推送状态', async () => {
    const { detect, release } = pendingDetect();
    const { orch, send, pushes, page } = setupWithPage('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    page.translated = true;
    await orch.togglePage(STEAM, 'auto', 'zh-CN');
    expect(pushes).toEqual(['idle']);
    // 识别说大半是英文：纪元没变的话这里会照常整页翻译
    release(reliable(['en', 76], ['zh', 23]));

    const result = await first;
    expect(result.status).toBe('aborted');
    expect(send).toHaveBeenCalledTimes(0);
    // 只有还原那一次推的 idle，识别回来之后什么都没推
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('abort 递增纪元（导航等中止）：识别回来不翻译也不推送；识别说是目标语言也不推未翻译态', async () => {
    for (const verdict of [reliable(['en', 76], ['zh', 23]), reliable(['zh', 95], ['en', 5])]) {
      const { detect, release } = pendingDetect();
      const { orch, send, pushes } = setupWithPage('zh-cn', detect);

      const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
      orch.abort();
      release(verdict);

      const result = await first;
      expect(result.status).toBe('aborted');
      expect(result.gate).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(0);
      expect(pushes).toEqual([]);
      orch.stop();
    }
  });

  test('中止不计失败、不弹提示；在飞已回落，之后再点照常翻译', async () => {
    const { detect, release } = pendingDetect();
    const { orch, send, pushes } = setupWithPage('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    orch.abort();
    release(reliable(['en', 76], ['zh', 23]));
    const result = await first;

    expect(result.status).not.toBe('error');
    expect(result.summary).toBeUndefined();
    expect(pageNotice(result, emptyRenderStats())).toBeNull();

    detect.mockImplementation(async () => reliable(['en', 76], ['zh', 23]));
    const again = await orch.togglePage(STEAM, 'auto', 'zh-CN');
    expect(again.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['loading', 'done']);
    orch.stop();
  });
});

describe('内容识别这一级拦下纯目标语言页面：#777 的几条在新判定来源上重走（#863）', () => {
  // 声明写成 en：只靠声明会照常翻译，拦下只能是内容识别这一级给出的
  test('连点两次：两次都拦下、页面逐字节不变、零请求，增量补翻的观察器不启动', async () => {
    const line = (i: number) => `第 ${i} 行：采用风格排版后需替换文案内容，以免遇到公众号原创保护问题。`;
    document.body.innerHTML =
      `<h1>风格秀 风格排版 风格设计</h1><p>采用风格排版后需替换文案内容</p>` +
      // #859：样本不到下限就不送去识别，补一段正常长度的正文，让样本到真实页面的量级
      `<p>${PARA}</p>` +
      `<p>${Array.from({ length: 120 }, (_, i) => line(i)).join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = (mode?: { readOnly: boolean }) =>
      collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
    const send = fakeSend();
    const pushes: string[] = [];
    const onObserverStart = vi.fn();
    const detect = vi.fn<Detect>(async () => reliable(['zh', 97], ['en', 3]));
    const orch = createOrchestrator({
      send,
      getPageLang: () => 'en',
      hasTranslated: () => document.querySelector('[data-pt]') !== null,
      pushStatus: (s) => pushes.push(s),
      onObserverStart,
      detectContentLang: detect,
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();

    for (let click = 1; click <= 2; click++) {
      const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');
      expect(result.status).toBe('same-language');
      expect(document.body.innerHTML).toBe(before);
      expect(document.querySelectorAll('[data-pt], .pt-chunk, [data-pt-split]')).toHaveLength(0);
      expect(send).toHaveBeenCalledTimes(0);
      expect(detect).toHaveBeenCalledTimes(click * oneRound(collectItems({ readOnly: true })));
    }

    restoreRects();
    expect(onObserverStart).not.toHaveBeenCalled();
    expect(pushes).toEqual(['idle', 'idle']);
    orch.stop();
  });
});

describe('内容识别这一级拦下时的悬浮球状态（#870，同 #793、#327）', () => {
  // 声明都写成 en：拦下只能来自内容识别
  test('主文档：悬浮球推到未翻译态 idle，从不推 loading 或完成态 done', async () => {
    const { orch, send, pushes } = setup('en', async () => reliable(['zh', 96], ['en', 4]));

    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(send).toHaveBeenCalledTimes(0);
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('子框架：照样判、照样拦，但一次状态都不推', async () => {
    const send = fakeSend();
    const pushes: string[] = [];
    const orch = createOrchestrator({
      send,
      getPageLang: () => 'en',
      hasTranslated: () => false,
      isMainFrame: () => false,
      pushStatus: (s) => pushes.push(s),
      detectContentLang: async () => reliable(['zh', 96], ['en', 4]),
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();

    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(send).toHaveBeenCalledTimes(0);
    expect(pushes).toEqual([]);
    orch.stop();
  });
});

describe('样本太短不按占比判，走回落那条链（#859）', () => {
  // 下限的依据见 page-gate.ts 的 CONTENT_SAMPLE_MIN_CHARS：识别器对几十个字符的
  // 样本也会报可靠，一句外文就能让占比翻过阈值
  /** 一个翻译单元，文字恰好 n 个字符。 */
  const unitOf = (n: number) =>
    items([('Explore a vast open world full of secrets. '.repeat(10)).slice(0, n - 1) + '.']);

  test(`下限是 ${CONTENT_SAMPLE_MIN_CHARS} 个字符`, () => {
    expect(CONTENT_SAMPLE_MIN_CHARS).toBe(100);
  });

  test('差 1 个字符到下限：不送去识别，按声明拦下，零请求', async () => {
    // 识别若被调用会说可靠的英文，页面就会照常翻译 —— 拦下说明没按占比判
    const detect = vi.fn<Detect>(async () => reliable(['en', 100]));
    const { orch, send, pushes } = setup('zh-CN', detect);
    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS - 1);
    expect(page[0]!.text).toHaveLength(CONTENT_SAMPLE_MIN_CHARS - 1);

    const result = await orch.togglePage(page, 'auto', 'zh-CN');

    expect(detect).not.toHaveBeenCalled();
    expect(result.status).toBe('same-language');
    expect(send).not.toHaveBeenCalled();
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('恰好到下限：送去识别，按识别的占比判，照常翻译', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 100]));
    const { orch, send, pushes } = setup('zh-CN', detect);

    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS);
    const result = await orch.togglePage(page, 'auto', 'zh-CN');

    expect(detect).toHaveBeenCalledTimes(oneRound(page));
    expect(detect.mock.calls[0]![0]).toHaveLength(CONTENT_SAMPLE_MIN_CHARS);
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['loading', 'done']);
    orch.stop();
  });

  test('与“识别不可靠”是两条分支：够长但识别器说不可靠，照样送去识别，照常翻译（#889）', async () => {
    const detect = vi.fn<Detect>(async () => ({ ...reliable(['zh', 100]), reliable: false }));
    const { orch, send } = setup('zh-CN', detect);

    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS);
    const result = await orch.togglePage(page, 'auto', 'zh-CN');

    // 同样声明 zh-CN：样本太短时按声明拦下（上一条），够长而拿不准时照常翻译
    expect(detect).toHaveBeenCalledTimes(oneRound(page));
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });

  test('声明是外文、样本太短：不送去识别，按声明照常翻译', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['zh', 100]));
    const { orch, send } = setup('en', detect);

    const result = await orch.togglePage(items(['你好世界', '登录后继续']), 'auto', 'zh-CN');

    expect(detect).not.toHaveBeenCalled();
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    orch.stop();
  });
});
