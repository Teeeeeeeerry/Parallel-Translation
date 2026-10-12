/**
 * 整页开关入口接上“够长的外文单元”判据（#892，父 #883）
 *
 * 取样阶段除了全页样本，再把按文字长度排在最前面的若干个单元各自送去本地
 * 识别，结果交给闸门的纯判定（#891）。经整页开关入口 togglePage 断言：假消息
 * 层数请求条数，识别替身数调用次数与喂进去的文字，真实 DOM 看页面变没变。
 *
 * 识别替身按文字本身给结论（汉字过半就是中文，否则是英文），不调真实识别器：
 * 真实识别器的可靠标记会在两次调用之间翻转（#851）。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createOrchestrator, CONTENT_DETECT_TIMEOUT_MS } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';
import {
  CONTENT_SAMPLE_MAX_CHARS,
  UNIT_DETECT_COUNT,
  UNIT_DETECT_MAX_CHARS,
  type ContentLang,
} from '~/src/orchestration/page-gate';
import { collect } from '~/src/dom/walker';
import { mockAllBoundingRects } from '../../setup';

type Detect = (sample: string) => Promise<ContentLang | null>;

const CJK = /[一-鿿]/g;

/** 按文字本身给结论的识别替身：汉字过半是中文，否则是英文，都可靠。 */
function byText(): Detect {
  return async (text) => {
    const zh = Math.round(((text.match(CJK)?.length ?? 0) / text.length) * 100);
    return { reliable: true, languages: [zh >= 50 ? { lang: 'zh', percentage: zh } : { lang: 'en', percentage: 100 - zh }] };
  };
}

/** 识别替身：全页样本（含换行、比任何单元都长）给定结论，单个单元按文字本身判。 */
function sampleSays(share: ContentLang): Detect {
  const unit = byText();
  return async (text) => (text.includes('\n') ? share : unit(text));
}

function fakeSend() {
  return vi.fn(async (req: { texts: string[] }) => ({
    ok: true,
    data: { translations: req.texts.map((t) => `[译] ${t}`) },
  }));
}

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

function items(texts: string[]): TranslateItem<number>[] {
  return texts.map((text, i) => ({ text, ctx: i }));
}

/** 中文界面加一大段英文介绍（Steam ULTRAKILL 的形状，#890）。 */
const DESC =
  'ULTRAKILL is a fast-paced ultraviolent old-school FPS that fuses together classic shooters ' +
  'like Quake, modern shooters like Doom (2016) and character action games like Devil May Cry. ' +
  'Mankind has gone extinct and the only beings left on earth are machines fueled by blood.';
const STEAM = items([
  '商店',
  '社区',
  '愿望单',
  '所有游戏 > 动作游戏 > ULTRAKILL',
  '用户评测：特别好评，最近评测：好评如潮，发行日期：2020 年 9 月 3 日',
  '开发者：Arsi "Hakita" Patala，发行商：New Blood Interactive',
  DESC,
  '登录以将此物品加入您的愿望单、关注它，或标记为已忽略',
]);
/** 纯中文页面（#859：样本到真实页面的量级）。 */
const ZH = items([
  '风格秀 风格排版 风格设计',
  '采用风格排版后需替换文案内容，以免遇到公众号原创保护问题',
  '排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布。如果文章里引用了别人的内容，请在文末注明出处并附上原文链接。',
  '如果文章里引用了别人的内容，请在文末注明出处，并附上原文链接',
  '有任何排版上的问题，可以在下面留言，我们会在一个工作日内回复',
]);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('有够长的外文单元：照常翻译，与改动前的整页翻译完全一致', () => {
  test('中文界面加英文介绍，全页样本却是中文占优、可靠：照常翻译', async () => {
    // 全页样本给成 zh 70：占比按字节算，中文界面一个字算三份，只看占比会拦下
    const detect = vi.fn(sampleSays({ reliable: true, languages: [{ lang: 'zh', percentage: 70 }] }));
    const { orch, send, pushes } = setup('zh-cn', detect);

    const result = await orch.togglePage(STEAM, 'auto', 'zh-CN');

    expect(result.status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['loading', 'done']);
    // 英文介绍单独送去识别过
    expect(detect.mock.calls.map((c) => c[0])).toContain(DESC);
    orch.stop();
  });

  test('送出去的请求与没注入识别、声明是外文时逐条相同', async () => {
    const a = setup('zh-cn', sampleSays({ reliable: true, languages: [{ lang: 'zh', percentage: 70 }] }));
    await a.orch.togglePage(STEAM, 'auto', 'zh-CN');
    const b = setup('en');
    await b.orch.togglePage(STEAM, 'auto', 'zh-CN');

    expect(a.send.mock.calls).toEqual(b.send.mock.calls);
    a.orch.stop();
    b.orch.stop();
  });
});

