/**
 * orchestration/page-gate.ts — 存在够长的外文单元就照常翻译（#891，父 #883）
 *
 * 判据看翻译单元里有没有一块够长的外文正文，而不只看全页占比：单元级识别的
 * 结果（每个被识别的单元：字数、语言、可靠标记）作为一项输入显式传入。有这样
 * 的外文块就照常翻译；没有、且目标语言占优才拦下。送去识别的只是按文字长度
 * 排在最前面的若干个单元，个数与文字量都有上限。
 *
 * 用例里的数取自 #851 与 #890 的实测记录（docs/research/page-gate-content-share.md、
 * docs/research/page-gate-longest-units.md）。
 */
import { describe, test, expect } from 'vitest';
import {
  decidePageGate,
  longestUnitTexts,
  FOREIGN_BLOCK_MIN_CHARS,
  UNIT_DETECT_COUNT,
  UNIT_DETECT_MAX_CHARS,
  type ContentLang,
  type UnitLang,
} from '~/src/orchestration/page-gate';

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});
const unit = (chars: number, lang: string | null, isReliable = true): UnitLang => ({
  chars,
  letters: chars,
  lang,
  reliable: isReliable,
});

const BLOCK_ZH = { translate: false, reason: 'same-language', lang: 'zh-CN' };
const PASS = { translate: true };

describe('存在够长的外文单元：照常翻译', () => {
  test('中文界面加一大段英文介绍，全页占比却是中文占优：照常翻译', () => {
    // 形状取自 Steam ULTRAKILL（#890）：最长的单元是 1455 字符的英文介绍。
    // 全页占比给成中文占优、可靠 —— 占比按字节算，中文界面一个字算三份，
    // 换一批界面文字就可能这样；有外文块时不再看占比
    const input = {
      to: 'zh-CN',
      detectedLang: null,
      pageLang: 'zh-cn',
      contentLang: reliable(['zh', 70], ['en', 25]),
    };
    expect(decidePageGate(input)).toMatchObject(BLOCK_ZH);
    expect(
      decidePageGate({
        ...input,
        contentUnits: [unit(1455, 'en'), unit(179, 'en'), unit(92, 'zh')],
      }),
    ).toMatchObject(PASS);
  });

  test('外文块盖过语言声明与检测语言', () => {
    // 没有做全页识别（contentLang 缺省）时也一样
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: 'zh-CN',
        pageLang: 'zh-CN',
        contentUnits: [unit(530, 'en')],
      }),
    ).toMatchObject(PASS);
  });

  test('外文是目标语言以外的任何语言（不只是英文）', () => {
    // Amazon AirPods 第一遍（#890）：最长的单元是 459 字符的西班牙语
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['zh', 70]),
        contentUnits: [unit(459, 'es')],
      }),
    ).toMatchObject(PASS);
  });

  test(`字数恰好到下限（${FOREIGN_BLOCK_MIN_CHARS}）就算外文块；差 1 个字符不算`, () => {
    const base = {
      to: 'zh-CN',
      detectedLang: null,
      pageLang: 'zh-CN',
      contentLang: reliable(['zh', 90], ['en', 5]),
    };
    expect(
      decidePageGate({ ...base, contentUnits: [unit(FOREIGN_BLOCK_MIN_CHARS, 'en')] }),
    ).toMatchObject(PASS);
    expect(
      decidePageGate({ ...base, contentUnits: [unit(FOREIGN_BLOCK_MIN_CHARS - 1, 'en')] }),
    ).toMatchObject(BLOCK_ZH);
  });
});

