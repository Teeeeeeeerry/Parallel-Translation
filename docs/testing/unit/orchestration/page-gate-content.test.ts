/**
 * orchestration/page-gate.ts — 闸门以本地内容识别为准（#843，规格 #831）
 *
 * 判定链的第一级是本地内容识别：浏览器自带的语言识别对翻译单元样本给出的
 * 各语言占比，作为一项输入显式传入。识别可靠时只看它 —— 目标语言的占比
 * 达到阈值才拦下，否则照常翻译，不再回头看声明；识别器拿不准（报不可靠、
 * 被调用却没给出结果）时照常翻译（#889）；没有做识别（未注入、样本太短）
 * 时回落到检测语言 → 声明 → 判不出放行。
 */
import { describe, test, expect } from 'vitest';
import {
  decidePageGate,
  CONTENT_SHARE_THRESHOLD,
  CONTENT_UNDETERMINED,
  type ContentLang,
} from '~/src/orchestration/page-gate';

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});
const unreliable = (...languages: [string, number][]): ContentLang => ({
  ...reliable(...languages),
  reliable: false,
});

const BLOCK_ZH = { translate: false, reason: 'same-language', lang: 'zh-CN' };
const PASS = { translate: true };

describe('内容识别可靠时只看它，声明退到后面（#843）', () => {
  test('声明是目标语言、内容大半是外文（Steam 中文界面加英文介绍）：照常翻译', () => {
    // 实测（#851，docs/research/page-gate-content-share.md）：Steam Path of Exile 2
    // 以中文界面打开，声明 zh-cn，识别器给出 en 52、zh 41，可靠
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['en', 52], ['zh', 41]),
      }),
    ).toEqual(PASS);
  });

  test('声明是外文、内容其实是目标语言：拦下', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', 96], ['en', 4]),
      }),
    ).toEqual(BLOCK_ZH);
    expect(
      decidePageGate({
        to: 'ja',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['ja', 100]),
      }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'ja' });
  });

  test('没有声明、内容是目标语言：拦下（以前判不出会放行）', () => {
    expect(
      decidePageGate({
        to: 'en',
        detectedLang: null,
        pageLang: null,
        contentLang: reliable(['en', 100]),
      }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'en' });
  });

  test('内容识别也盖过引擎报告的检测语言', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: 'zh-CN',
        pageLang: 'zh-CN',
        contentLang: reliable(['en', 90], ['zh', 10]),
      }),
    ).toEqual(PASS);
  });

  test('内容是第三种语言（既不是声明也不是目标）：照常翻译', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['ja', 100]),
      }),
    ).toEqual(PASS);
  });

  test('识别结果里的语言码畸形：不算任何语言', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['und', 90], ['zh', 10]),
      }),
    ).toEqual(PASS);
  });
});

describe('“绝大部分是目标语言”的阈值（#843）', () => {
  test(`阈值暂定 ${CONTENT_SHARE_THRESHOLD}`, () => {
    // 依据是 #851 在真实页面上的实测（docs/research/page-gate-content-share.md）。
    // 实测里两类页面交叉，单一占比阈值分不开，数值暂不动，原因见 page-gate.ts
    // 的注释；更稳的判据见 #883
    expect(CONTENT_SHARE_THRESHOLD).toBe(65);
  });

  test('目标语言占比恰好在阈值上：拦下；差 1 就照常翻译', () => {
    const at = CONTENT_SHARE_THRESHOLD;
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', at], ['en', 100 - at]),
      }),
    ).toEqual(BLOCK_ZH);
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', at - 1], ['en', 101 - at]),
      }),
    ).toEqual(PASS);
  });

  test('目标语言分在几个条目里（带与不带地区）：占比相加再比', () => {
    expect(
      decidePageGate({
        to: 'en',
        detectedLang: null,
        pageLang: 'de',
        contentLang: reliable(['en', 50], ['en-GB', 40], ['de', 10]),
      }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'en' });
  });

  // 下面四条的数都取自 #851 的实测记录（docs/research/page-gate-content-share.md），
  // 是实测里识别器报可靠、且现行阈值判对了的页面里离阈值最近的几张

  test('中文页面夹成块的英文新闻与评语（Steam 已有中文介绍）：仍然拦下', () => {
    // Steam Dwarf Fortress：介绍正文是中文，开发者新闻与媒体评语是英文，zh 74、en 17
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['zh', 74], ['en', 17]),
      }),
    ).toEqual(BLOCK_ZH);
  });

  test('中文页面夹零星外文词，声明是外文（GitHub 中文 README）：拦下', () => {
    // GitHub ruanyf/weekly：声明 en，zh 94、en 1
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', 94], ['en', 1]),
      }),
    ).toEqual(BLOCK_ZH);
  });

  test('中文界面加成块英文介绍、中文略多（Steam 英文介绍的游戏）：照常翻译', () => {
    // Steam Lethal Company：声明 zh-cn，识别器按字节算，中文界面一个字算三份，
    // 所以中文略多：zh 53、en 42
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['zh', 53], ['en', 42]),
      }),
    ).toEqual(PASS);
  });

  test('中文界面加英文评论（App Store 美区）：照常翻译', () => {
    // App Store Notion：声明 zh-Hans-CN，介绍已本地化、评论是英文，en 52、zh 43
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-Hans-CN',
        contentLang: reliable(['en', 52], ['zh', 43]),
      }),
    ).toEqual(PASS);
  });
});

