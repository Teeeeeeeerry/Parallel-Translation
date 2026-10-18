// @vitest-environment node
/**
 * 页面级闸门的异步判定入口 judgePage（#1076，父 #1069）
 *
 * 取样、取最长单元、超时竞速、识别从编排模块搬进闸门模块。这里直接在入口上
 * 断言：给定单元来源与识别器的行为（返回什么语言、多久返回、出不出错），判定
 * 结果是什么；不断言内部步骤。纯测试，不依赖 jsdom，不构造编排模块。判据不变
 * （冻结在 2.1.114），这些用例原先经整页开关入口断言（page-gate-content-toggle、
 * page-gate-units-toggle、page-gate-units-short），搬到这里后结论逐条相同。
 *
 * 识别替身按文字本身给结论（汉字过半就是中文，否则是英文），不调真实识别器：
 * 真实识别器的可靠标记会在两次调用之间翻转（#851）。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  judgePage,
  longestUnitTexts,
  CONTENT_DETECT_TIMEOUT_MS,
  CONTENT_SAMPLE_MIN_CHARS,
  CONTENT_SAMPLE_MAX_CHARS,
  FOREIGN_BLOCK_MIN_CHARS,
  UNIT_DETECT_COUNT,
  UNIT_DETECT_MAX_CHARS,
  type ContentLang,
  type PageGateEvidence,
} from '~/src/orchestration/page-gate';

type Detect = (sample: string) => Promise<ContentLang | null>;

const CJK = /[一-鿿]/g;

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});

/** 按文字本身给结论的识别替身：汉字过半是中文，否则是英文，都可靠。 */
function byText(): Detect {
  return async (text) => {
    const zh = Math.round(((text.match(CJK)?.length ?? 0) / text.length) * 100);
    return { reliable: true, languages: [zh >= 50 ? { lang: 'zh', percentage: zh } : { lang: 'en', percentage: 100 - zh }] };
  };
}

/** 识别替身：全页样本（含换行、比任何单元都长）给定结论，单个单元按文字本身判。 */
function sampleSays(share: ContentLang, unit: Detect = byText()): Detect {
  return async (text) => (text.includes('\n') ? share : unit(text));
}

const UNSURE: ContentLang = { reliable: false, languages: [{ lang: 'zh', percentage: 70 }, { lang: 'en', percentage: 20 }] };

/** 永不兑现，模拟 chrome.i18n.detectLanguage 的回调一直不来。 */
const hang: Detect = () => new Promise<ContentLang | null>(() => {});

/** 判一次：目标语言 zh-CN，没有检测语言。 */
function judge(units: readonly string[], pageLang: string | null, detect?: Detect, extra: Partial<PageGateEvidence> = {}) {
  return judgePage({
    to: 'zh-CN',
    detectedLang: null,
    pageLang,
    units: () => units,
    ...(detect && { detect }),
    ...extra,
  });
}

/** 一次判定里识别被调用几次（#892）：全页样本一次，加上最长的那几个单元各一次。 */
const oneRound = (units: readonly string[]) => 1 + longestUnitTexts([...units]).length;

const STEAM = [
  '商店',
  '社区',
  '愿望单',
  'Explore a vast open world full of secrets and survive the night with friends.',
  'Over 200 hand-crafted quests await you across five unique biomes.',
];
// #859：样本要够长才按占比判，这里取真实页面的量级
const ZH = [
  '风格秀 风格排版 风格设计',
  '采用风格排版后需替换文案内容，以免遇到公众号原创保护问题',
  '排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布',
  '如果文章里引用了别人的内容，请在文末注明出处，并附上原文链接',
  '有任何排版上的问题，可以在下面留言，我们会在一个工作日内回复',
];
/** 中文界面加一大段英文介绍（Steam ULTRAKILL 的形状，#890）。 */
const DESC =
  'ULTRAKILL is a fast-paced ultraviolent old-school FPS that fuses together classic shooters ' +
  'like Quake, modern shooters like Doom (2016) and character action games like Devil May Cry. ' +
  'Mankind has gone extinct and the only beings left on earth are machines fueled by blood.';
