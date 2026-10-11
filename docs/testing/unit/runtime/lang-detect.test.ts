/**
 * runtime/lang-detect.ts — 浏览器自带的本地语言识别（#852，规格 #831）
 *
 * 同一个识别能力原来在 content 里有两份实现：输入翻译的同语言判断（#661）
 * 只要单一可靠结果，页面级闸门的取样（#843）要各语言占比与可靠标志。这里
 * 把它们并成一个模块，浏览器接口经注入，替身模拟回调、lastError 与抛错。
 */
import { describe, test, expect, vi } from 'vitest';
import { createLangDetector, type LangDetectApi } from '~/src/runtime/lang-detect';

type Raw = chrome.i18n.LanguageDetectionResult | undefined;

/** 识别接口的替身：回调同步给出 result，lastError 在回调期间可见。 */
function fakeApi(result: Raw, lastError?: { message: string }): LangDetectApi & { calls: string[] } {
  const calls: string[] = [];
  let current: { message: string } | undefined;
  return {
    calls,
    detectLanguage: (text, cb) => {
      calls.push(text);
      current = lastError;
      cb(result as chrome.i18n.LanguageDetectionResult);
      current = undefined;
    },
    lastError: () => current,
  };
}

const raw = (isReliable: boolean, ...languages: [string, number][]): Raw => ({
  isReliable,
  languages: languages.map(([language, percentage]) => ({ language, percentage })),
});

describe('单一可靠结果（输入翻译，#661）', () => {
  test('可靠：给出第一个语言', async () => {
    const api = fakeApi(raw(true, ['ja', 90], ['en', 10]));
    await expect(createLangDetector(api).reliableLang('こんにちは')).resolves.toBe('ja');
    expect(api.calls).toEqual(['こんにちは']);
  });

  test('不可靠：为 null', async () => {
    const api = fakeApi(raw(false, ['ja', 90]));
    await expect(createLangDetector(api).reliableLang('x')).resolves.toBeNull();
  });

  test('可靠但一个语言都没给：为 null', async () => {
    await expect(createLangDetector(fakeApi(raw(true))).reliableLang('x')).resolves.toBeNull();
  });

  test('lastError、没有结果、接口抛错：都为 null', async () => {
    const withError = fakeApi(raw(true, ['ja', 100]), { message: 'boom' });
    await expect(createLangDetector(withError).reliableLang('x')).resolves.toBeNull();
    await expect(createLangDetector(fakeApi(undefined)).reliableLang('x')).resolves.toBeNull();
    const throwing: LangDetectApi = {
      detectLanguage: () => {
        throw new Error('no i18n');
      },
      lastError: () => undefined,
    };
    await expect(createLangDetector(throwing).reliableLang('x')).resolves.toBeNull();
  });
});

describe('各语言占比与可靠标志（页面级闸门，#843）', () => {
  test('原样给出占比与可靠标志，可靠与否都给', async () => {
    const reliable = fakeApi(raw(true, ['en', 52], ['zh', 41]));
    await expect(createLangDetector(reliable).distribution('sample')).resolves.toEqual({
      reliable: true,
      languages: [
        { lang: 'en', percentage: 52 },
        { lang: 'zh', percentage: 41 },
      ],
    });
    expect(reliable.calls).toEqual(['sample']);
    await expect(
      createLangDetector(fakeApi(raw(false, ['zh', 65]))).distribution('x'),
    ).resolves.toEqual({ reliable: false, languages: [{ lang: 'zh', percentage: 65 }] });
  });

  test('lastError、没有结果、接口抛错：都为 null', async () => {
    const withError = fakeApi(raw(true, ['zh', 100]), { message: 'boom' });
    await expect(createLangDetector(withError).distribution('x')).resolves.toBeNull();
    await expect(createLangDetector(fakeApi(undefined)).distribution('x')).resolves.toBeNull();
    const throwing: LangDetectApi = {
      detectLanguage: vi.fn(() => {
        throw new Error('no i18n');
      }),
      lastError: () => undefined,
    };
    await expect(createLangDetector(throwing).distribution('x')).resolves.toBeNull();
  });
});
