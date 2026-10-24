/**
 * 整页开关入口上的内容识别（#843，规格 #831）
 *
 * 闸门的第一级是本地内容识别：样本取自整页入口已有的那个采集函数（只读
 * 模式），识别结果由注入的识别函数给出。经整页开关入口 togglePage 断言，
 * 假消息层数请求条数；识别函数是浏览器本地识别的替身。
 *
 * #1076：判定本身（占比、拿不准、样本太短、超时、出错）在闸门的判定入口上
 * 测，见 page-gate-judge.test.ts。这里只留接线：拦下不送翻、放行送翻、只读
 * 取样页面不动、等识别算在飞、识别期间还原、悬浮球状态。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createPageContext } from '~/src/orchestration/page-context';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { itemsPage } from './page-harness';
import { CONTENT_DETECT_TIMEOUT_MS } from '~/src/orchestration/page-gate';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import {
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
  const page = itemsPage();
  page.subscribe((s) => pushes.push(s));
  const orch = createOrchestrator({
    send,
    getPageLang: () => pageLang,
    ...(detect ? { detectContentLang: detect } : {}),
  });
  orch.start();
  return { orch, page, send, pushes };
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
    const { orch, page, send, pushes } = setup('zh-cn', detect);

    const result = await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');

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
    const { orch, page, send, pushes } = setup('zh-CN', async () => reliable(['zh', 95], ['en', 5]));

    const result = await orch.togglePage(page.withSource(ZH), 'auto', 'zh-CN');

    expect(send).toHaveBeenCalledTimes(0);
    expect(result.status).toBe('same-language');
    expect(result.gate).toMatchObject({ translate: false, reason: 'same-language', lang: 'zh-CN' });
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
    const { orch, page, send } = setup('zh-CN', detect);
    const round = oneRound(collectItems({ readOnly: true }));

    const result = await orch.togglePage(page.withSource(collectItems), 'auto', 'zh-CN');

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

describe('等识别的这段时间算在飞（#326 不回退）', () => {
  test('识别还没回来时再点一次：第二次返回忙碌，只送出一轮请求', async () => {
    const { detect, release } = heldDetect();
    const { orch, page, send } = setup('zh-cn', detect);

    const first = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    const second = await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
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
    const { orch, page, send, pushes } = setup('en', detect);

    const first = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS - 1);
    // 上限之前仍在等识别：再点一次是忙碌，一个请求都还没发
    expect((await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN')).status).toBe('busy');
    expect(send).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    const result = await first;
    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].texts).toHaveLength(STEAM.length);
    expect(pushes).toEqual(['loading', 'done']);

    // 在飞标记已经回落：再点一次不是忙碌，而是又走一轮（识别照样挂住、照样到点放弃）
    const again = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS);
    expect((await again).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(2);
    expect(pushes.at(-1)).toBe('done');
    orch.stop();
  });

});

describe('识别在飞时中止：这次运行已中止就丢弃识别结果（#862）', () => {
  /** 可控的识别替身：release 之前一直在飞。 */
  const pendingDetect = heldDetect;

  /** 页面有没有译文由用例控制：识别在飞时用户可以逐段翻译一段，再点悬浮球就是还原。 */
  function setupWithPage(pageLang: string | null, detect: Detect) {
    const send = fakeSend();
    const pushes: string[] = [];
    const dom = { translated: false };
    const restore = vi.fn(() => {
      dom.translated = false;
    });
    const page = itemsPage([], { hasTranslated: () => dom.translated, restore });
    page.subscribe((s) => pushes.push(s));
    const orch = createOrchestrator({
      send,
      getPageLang: () => pageLang,
      detectContentLang: detect,
    });
    orch.start();
    return { orch, send, pushes, page, dom, restore };
  }

  test('识别在飞时点还原：还原立即完成，不等识别返回', async () => {
    const { detect } = pendingDetect();
    const { orch, page, dom, restore, pushes } = setupWithPage('zh-cn', detect);

    void orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    // 识别在飞期间逐段翻译了一段，页面有了译文，再点悬浮球就是还原
    dom.translated = true;
    const restored = await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');

    // 识别一直没放行，还原照样走完
    expect(restored.status).toBe('restored');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('还原之后识别才回来：结果丢弃，不翻译、不推送状态', async () => {
    const { detect, release } = pendingDetect();
    const { orch, send, pushes, page, dom } = setupWithPage('zh-cn', detect);

    const first = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    dom.translated = true;
    await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    expect(pushes).toEqual(['idle']);
    // 识别说大半是英文：没有中止的话这里会照常整页翻译
    release(reliable(['en', 76], ['zh', 23]));

    const result = await first;
    expect(result.status).toBe('abandoned');
    expect(send).toHaveBeenCalledTimes(0);
    // 只有还原那一次推的 idle，识别回来之后什么都没推
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('abort 中止页面根（导航等中止）：识别回来不翻译也不推送；识别说是目标语言也不推未翻译态', async () => {
    for (const verdict of [reliable(['en', 76], ['zh', 23]), reliable(['zh', 95], ['en', 5])]) {
      const { detect, release } = pendingDetect();
      const { orch, page, send, pushes } = setupWithPage('zh-cn', detect);

      const first = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
      orch.abort();
      release(verdict);

      const result = await first;
      expect(result.status).toBe('abandoned');
      expect(result.gate).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(0);
      expect(pushes).toEqual([]);
      orch.stop();
    }
  });

  test('中止不计失败、不弹提示；在飞已回落，之后再点照常翻译', async () => {
    const { detect, release } = pendingDetect();
    const { orch, page, send, pushes } = setupWithPage('zh-cn', detect);

    const first = orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
    orch.abort();
    release(reliable(['en', 76], ['zh', 23]));
    const result = await first;

    expect(result.status).not.toBe('error');
    expect(result.summary).toBeUndefined();
    expect(pageNotice(result, emptyRenderStats())).toBeNull();

    detect.mockImplementation(async () => reliable(['en', 76], ['zh', 23]));
    const again = await orch.togglePage(page.withSource(STEAM), 'auto', 'zh-CN');
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
      detectContentLang: detect,
    });
    const page = itemsPage(collectItems, {
      hasTranslated: () => document.querySelector('[data-pt]') !== null,
      onObserverStart,
    });
    page.subscribe((s) => pushes.push(s));
    orch.start();

    for (let click = 1; click <= 2; click++) {
      const result = await orch.togglePage(page, 'auto', 'zh-CN');
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
    const { orch, page, send, pushes } = setup('en', async () => reliable(['zh', 96], ['en', 4]));

    const result = await orch.togglePage(page.withSource(ZH), 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(send).toHaveBeenCalledTimes(0);
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  // #1079 起状态流只在主框架订阅（见 content），子框架一次状态都不推不再是编排模块的事
  test('子框架：照样判、照样拦', async () => {
    const send = fakeSend();
    const orch = createOrchestrator({
      send,
      getPageLang: () => 'en',
      detectContentLang: async () => reliable(['zh', 96], ['en', 4]),
      context: createPageContext({
        isMainFrame: () => false,
      }),
    });
    orch.start();
    const page = itemsPage(ZH);

    const result = await orch.togglePage(page, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