const ULTRAKILL = [
  '商店',
  '社区',
  '愿望单',
  '所有游戏 > 动作游戏 > ULTRAKILL',
  '用户评测：特别好评，最近评测：好评如潮，发行日期：2020 年 9 月 3 日',
  '开发者：Arsi "Hakita" Patala，发行商：New Blood Interactive',
  DESC,
  '登录以将此物品加入您的愿望单、关注它，或标记为已忽略',
];
/** 阮一峰的网络日志的形状（#902）：中文博客首页，单元都很短。 */
const BLOG = [
  '阮一峰的网络日志',
  '科技爱好者周刊（第 300 期）：开发者的工具箱，这一期介绍几个常用的命令行工具',
  '我是怎么学习新技术的：先读官方文档，再动手写一个最小的例子，最后看源码',
  '为什么要写博客：把想清楚的事情写下来，写下来的过程本身就是一次整理',
  '本周的文章、工具与资源，欢迎投稿，也欢迎推荐你觉得值得一读的内容',
  '订阅 · 归档 · 关于',
];

afterEach(() => {
  vi.useRealTimers();
});

describe('全页样本的占比（#843）', () => {
  test('声明 zh-cn、识别说大半是英文：翻；识别拿到的是这批单元的文字', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 61], ['zh', 38]));
    expect(await judge(STEAM, 'zh-cn', detect)).toEqual({ translate: true, basis: 'content-share' });
    expect(detect).toHaveBeenCalledTimes(oneRound(STEAM));
    expect(detect.mock.calls[0]![0]).toContain('Explore a vast open world');
    expect(detect.mock.calls[0]![0]).toContain('愿望单');
  });

  test('声明 zh-CN、识别说是中文：不翻，带同语言原因', async () => {
    expect(await judge(ZH, 'zh-CN', async () => reliable(['zh', 95], ['en', 5]))).toMatchObject({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
  });

  test('声明 en、识别说是中文：不翻', async () => {
    expect(await judge(ZH, 'en', async () => reliable(['zh', 96], ['en', 4]))).toMatchObject({
      translate: false,
      lang: 'zh-CN',
    });
  });
});

describe('识别器拿不准或拿不到结果：翻，不回落到声明（#889）', () => {
  const cases: [string, Detect][] = [
    ['识别说不可靠（Amazon MacBook Pro 的形状）', async () => ({ ...reliable(['en', 51], ['zh', 39]), reliable: false })],
    ['识别给不出（null）', async () => null],
    ['识别说不可靠、只给中文', async () => ({ reliable: false, languages: [{ lang: 'zh', percentage: 100 }] })],
    ['识别出错（reject）', async () => Promise.reject(new Error('boom'))],
    [
      '识别函数同步抛错',
      () => {
        throw new Error('boom');
      },
    ],
  ];
  for (const [name, detect] of cases) {
    test(`${name}：声明是外文、目标语言或没有声明，都翻`, async () => {
      for (const pageLang of ['en', 'zh-CN', null]) {
        expect((await judge(STEAM, pageLang, detect)) as { translate: boolean }).toMatchObject({ translate: true });
      }
    });
  }
});

describe('没有识别器，或单元来源出错：走检测语言与声明的链条（#791）', () => {
  test('声明是外文翻，声明是目标语言不翻，没有声明翻；单元来源一次都不读', async () => {
    const units = vi.fn(() => STEAM);
    const run = (pageLang: string | null) => judgePage({ to: 'zh-CN', detectedLang: null, pageLang, units });
    expect(await run('en')).toMatchObject({ translate: true });
    expect(await run('zh-CN')).toMatchObject({ translate: false, basis: 'declaration' });
    expect(await run(null)).toMatchObject({ translate: true });
    expect(units).not.toHaveBeenCalled();
  });

  test('检测语言优先于声明', async () => {
    expect(await judgePage({ to: 'zh-CN', detectedLang: 'zh-CN', pageLang: 'en', units: () => STEAM })).toMatchObject({
      translate: false,
      basis: 'declaration',
    });
  });

  test('单元来源抛错：当没做识别，按声明判', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['zh', 100]));
    const units = () => {
      throw new Error('boom');
    };
    expect(await judge([], 'en', detect, { units })).toMatchObject({ translate: true, basis: 'declaration' });
    expect(await judge([], 'zh-CN', detect, { units })).toMatchObject({ translate: false, basis: 'declaration' });
    expect(detect).not.toHaveBeenCalled();
  });
});