describe('没有够长的外文单元、全页目标语言占优：拦下', () => {
  test('纯中文页面：零请求，带同语言原因', async () => {
    const detect = vi.fn(byText());
    const { orch, send, pushes } = setup('en', detect);

    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');

    expect(result.status).toBe('same-language');
    expect(result.gate).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    expect(send).toHaveBeenCalledTimes(0);
    expect(pushes).toEqual(['idle']);
    orch.stop();
  });

  test('真实 DOM：中文页夹几行短英文，判定阶段页面一个字不动，零请求', async () => {
    document.body.innerHTML =
      '<h1>免费的编程中文书籍索引</h1>' +
      '<p>排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布。如果文章里引用了别人的内容，请在文末注明出处并附上原文链接。</p>' +
      '<ul><li>Pro Git 中文版</li><li>Learn React &amp; Webpack</li><li>https://git-scm.com/book/zh/v2</li></ul>' +
      `<p>${Array.from({ length: 80 }, (_, i) => `第 ${i} 行：采用风格排版后需替换文案内容，以免遇到原创保护问题。`).join('<br>\n')}</p>`;
    const before = document.body.innerHTML;
    const restoreRects = mockAllBoundingRects();
    const collectItems = (mode?: { readOnly: boolean }) =>
      collect(document.body, undefined, mode).map((el, i) => ({ text: el.textContent!, ctx: i }));
    const detect = vi.fn(byText());
    const { orch, send } = setup('en', detect);

    const result = await orch.togglePage(collectItems, 'auto', 'zh-CN');

    restoreRects();
    expect(result.status).toBe('same-language');
    expect(detect.mock.calls.length).toBeGreaterThan(1);
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll('.pt-chunk, [data-pt-split]')).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('识别调用次数与喂进去的文字量有上限，不随单元数增长', () => {
  /** n 段一样长的英文正文（每段都超过单元的识别上限），开头是中文导航。 */
  const page = (n: number) =>
    items([
      '商店',
      '社区',
      ...Array.from({ length: n }, () => 'Explore a vast open world full of secrets. '.repeat(25)),
    ]);

  test('段落数 200、800、3200：识别次数相同且不超过 1 加单元上限，每次喂进去的不超过各自上限', async () => {
    const calls: number[] = [];
    const fed: number[] = [];
    for (const n of [200, 800, 3200]) {
      const detect = vi.fn(byText());
      const { orch } = setup('zh-CN', detect);
      expect((await orch.togglePage(page(n), 'auto', 'zh-CN')).status).toBe('translated');
      orch.stop();
      const inputs = detect.mock.calls.map((c) => c[0]);
      calls.push(inputs.length);
      fed.push(inputs.reduce((sum, t) => sum + t.length, 0));
      // 全页样本一次，其余是单元
      expect(inputs.filter((t) => t.length > UNIT_DETECT_MAX_CHARS)).toHaveLength(1);
      for (const t of inputs) expect(t.length).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS);
    }
    expect(new Set(calls).size).toBe(1);
    expect(calls[0]).toBe(1 + UNIT_DETECT_COUNT);
    expect(new Set(fed).size).toBe(1);
    expect(fed[0]).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS + UNIT_DETECT_COUNT * UNIT_DETECT_MAX_CHARS);
  });

  test('闸门命中时：识别照样有上限，翻译请求一个都不发', async () => {
    const zhPage = items(
      Array.from({ length: 500 }, (_, i) => `第 ${i} 段：排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布，引用别人的内容请注明出处。`),
    );
    const detect = vi.fn(byText());
    const { orch, send } = setup('en', detect);

    expect((await orch.togglePage(zhPage, 'auto', 'zh-CN')).status).toBe('same-language');
    expect(detect.mock.calls.length).toBeLessThanOrEqual(1 + UNIT_DETECT_COUNT);
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });
});

describe('一秒上限（#866）是整个识别阶段共用的，不是每次一秒', () => {
  const hang: Detect = () => new Promise<ContentLang | null>(() => {});

  test('全部识别都挂住：到一秒就判，不是单元数乘一秒', async () => {
    vi.useFakeTimers();
    const detect = vi.fn(hang);
    const { orch, send } = setup('en', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS - 1);
    expect(send).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);

    expect((await first).status).toBe('translated');
    expect(send).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls.length).toBeGreaterThan(1);
    orch.stop();
  });

  test('只有英文介绍那个单元挂住：到一秒判，它不算外文块，按全页样本拦下', async () => {
    vi.useFakeTimers();
    const share: ContentLang = { reliable: true, languages: [{ lang: 'zh', percentage: 70 }] };
    const ok = sampleSays(share);
    const detect = vi.fn<Detect>((text) => (text === DESC ? hang(text) : ok(text)));
    const { orch, send } = setup('zh-cn', detect);

    const first = orch.togglePage(STEAM, 'auto', 'zh-CN');
    await vi.advanceTimersByTimeAsync(CONTENT_DETECT_TIMEOUT_MS);

    expect((await first).status).toBe('same-language');
    expect(send).toHaveBeenCalledTimes(0);
    orch.stop();
  });

  test('单元识别出错（reject、同步抛错）：不算外文块，不影响全页样本的结论', async () => {
    const share: ContentLang = { reliable: true, languages: [{ lang: 'zh', percentage: 70 }] };
    const ok = sampleSays(share);
    for (const bad of [
      () => Promise.reject(new Error('boom')),
      () => {
        throw new Error('boom');
      },
    ]) {
      const detect = vi.fn<Detect>((text) => (text === DESC ? bad() : ok(text)));
      const { orch, send } = setup('zh-cn', detect);
      expect((await orch.togglePage(STEAM, 'auto', 'zh-CN')).status).toBe('same-language');
      expect(send).toHaveBeenCalledTimes(0);
      orch.stop();
    }
  });
});
