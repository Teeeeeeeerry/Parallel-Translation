/**
 * orchestration/page-gate.ts — 页面级判定 单元测试（#777）
 *
 * 整页翻译开始前先问一句这一页是什么语言，与目标语言相同就不翻。判定是
 * 纯函数，目标语言、检测语言、页面语言声明全部显式传入；断言返回的结论
 * 与原因。
 */
import { describe, test, expect, vi } from 'vitest';
import { decidePageGate } from '~/src/orchestration/page-gate';
import { createOrchestrator } from '~/src/orchestration/orchestrator';

describe('decidePageGate — 页面语言与目标语言比对（#788）', () => {
  test('页面语言与目标语言相同：不翻，带原因与判出的页面语言', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-CN' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
  });

  test('不同：照常翻译', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'en' })).toEqual({
      translate: true,
    });
    expect(decidePageGate({ to: 'en', detectedLang: null, pageLang: 'ja' })).toEqual({
      translate: true,
    });
  });

  test('比对在归一化之后做：声明带地区、大小写不同仍算同一种语言', () => {
    expect(decidePageGate({ to: 'en', detectedLang: null, pageLang: 'EN-us' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'en',
    });
    expect(decidePageGate({ to: 'ja', detectedLang: null, pageLang: 'ja_JP' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'ja',
    });
  });
});

describe('判不出页面语言时放行照翻（#789）', () => {
  // 与输入翻译相反：输入翻译判不出对方语言时不猜（ADR-0005），阅读方向判不出
  // 页面语言时照翻。这组用例钉住这条取舍，不要反向改成“判不出就不翻”
  test('没有检测语言，也没有语言声明：照常翻译', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: null })).toEqual({
      translate: true,
    });
  });

  test('声明为空、畸形或不指具体语言（und、mul、zxx）：照常翻译', () => {
    for (const pageLang of ['', '  ', 'chinese', 'x', 'und', 'mul', 'zxx']) {
      expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang })).toEqual({
        translate: true,
      });
    }
  });

  test('检测语言认不出（畸形或 und）、声明也没有：照常翻译', () => {
    for (const detectedLang of ['123', 'und', '']) {
      expect(decidePageGate({ to: 'en', detectedLang, pageLang: null })).toEqual({
        translate: true,
      });
    }
  });

  test('判得出且与目标语言不同：照常翻译（不命中的那一半）', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'fr' })).toEqual({
      translate: true,
    });
  });
});

describe('繁简不算同语言（#790）', () => {
  // 口径是 #691 那套：normalizeLangCode 把中文按文字与地区分成 zh-TW 与 zh-CN
  test('繁体页面、简体目标：照常翻译', () => {
    for (const pageLang of ['zh-TW', 'zh-Hant', 'zh-HK', 'zh-MO', 'zh_Hant_TW']) {
      expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang })).toEqual({
        translate: true,
      });
    }
  });

  test('简体页面、繁体目标：照常翻译', () => {
    for (const pageLang of ['zh-CN', 'zh', 'zh-Hans', 'zh-SG', 'zh-Hans-HK']) {
      expect(decidePageGate({ to: 'zh-TW', detectedLang: null, pageLang })).toEqual({
        translate: true,
      });
    }
  });

  test('引擎报告的检测语言是繁体、目标是简体：照常翻译', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: 'zh-Hant', pageLang: 'zh-CN' })).toEqual({
      translate: true,
    });
  });

  test('同为简体：不翻', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh-Hans' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
    expect(decidePageGate({ to: 'zh-CN', detectedLang: null, pageLang: 'zh' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
  });

  test('同为繁体：不翻', () => {
    expect(decidePageGate({ to: 'zh-TW', detectedLang: null, pageLang: 'zh-Hant-HK' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-TW',
    });
  });
});

describe('检测语言优先于页面的语言声明（#791）', () => {
  // 优先级由 pageLanguage（#782）实现，这里在页面级判定上钉死它
  test('两者都有且冲突：以检测语言为准 —— 声明写成 en 的中文站点照样判成中文', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: 'zh-CN', pageLang: 'en' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'zh-CN',
    });
  });

  test('两者都有且冲突、检测语言与目标不同：照常翻译，不因声明是目标语言而拦下', () => {
    expect(decidePageGate({ to: 'zh-CN', detectedLang: 'en', pageLang: 'zh-CN' })).toEqual({
      translate: true,
    });
  });

  test('检测语言认不出：回落到声明', () => {
    expect(decidePageGate({ to: 'en', detectedLang: 'und', pageLang: 'en-GB' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'en',
    });
  });

  test('只有声明：用声明', () => {
    expect(decidePageGate({ to: 'ja', detectedLang: null, pageLang: 'ja' })).toEqual({
      translate: false,
      reason: 'same-language',
      lang: 'ja',
    });
    expect(decidePageGate({ to: 'ja', detectedLang: null, pageLang: 'ko' })).toEqual({
      translate: true,
    });
  });

  test('都没有：放行照翻（#789）', () => {
    expect(decidePageGate({ to: 'ja', detectedLang: null, pageLang: null })).toEqual({
      translate: true,
    });
  });
});

describe('第一次点整页翻译时只有语言声明可用（#791）', () => {
  // 编排里的检测语言是从翻译响应里攒出来的，第一次整页翻译之前一定是 null。
  // 检测语言不是前置条件：此时闸门只看声明，不为拿检测语言先发探测请求
  test('还没翻过：检测语言为 null，判定按声明给出，一个请求都没发', () => {
    const send = vi.fn();
    const orch = createOrchestrator({ send } as Parameters<typeof createOrchestrator>[0]);
    orch.start();

    expect(orch.detectedLang()).toBeNull();
    expect(
      decidePageGate({ to: 'zh-CN', detectedLang: orch.detectedLang(), pageLang: 'zh-CN' }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    expect(
      decidePageGate({ to: 'zh-CN', detectedLang: orch.detectedLang(), pageLang: 'en' }),
    ).toEqual({ translate: true });
    expect(send).not.toHaveBeenCalled();
    orch.stop();
  });

  test('翻过一次、引擎报告了检测语言之后：检测语言盖过声明', async () => {
    const send = vi.fn(async () => ({
      ok: true,
      data: { translations: ['你好'], detectedFrom: 'zh-CN' },
    }));
    const orch = createOrchestrator({ send } as Parameters<typeof createOrchestrator>[0]);
    orch.start();
    await orch.translatePage([{ text: '你好', ctx: 0 }], 'auto', 'en');

    expect(
      decidePageGate({ to: 'zh-CN', detectedLang: orch.detectedLang(), pageLang: 'en' }),
    ).toEqual({ translate: false, reason: 'same-language', lang: 'zh-CN' });
    orch.stop();
  });
});