describe('样本太短不按占比判，走回落那条链（#859）', () => {
  const unitOf = (n: number) => [('Explore a vast open world full of secrets. '.repeat(10)).slice(0, n - 1) + '.'];

  test(`下限是 ${CONTENT_SAMPLE_MIN_CHARS} 个字符`, () => {
    expect(CONTENT_SAMPLE_MIN_CHARS).toBe(100);
  });

  test('差 1 个字符到下限：不送去识别，按声明不翻', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 100]));
    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS - 1);
    expect(page[0]).toHaveLength(CONTENT_SAMPLE_MIN_CHARS - 1);
    expect(await judge(page, 'zh-CN', detect)).toMatchObject({ translate: false, basis: 'declaration' });
    expect(detect).not.toHaveBeenCalled();
  });

  test('恰好到下限：送去识别，按识别的占比翻', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['en', 100]));
    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS);
    expect(await judge(page, 'zh-CN', detect)).toMatchObject({ translate: true });
    expect(detect).toHaveBeenCalledTimes(oneRound(page));
    expect(detect.mock.calls[0]![0]).toHaveLength(CONTENT_SAMPLE_MIN_CHARS);
  });

  test('与“识别不可靠”是两条分支：够长但识别器说不可靠，送去识别，翻（#889）', async () => {
    const detect = vi.fn<Detect>(async () => ({ ...reliable(['zh', 100]), reliable: false }));
    const page = unitOf(CONTENT_SAMPLE_MIN_CHARS);
    expect(await judge(page, 'zh-CN', detect)).toMatchObject({ translate: true, basis: 'pass' });
    expect(detect).toHaveBeenCalledTimes(oneRound(page));
  });

  test('声明是外文、样本太短：不送去识别，按声明翻', async () => {
    const detect = vi.fn<Detect>(async () => reliable(['zh', 100]));
    expect(await judge(['你好世界', '登录后继续'], 'en', detect)).toMatchObject({ translate: true });
    expect(detect).not.toHaveBeenCalled();
  });
});

describe('外文块（#891、#892）', () => {
  test('中文界面加英文介绍，全页样本却是中文占优、可靠：翻；英文介绍单独送去识别过', async () => {
    // 全页样本给成 zh 70：占比按字节算，中文界面一个字算三份，只看占比会拦下
    const detect = vi.fn(sampleSays(reliable(['zh', 70])));
    expect(await judge(ULTRAKILL, 'zh-cn', detect)).toEqual({ translate: true, basis: 'foreign-block' });
    expect(detect.mock.calls.map((c) => c[0])).toContain(DESC);
  });

  test('纯中文页面：没有外文块，不翻', async () => {
    expect(await judge(ZH, 'en', vi.fn(byText()))).toMatchObject({ translate: false, lang: 'zh-CN' });
  });

  test('外文块那个单元的识别出错（reject、同步抛错）：不算外文块，按全页样本不翻', async () => {
    const ok = sampleSays(reliable(['zh', 70]));
    for (const bad of [
      () => Promise.reject(new Error('boom')),
      () => {
        throw new Error('boom');
      },
    ]) {
      const detect = vi.fn<Detect>((text) => (text === DESC ? bad() : ok(text)));
      expect(await judge(ULTRAKILL, 'zh-cn', detect)).toMatchObject({ translate: false });
    }
  });
});

describe('单元过短：不到外文块下限的单元也送去识别，接上“最长的几个单元”那一级（#904）', () => {
  test('短单元的中文页，全页识别拿不准：最长的三个单元都是中文，不翻；每个单元识别一次', async () => {
    for (const u of BLOG) expect(u.length).toBeLessThan(FOREIGN_BLOCK_MIN_CHARS);
    const detect = vi.fn(sampleSays(UNSURE));
    expect(await judge(BLOG, 'zh-CN', detect)).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
      basis: 'longest-units',
    });
    const units = detect.mock.calls.map((c) => c[0]).filter((t) => !t.includes('\n'));
    expect(units.sort()).toEqual([...BLOG].sort());
  });

  test('短单元的外文内容页（中文界面、英文标题），全页识别拿不准：翻', async () => {
    // YouTube 大模型入门第二遍的形状（#902）
    const page = [
      '首页',
      'Intro to Large Language Models',
      'Let us build GPT: from scratch, in code, spelled out. Neural networks: zero to hero',
      'The spelled-out intro to neural networks and backpropagation: building micrograd',
      'Deep Dive into LLMs like ChatGPT, a general audience deep dive into the technology',
      '订阅',
    ];
    expect(await judge(page, 'zh-Hans-CN', sampleSays(UNSURE))).toEqual({ translate: true, basis: 'pass' });
  });
});