describe('没有够长的外文单元、且目标语言占优：拦下（#777 不回退）', () => {
  test('纯中文页面：最长的单元都是中文，全页占比中文占优，拦下', () => {
    // Rust 程序设计语言中文版“什么是所有权”（#851、#890）：声明 en，zh 95，
    // 最长的十个单元全是中文
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', 95]),
        contentUnits: [unit(319, 'zh'), unit(270, 'zh'), unit(244, 'zh'), unit(217, 'zh')],
      }),
    ).toMatchObject(BLOCK_ZH);
  });

  test('中文页面夹零星英文，外文单元都不到下限：拦下', () => {
    // GitHub ruanyf/weekly（#851、#890）：声明 en，zh 94，最长的外文单元 50 字符
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', 94], ['en', 1]),
        contentUnits: [unit(52, 'zh', false), unit(50, 'en'), unit(34, 'zh')],
      }),
    ).toMatchObject(BLOCK_ZH);
  });

  test('中文页面引一句英文、或带一行英文标题：不算外文块，拦下（#777 的同语言夹具，#892）', () => {
    // #777 的同语言夹具引了一句 78 字符的英文；#890 实测 YouTube 推荐栏的视频
    // 标题 64 到 99 字符。一句引文、一行标题都不是成块的外文正文
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', 88], ['en', 9]),
        contentUnits: [unit(160, 'zh'), unit(99, 'en'), unit(78, 'en')],
      }),
    ).toMatchObject(BLOCK_ZH);
  });

  test('够长的单元识别器说不可靠：不算外文块', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', 80]),
        contentUnits: [unit(900, 'en', false)],
      }),
    ).toMatchObject(BLOCK_ZH);
  });

  test('够长的单元识别拿不到语言：不算外文块', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', 80]),
        contentUnits: [unit(900, null, false), unit(900, null)],
      }),
    ).toMatchObject(BLOCK_ZH);
  });

  test('够长的单元是目标语言所在的那种语言（识别器只报 zh，分不出繁简）：不算外文块', () => {
    expect(
      decidePageGate({
        to: 'zh-TW',
        detectedLang: null,
        pageLang: 'zh-TW',
        contentLang: reliable(['zh', 90]),
        contentUnits: [unit(700, 'zh'), unit(400, 'zh-TW')],
      }),
    ).toMatchObject({ translate: false, reason: 'same-language', lang: 'zh-TW' });
  });

  test('没有单元级识别结果（null、缺省、空列表）：与改动前一致', () => {
    for (const contentUnits of [null, undefined, []]) {
      expect(
        decidePageGate({
          to: 'zh-CN',
          detectedLang: null,
          pageLang: 'en',
          contentLang: reliable(['zh', 95]),
          contentUnits,
        }),
      ).toMatchObject(BLOCK_ZH);
      expect(
        decidePageGate({
          to: 'zh-CN',
          detectedLang: null,
          pageLang: 'zh-CN',
          contentLang: reliable(['en', 60], ['zh', 30]),
          contentUnits,
        }),
      ).toMatchObject(PASS);
    }
  });
});

describe('送去单元级识别的单元：按文字长度取最前面的若干个，个数与文字量有上限', () => {
  /** n 个段落，长度各不相同（都到下限），另夹一些短的界面文字。 */
  function page(n: number): string[] {
    const texts: string[] = [];
    for (let i = 0; i < n; i++) {
      texts.push('Lorem ipsum dolor sit amet. '.repeat(3 + (i % 50)));
      texts.push('商店');
    }
    return texts;
  }

  test('个数不超过上限，且不随单元数增长', () => {
    for (const n of [200, 800, 3200]) {
      expect(longestUnitTexts(page(n))).toHaveLength(UNIT_DETECT_COUNT);
    }
  });

  test('送去识别的总字数不随单元数增长：每个单元截到上限', () => {
    const totals = [200, 800, 3200].map((n) =>
      longestUnitTexts(page(n)).reduce((sum, u) => sum + u.text.length, 0),
    );
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBeLessThanOrEqual(UNIT_DETECT_COUNT * UNIT_DETECT_MAX_CHARS);
  });

  test('取的是最长的那几个，字数报的是全文长度而不是截过的长度', () => {
    const long = 'A'.repeat(UNIT_DETECT_MAX_CHARS * 2);
    const texts = ['商店', 'x'.repeat(FOREIGN_BLOCK_MIN_CHARS), long, 'y'.repeat(FOREIGN_BLOCK_MIN_CHARS + 50)];
    const picked = longestUnitTexts(texts);
    expect(picked.map((u) => u.chars)).toEqual([
      UNIT_DETECT_MAX_CHARS * 2,
      FOREIGN_BLOCK_MIN_CHARS + 50,
      FOREIGN_BLOCK_MIN_CHARS,
    ]);
    expect(picked[0]!.text).toHaveLength(UNIT_DETECT_MAX_CHARS);
    expect(picked[0]!.text).toBe(long.slice(0, UNIT_DETECT_MAX_CHARS));
  });

  test('不到外文块下限的单元不送去识别：它们成不了外文块', () => {
    const texts = ['商店', '社区', 'x'.repeat(FOREIGN_BLOCK_MIN_CHARS - 1), 'y'.repeat(FOREIGN_BLOCK_MIN_CHARS)];
    expect(longestUnitTexts(texts).map((u) => u.chars)).toEqual([FOREIGN_BLOCK_MIN_CHARS]);
    expect(longestUnitTexts(['商店', '登录'])).toEqual([]);
  });

  test('字数按去掉首尾空白之后算', () => {
    const picked = longestUnitTexts(['   ' + 'z'.repeat(FOREIGN_BLOCK_MIN_CHARS) + '\n\n']);
    expect(picked).toEqual([
      {
        chars: FOREIGN_BLOCK_MIN_CHARS,
        letters: FOREIGN_BLOCK_MIN_CHARS,
        text: 'z'.repeat(FOREIGN_BLOCK_MIN_CHARS),
      },
    ]);
  });

  test('上限取值：前 10 个、每个前 1000 字符（依据 #890）', () => {
    expect(UNIT_DETECT_COUNT).toBe(10);
    expect(UNIT_DETECT_MAX_CHARS).toBe(1000);
  });

  test('外文块的字数下限取值：245（依据 #890，外文页里成块外文正文的最小值）', () => {
    expect(FOREIGN_BLOCK_MIN_CHARS).toBe(245);
  });
});
