/**
 * orchestration/page-gate.ts — 闸门以本地内容识别为准（#843，规格 #831）
 *
 * 判定链的第一级是本地内容识别：浏览器自带的语言识别对翻译单元样本给出的
 * 各语言占比，作为一项输入显式传入。识别可靠时只看它 —— 目标语言的占比
 * 达到阈值才拦下，否则照常翻译，不再回头看声明；不可靠或拿不到时回落到
 * 检测语言 → 声明 → 判不出放行。
 */
import { describe, test, expect } from 'vitest';
import {
  decidePageGate,
  CONTENT_SHARE_THRESHOLD,
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
    // 量自 Chrome 的 i18n.detectLanguage：content-foreign 夹具的单元样本给出 en 76、zh 23；
    // 另一份 Steam 形状的样本（导航更多、介绍更短）给出 en 61、zh 38
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['en', 61], ['zh', 38]),
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
});

describe('“绝大部分是目标语言”的阈值（#843）', () => {
  test(`阈值暂定 ${CONTENT_SHARE_THRESHOLD}`, () => {
    // #831 的初值 80 在真实样本上分不开纯中文模板页（zh 75）与中英各半的页面
    // （zh 49），按量出的数取 65，见 page-gate.ts 的注释
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

  test('#777 那种纯中文页面夹一段英文引文：仍然拦下', () => {
    // 量自 Chrome 的 i18n.detectLanguage：same-language 夹具的单元样本给出 zh 75、en 24
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['zh', 75], ['en', 24]),
      }),
    ).toEqual(BLOCK_ZH);
  });

  test('中英段落交错、各占一半：照常翻译', () => {
    // 量自 Chrome 的 i18n.detectLanguage：mixed-language 夹具（TC-E2E-154）给出 en 50、zh 49
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(['en', 50], ['zh', 49]),
      }),
    ).toEqual(PASS);
  });
});

describe('识别拿不准或拿不到：回落到现有链条，结果与改动前一致（#843）', () => {
  test('识别器说不可靠：不看它，按声明', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: unreliable(['en', 100]),
      }),
    ).toEqual(BLOCK_ZH);
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: unreliable(['zh', 100]),
      }),
    ).toEqual(PASS);
  });

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

  test('可靠但一个语言都没给：当作拿不到', () => {
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-CN',
        contentLang: reliable(),
      }),
    ).toEqual(BLOCK_ZH);
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