describe('作用域限定：判定只看单元来源交出的单元', () => {
  test('来源只交出限定范围里的英文正文（站点页面规则的限定范围）：翻；范围外的中文界面不参与', async () => {
    const scoped = STEAM.slice(3);
    const detect = vi.fn(byText());
    expect(await judge(scoped, 'zh-CN', detect)).toMatchObject({ translate: true });
    for (const [text] of detect.mock.calls) expect(text).not.toContain('愿望单');
  });

  test('来源只交出限定范围里的中文正文：不翻', async () => {
    expect(await judge(ZH, 'en', byText())).toMatchObject({ translate: false });
  });
});

describe('识别调用次数与喂进去的文字量有上限，不随单元数增长（#867）', () => {
  const longPage = (n: number) => ['商店', '社区', ...Array.from({ length: n }, () => 'Explore a vast open world full of secrets. '.repeat(25))];
  const shortPage = (n: number) => [
    '商店',
    '社区',
    ...Array.from({ length: n }, (_, i) => `Item ${String(i).padStart(4, '0')}: explore a vast open world full of secrets and hidden rooms.`),
  ];

  for (const [name, page, detectFor] of [
    ['长段落', longPage, () => byText()],
    ['不到外文块下限的短段落', shortPage, () => sampleSays(UNSURE)],
  ] as const) {
    test(`${name}：段落数 200、800、3200，识别都是 1 加单元上限次，喂进去的文字量相同`, async () => {
      const calls: number[] = [];
      const fed: number[] = [];
      for (const n of [200, 800, 3200]) {
        const detect = vi.fn(detectFor());
        expect(await judge(page(n), 'zh-CN', detect)).toMatchObject({ translate: true });
        const inputs = detect.mock.calls.map((c) => c[0]);
        calls.push(inputs.length);
        fed.push(inputs.reduce((sum, t) => sum + t.length, 0));
        for (const t of inputs) expect(t.length).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS);
      }
      expect(calls).toEqual([1 + UNIT_DETECT_COUNT, 1 + UNIT_DETECT_COUNT, 1 + UNIT_DETECT_COUNT]);
      expect(new Set(fed).size).toBe(1);
      expect(fed[0]).toBeLessThanOrEqual(CONTENT_SAMPLE_MAX_CHARS + UNIT_DETECT_COUNT * UNIT_DETECT_MAX_CHARS);
    });
  }

  test('不翻的页面：识别照样有上限', async () => {
    const zhPage = Array.from(
      { length: 500 },
      (_, i) => `第 ${i} 段：排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布，引用别人的内容请注明出处。`,
    );
    const detect = vi.fn(byText());
    expect(await judge(zhPage, 'en', detect)).toMatchObject({ translate: false });
    expect(detect.mock.calls.length).toBeLessThanOrEqual(1 + UNIT_DETECT_COUNT);
  });
});

