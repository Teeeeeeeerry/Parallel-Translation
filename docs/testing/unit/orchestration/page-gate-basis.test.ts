/**
 * orchestration/page-gate.ts — 判定带上依据：结论来自哪一级（#857，规格 #831）
 *
 * 判定链改过几次（#843 内容识别、#889 拿不准就放行、#891 外文块），排查时要
 * 看得出这一次走的是哪一级。判定的返回值带上依据，四种依据各自能区分：
 * - foreign-block：翻译单元里有够长的外文单元（#891）
 * - content-share：全页样本里目标语言的占比（#843）
 * - declaration：检测语言 → 语言声明的链条（#791）
 * - pass：判不出，放行（识别器拿不准 #889，或链条判不出 #789）
 * 调用方不改行为：结论（translate、reason、lang）与改动前相同。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  decidePageGate,
  describePageGate,
  CONTENT_UNDETERMINED,
  type ContentLang,
  type PageGateDecision,
  type PageGateInput,
} from '~/src/orchestration/page-gate';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import type { TranslateItem } from '~/src/orchestration/orchestrator';

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});

/** 四种依据各一个典型输入（取自 #851、#890 的实测形状）。 */
const CASES: Record<string, PageGateInput> = {
  // Steam ULTRAKILL：1455 字符的英文介绍
  'foreign-block': {
    to: 'zh-CN',
    detectedLang: null,
    pageLang: 'zh-cn',
    contentLang: reliable(['zh', 70], ['en', 25]),
    contentUnits: [{ chars: 1455, lang: 'en', reliable: true }],
  },
  // Rust 程序设计语言中文版：声明 en，zh 95
  'content-share': {
    to: 'zh-CN',
    detectedLang: null,
    pageLang: 'en',
    contentLang: reliable(['zh', 95]),
    contentUnits: [{ chars: 319, lang: 'zh', reliable: true }],
  },
  // 没注入识别，声明是目标语言
  declaration: { to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN' },
  // YouTube 中文界面：识别器报不可靠
  pass: {
    to: 'zh-CN',
    detectedLang: null,
    pageLang: 'zh-Hans-CN',
    contentLang: { ...reliable(['en', 57], ['zh', 16]), reliable: false },
    contentUnits: [],
  },
};

describe('判定带上依据，四种依据各自能区分出来', () => {
  test('四个典型输入各自给出不同的依据，结论与改动前相同', () => {
    const got = Object.fromEntries(
      Object.entries(CASES).map(([name, input]) => [name, decidePageGate(input)]),
    );
    expect(got['foreign-block']).toEqual({ translate: true, basis: 'foreign-block' });
    expect(got['content-share']).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
      basis: 'content-share',
    });
    expect(got.declaration).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
      basis: 'declaration',
    });
    expect(got.pass).toEqual({ translate: true, basis: 'pass' });
    expect(new Set(Object.values(got).map((d) => d.basis)).size).toBe(4);
  });

  test('可读的说明：四种依据的文字各不相同，拦下时带出判出的语言', () => {
    const texts = Object.values(CASES).map((input) => describePageGate(decidePageGate(input)));
    expect(new Set(texts).size).toBe(4);
    for (const text of texts) expect(text).not.toBe('');
    expect(describePageGate(decidePageGate(CASES['content-share']!))).toContain('zh-CN');
    expect(describePageGate(decidePageGate(CASES.declaration!))).toContain('zh-CN');
  });
});

describe('同一级给出两种结论时，依据相同', () => {
  test('全页占比：到阈值拦下、不到照常翻译，依据都是 content-share', () => {
    const blocked = decidePageGate(CASES['content-share']!);
    const passed = decidePageGate({ ...CASES['content-share']!, contentLang: reliable(['en', 52], ['zh', 43]) });
    expect(blocked).toMatchObject({ translate: false, basis: 'content-share' });
    expect(passed).toEqual({ translate: true, basis: 'content-share' });
  });

  test('链条：声明是目标语言拦下、是外文照常翻译、引擎报告的检测语言判出，依据都是 declaration', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'en' })).toEqual({
      translate: true,
      basis: 'declaration',
    });
    expect(decidePageGate({ to: 'zh-CN', detectedLang: 'zh-CN', pageLang: 'en' })).toMatchObject({
      translate: false,
      basis: 'declaration',
    });
    // 样本太短、没送去识别（#859）：同样走链条
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN', contentLang: null })).toMatchObject({
      translate: false,
      basis: 'declaration',
    });
  });

  test('放行：识别器拿不准、送去识别却没拿到结果、链条判不出，依据都是 pass', () => {
    expect(
      decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN', contentLang: CONTENT_UNDETERMINED }),
    ).toEqual({ translate: true, basis: 'pass' });
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: null })).toEqual({
      translate: true,
      basis: 'pass',
    });
  });
});

describe('整页开关入口：依据随结果带出，并交给调用方记到控制台', () => {
  function items(texts: string[]): TranslateItem<number>[] {
    return texts.map((text, i) => ({ text, ctx: i }));
  }
  const ZH = items([
    '风格秀 风格排版 风格设计',
    '采用风格排版后需替换文案内容，以免遇到公众号原创保护问题',
    '排版完成后记得在手机上预览一遍，确认图片与段落间距都正常再发布',
    '如果文章里引用了别人的内容，请在文末注明出处，并附上原文链接',
  ]);

  function setup(pageLang: string | null, detect?: (s: string) => Promise<ContentLang | null>) {
    const send = vi.fn(async (req: { texts: string[] }) => ({
      ok: true,
      data: { translations: req.texts.map((t) => `[译] ${t}`) },
    }));
    const decisions: PageGateDecision[] = [];
    const orch = createOrchestrator({
      send,
      getPageLang: () => pageLang,
      hasTranslated: () => false,
      pushStatus: () => {},
      onGateDecision: (d: PageGateDecision) => decisions.push(d),
      ...(detect ? { detectContentLang: detect } : {}),
    } as Parameters<typeof createOrchestrator>[0]);
    orch.start();
    return { orch, send, decisions };
  }

  test('拦下：结果里的判定带依据，调用方收到同一个判定，零请求', async () => {
    const a = setup('en', async () => reliable(['zh', 96]));
    const ra = await a.orch.togglePage(ZH, 'auto', 'zh-CN');
    expect(ra.status).toBe('same-language');
    expect(ra.gate).toMatchObject({ translate: false, basis: 'content-share' });
    expect(a.decisions).toEqual([ra.gate]);
    expect(a.send).not.toHaveBeenCalled();
    a.orch.stop();

    const b = setup('zh-CN');
    const rb = await b.orch.togglePage(ZH, 'auto', 'zh-CN');
    expect(rb.gate).toMatchObject({ translate: false, basis: 'declaration' });
    expect(b.decisions).toEqual([rb.gate]);
    b.orch.stop();
  });

  test('照常翻译：结果与改动前相同（没有 gate），调用方照样收到带依据的判定', async () => {
    const { orch, send, decisions } = setup('zh-CN', async () => ({ ...reliable(['en', 60]), reliable: false }));
    const result = await orch.togglePage(ZH, 'auto', 'zh-CN');
    expect(result.status).toBe('translated');
    expect(result.gate).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(decisions).toEqual([{ translate: true, basis: 'pass' }]);
    orch.stop();
  });
});
