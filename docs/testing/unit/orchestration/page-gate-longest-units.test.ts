/**
 * orchestration/page-gate.ts — 最长的若干个单元都可靠地识别成目标语言就拦下（#903，父 #898）
 *
 * 没有外文块时，不再只看全页样本：按文字长度取最长的 LONGEST_UNITS_COUNT 个
 * 单元，全部是识别器报可靠的目标语言就拦下。证据不足就交给后面的链条（全页
 * 占比、识别拿不准放行、声明）：单元数不够、任何一个不可靠、任何一个不是
 * 目标语言，都不拦。单元级识别结果显式传入，不调真实识别器。
 *
 * 用例里的形状取自 #902 的实测记录（docs/research/page-gate-top-units-target.md）。
 */
import { describe, test, expect } from 'vitest';
import {
  decidePageGate,
  describePageGate,
  LONGEST_UNITS_COUNT,
  CONTENT_UNDETERMINED,
  type ContentLang,
  type PageGateInput,
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

// 维基“长城”（#902）：全页 zh 99、识别器报不可靠；最长的十个单元全是可靠的 zh
const WIKI: PageGateInput = {
  to: 'zh-CN',
  detectedLang: null,
  pageLang: 'zh-Hans-CN',
  contentLang: { ...reliable(['zh', 99]), reliable: false },
  contentUnits: [unit(711, 'zh'), unit(542, 'zh'), unit(472, 'zh'), unit(457, 'zh'), unit(402, 'zh')],
};

const BLOCK = { translate: false, reason: 'same-language', lang: 'zh-CN', basis: 'longest-units' };

describe('最长的若干个单元都可靠地识别成目标语言：拦下', () => {
  test('全页识别拿不准时，单元级证据足够就拦下，依据是 longest-units', () => {
    expect(decidePageGate({ ...WIKI, contentUnits: null })).toEqual({ translate: true, basis: 'pass' });
    expect(decidePageGate(WIKI)).toEqual(BLOCK);
  });

  test('全页占比不到阈值时也一样（这一级在全页占比之前）', () => {
    // 中文页夹大量英文书名，全页 zh 64 可靠：占比不到 65，单元级证据足够就拦下
    const input = { ...WIKI, pageLang: 'en', contentLang: reliable(['zh', 64], ['en', 9]) };
    expect(decidePageGate({ ...input, contentUnits: [] })).toEqual({ translate: true, basis: 'content-share' });
    expect(decidePageGate(input)).toEqual(BLOCK);
  });

  test('没有做全页识别时也看单元级证据', () => {
    expect(decidePageGate({ ...WIKI, pageLang: 'en', contentLang: null })).toEqual(BLOCK);
  });

  test('只看最长的那几个：按字数排，与传进来的顺序无关；更短的单元是外文、不可靠都不影响', () => {
    const units = [unit(30, 'en'), unit(457, 'zh'), unit(12, null, false), unit(711, 'zh'), unit(542, 'zh')];
    expect(decidePageGate({ ...WIKI, contentUnits: units })).toEqual(BLOCK);
  });

  test(`取数是 ${LONGEST_UNITS_COUNT} 个（依据 #902）`, () => {
    expect(LONGEST_UNITS_COUNT).toBe(3);
  });

  test('可读的说明里看得出是这一级', () => {
    const text = describePageGate(decidePageGate(WIKI));
    expect(text).toContain('longest-units');
    expect(text).toContain('zh-CN');
  });
});

describe('证据不足就不拦，交给后面的链条', () => {
  // 全页识别拿不准：后面的链条给出“放行”，这样不拦就看得出来
  const base = { ...WIKI, contentLang: CONTENT_UNDETERMINED };
  const PASS = { translate: true, basis: 'pass' };

  test('每一种情形：单元数不够、有一个不可靠、有一个不是目标语言、有一个拿不到语言', () => {
    const cases: Record<string, UnitLang[]> = {
      单元数不够: [unit(711, 'zh'), unit(542, 'zh')],
      没有单元: [],
      有一个不可靠: [unit(711, 'zh'), unit(542, 'zh', false), unit(472, 'zh')],
      // 不是目标语言的那个不到外文块下限，否则外文块那一级先放行
      有一个不是目标语言: [unit(711, 'zh'), unit(542, 'zh'), unit(200, 'ja')],
      有一个拿不到语言: [unit(711, 'zh'), unit(542, null, false), unit(472, 'zh')],
    };
    for (const [name, contentUnits] of Object.entries(cases)) {
      expect(decidePageGate({ ...base, contentUnits }), name).toEqual(PASS);
    }
    expect(decidePageGate({ ...base, contentUnits: null })).toEqual(PASS);
  });

  test('实测里仍放行的形状：justjavac 最长的两个单元报不可靠，交给全页占比', () => {
    // #902：100 ceb?、84 sq?、83 zh ……；全页 zh 64 可靠
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'en',
        contentLang: reliable(['zh', 64], ['en', 9]),
        contentUnits: [unit(100, 'ceb', false), unit(84, 'sq', false), unit(83, 'zh'), unit(70, 'en', false)],
      }),
    ).toEqual({ translate: true, basis: 'content-share' });
  });

  test('外文页：最长的单元是外文正文，不拦（外文块那一级先放行）', () => {
    // Steam Lethal Company（#902）
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-cn',
        contentLang: reliable(['zh', 52], ['en', 42]),
        contentUnits: [unit(1520, 'en'), unit(193, 'en'), unit(92, 'zh', false), unit(80, 'en')],
      }),
    ).toEqual({ translate: true, basis: 'foreign-block' });
  });

  test('外文页没有外文块：最长的几个是外文标题，不拦', () => {
    // YouTube 大模型入门第二遍（#902）：80 en、79 en、76 en ……，全页不可靠
    expect(
      decidePageGate({
        to: 'zh-CN',
        detectedLang: null,
        pageLang: 'zh-Hans-CN',
        contentLang: { ...reliable(['en', 65], ['zh', 15]), reliable: false },
        contentUnits: [unit(80, 'en'), unit(79, 'en'), unit(76, 'en'), unit(74, 'en')],
      }),
    ).toEqual(PASS);
  });
});

describe('繁简不算同语言（#790）', () => {
  test('识别器只报 zh：页面声明繁体、目标是简体时照常翻译，这一级判出的是 zh-TW', () => {
    expect(
      decidePageGate({ ...WIKI, pageLang: 'zh-TW', contentLang: CONTENT_UNDETERMINED }),
    ).toEqual({ translate: true, basis: 'longest-units' });
  });

  test('目标是繁体、页面声明繁体：拦下，判出的是 zh-TW', () => {
    expect(
      decidePageGate({ ...WIKI, to: 'zh-TW', pageLang: 'zh-TW', contentLang: CONTENT_UNDETERMINED }),
    ).toEqual({ ...BLOCK, lang: 'zh-TW' });
  });

  test('非中文目标语言：最长的单元都是可靠的目标语言就拦下', () => {
    expect(
      decidePageGate({
        to: 'ja',
        detectedLang: null,
        pageLang: 'en',
        contentLang: CONTENT_UNDETERMINED,
        contentUnits: [unit(400, 'ja'), unit(300, 'ja'), unit(200, 'ja')],
      }),
    ).toEqual({ ...BLOCK, lang: 'ja' });
  });
});