describe('识别拿不准：照常翻译，不回落到声明（#889，取代 #865）', () => {
  test('识别器说不可靠、声明是目标语言：照常翻译（实测里被误拦的那 5 张外文页的形状）', () => {
    // #851 实测：YouTube、Cursor 论坛话题列表、Amazon、Steam ULTRAKILL 以中文界面
    // 打开，声明是 zh，识别器对样本报不可靠。以前回落到声明就整页拦下
    // Amazon MacBook Pro：声明 zh-cn，en 51、zh 39，不可靠
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: unreliable(['en', 51], ['zh', 39]),
      }),
    ).toEqual(PASS);
    // YouTube Never Gonna Give You Up 第一遍：zh 64、en 20，不可靠
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-Hans-CN',
        contentLang: unreliable(['zh', 64], ['en', 20]),
      }),
    ).toEqual(PASS);
  });

  test('识别器说不可靠时，引擎报告的检测语言也不再拿来顶上', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: 'zh-CN',
        pageLang: 'zh-CN',
        contentLang: unreliable(['zh', 99]),
      }),
    ).toEqual(PASS);
  });

  test('识别器说不可靠、声明是外文：照常翻译（与改动前相同）', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: unreliable(['zh', 100]),
      }),
    ).toEqual(PASS);
  });

  test('识别器被调用却没给出结果（出错、超时）：与拿不准同等对待，照常翻译', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: CONTENT_UNDETERMINED,
      }),
    ).toEqual(PASS);
  });

  test('可靠但一个语言都没给：同样当拿不准，照常翻译', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(),
      }),
    ).toEqual(PASS);
  });
});

describe('没有做识别：走现有链条，结果与改动前一致（#843、#859）', () => {
  test('识别不可用（null 或缺省）：按检测语言 → 声明 → 判不出放行', () => {
    for (const contentLang of [null, undefined]) {
      expect(
        decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN', contentLang }),
      ).toEqual(BLOCK_ZH);
      expect(
        decidePageGate({ to: 'zh-CN', detectedLang: 'en', pageLang: 'zh-CN', contentLang }),
      ).toEqual(PASS);
      expect(
        decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: null, contentLang }),
      ).toEqual(PASS);
    }
  });
});

describe('繁简不算同语言（#790）在内容识别下保持', () => {
  // Chrome 的识别器对简体、繁体都只报 zh，分不出繁简。内容是中文时，繁简
  // 取自现有链条里的中文变体；链条里没有中文，才按裸 zh 归一化成简体
  test('内容是中文、声明是繁体、目标是简体：照常翻译（与改动前相同）', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-TW',
        contentLang: reliable(['zh', 100]),
      }),
    ).toEqual(PASS);
  });

  test('内容是中文、引擎报告繁体、目标是简体：照常翻译', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: 'zh-TW',
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', 100]),
      }),
    ).toEqual(PASS);
  });

  test('内容是中文、声明是繁体、目标是繁体：拦下', () => {
    expect(
      decidePageGate({
        to: 'zh-TW',
        detectedLang: null,
        pageLang: 'zh-Hant',
        contentLang: reliable(['zh', 100]),
      }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'zh-TW' });
  });

  test('识别器自己给出了繁简（带子段）：以它为准', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh-TW', 100]),
      }),
    ).toEqual(PASS);
  });

  test('内容大半是外文时，繁简不影响放行', () => {
    expect(
      decidePageGate({
        to: 'zh-TW',
        detectedLang: null,
        pageLang: 'zh-TW',
        contentLang: reliable(['en', 70], ['zh', 30]),
      }),
    ).toEqual(PASS);
  });
});