describe('识别超时：一秒上限是整个识别阶段共用的（#866、#892）', () => {
  /** 判定在 ms 毫秒时有没有结束。 */
  async function settledBy(p: Promise<unknown>, ms: number): Promise<boolean> {
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(ms);
    return done;
  }

  test('全部识别都挂住，声明是外文：上限之前没有结论，到上限翻', async () => {
    vi.useFakeTimers();
    const detect = vi.fn(hang);
    const p = judge(STEAM, 'en', detect);
    expect(await settledBy(p, CONTENT_DETECT_TIMEOUT_MS - 1)).toBe(false);
    expect(await settledBy(p, 1)).toBe(true);
    expect(await p).toEqual({ translate: true, basis: 'pass' });
    expect(detect.mock.calls.length).toBeGreaterThan(1);
  });

  test('全部识别都挂住，声明是目标语言：到上限当拿不到结果，翻（#889，以前按声明拦下）', async () => {
    vi.useFakeTimers();
    const p = judge(ZH, 'zh-CN', hang);
    expect(await settledBy(p, CONTENT_DETECT_TIMEOUT_MS)).toBe(true);
    expect(await p).toMatchObject({ translate: true });
  });

  test('识别在上限之内回来：用识别的结论，不等到上限', async () => {
    vi.useFakeTimers();
    let release: (v: ContentLang) => void = () => {};
    const held = new Promise<ContentLang>((r) => (release = r));
    const p = judge(STEAM, 'zh-cn', () => held);
    expect(await settledBy(p, 5)).toBe(false);
    release(reliable(['en', 76], ['zh', 23]));
    expect(await settledBy(p, 0)).toBe(true);
    // 声明是 zh-cn，按回落会拦下；翻说明用的是识别的结论
    expect(await p).toMatchObject({ translate: true, basis: 'content-share' });
  });

  test('只有英文介绍那个单元挂住：到上限判，它不算外文块，按全页样本不翻', async () => {
    vi.useFakeTimers();
    const ok = sampleSays(reliable(['zh', 70]));
    const p = judge(ULTRAKILL, 'zh-cn', (text) => (text === DESC ? hang(text) : ok(text)));
    expect(await settledBy(p, CONTENT_DETECT_TIMEOUT_MS)).toBe(true);
    expect(await p).toMatchObject({ translate: false });
  });

  test('短单元的识别全部挂住：到上限判，证据不足，翻', async () => {
    vi.useFakeTimers();
    const p = judge(BLOG, 'zh-CN', (text) => (text.includes('\n') ? Promise.resolve(UNSURE) : hang(text)));
    expect(await settledBy(p, CONTENT_DETECT_TIMEOUT_MS)).toBe(true);
    expect(await p).toMatchObject({ translate: true });
  });

  test('最长的三个里有一个挂住：到上限判，那一个当拿不到，不拦', async () => {
    vi.useFakeTimers();
    const longest = [...BLOG].sort((a, b) => b.length - a.length)[0]!;
    const ok = sampleSays(UNSURE);
    const p = judge(BLOG, 'zh-CN', (text) => (text === longest ? hang(text) : ok(text)));
    expect(await settledBy(p, CONTENT_DETECT_TIMEOUT_MS)).toBe(true);
    expect(await p).toMatchObject({ translate: true });
  });

  test('时限可注入', async () => {
    vi.useFakeTimers();
    const p = judge(STEAM, 'en', hang, { timeoutMs: 50 });
    expect(await settledBy(p, 50)).toBe(true);
  });
});

describe('识别期间中止：以“被放弃”结束（#862）', () => {
  test('识别在飞时中止：立即结束，不等识别回来', async () => {
    const ctrl = new AbortController();
    const p = judge(STEAM, 'zh-cn', hang, { signal: ctrl.signal });
    ctrl.abort();
    expect(await p).toBe('abandoned');
  });

  test('中止之后识别才回来：结果丢弃，仍是“被放弃”；识别说是目标语言也一样', async () => {
    for (const verdict of [reliable(['en', 76], ['zh', 23]), reliable(['zh', 95], ['en', 5])]) {
      const ctrl = new AbortController();
      let release: (v: ContentLang) => void = () => {};
      const p = judge(STEAM, 'zh-cn', () => new Promise((r) => (release = r)), { signal: ctrl.signal });
      ctrl.abort();
      release(verdict);
      expect(await p).toBe('abandoned');
    }
  });

  test('开始前已中止：不读单元、不送去识别', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const units = vi.fn(() => STEAM);
    const detect = vi.fn(byText());
    expect(await judge(STEAM, 'en', detect, { units, signal: ctrl.signal })).toBe('abandoned');
    expect(units).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
  });

  test('识别回来之后才中止：判定照常给出（中止由调用方之后自己看）', async () => {
    const ctrl = new AbortController();
    const decision = await judge(STEAM, 'zh-cn', async () => reliable(['en', 76], ['zh', 23]), { signal: ctrl.signal });
    ctrl.abort();
    expect(decision).toMatchObject({ translate: true });
  });
});
