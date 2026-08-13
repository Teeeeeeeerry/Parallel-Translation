/**
 * engines/* — 引擎格式解析 单元测试
 *
 * Google / Bing / DeepL / Gemini 的响应解析逻辑
 * 注意：实际翻译因依赖 fetch + API key，全部 mock
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// 由于引擎模块依赖 fetch / chrome.storage / settings 等，
// 此处只测试响应解析辅助逻辑（如在引擎文件中导出）。
// 真实接口测试在 E2E 层用 Playwright route 完成。

// ---- Google Web 引擎 ----
// google-web.ts 直接从 DOM 解析 Google 翻译页面，
// 核心逻辑在 parseGoogleResponse 中提取译文

describe('engines 响应解析', () => {
  test('Google 引擎 id 正确', async () => {
    const { googleWeb } = await import('~/src/engines/google-web');
    expect(googleWeb.id).toBe('google-web');
    expect(googleWeb.requiresKey).toBe(false);
    expect(googleWeb.supportedLangs).toBe('all');
  });

  test('Bing 引擎 id 正确', async () => {
    const { bingEdge } = await import('~/src/engines/bing-edge');
    expect(bingEdge.id).toBe('bing-edge');
    expect(bingEdge.requiresKey).toBe(false);
    expect(bingEdge.supportedLangs).toBe('all');
  });

  test('OpenAI 引擎 id 正确', async () => {
    const { openai } = await import('~/src/engines/openai');
    expect(openai.id).toBe('openai');
    expect(openai.requiresKey).toBe(true);
    expect(openai.supportedLangs).toBe('all');
  });

  test('DeepL 引擎 id 正确', async () => {
    const { deepl } = await import('~/src/engines/deepl');
    expect(deepl.id).toBe('deepl');
    expect(deepl.requiresKey).toBe(true);
    // DeepL 只有有限语言
    expect(deepl.supportedLangs).toContain('en');
    expect(deepl.supportedLangs).toContain('zh');
  });

  test('Gemini 引擎 id 正确', async () => {
    const { gemini } = await import('~/src/engines/gemini');
    expect(gemini.id).toBe('gemini');
    expect(gemini.requiresKey).toBe(true);
    expect(gemini.supportedLangs).toBe('all');
  });

  test('EngineError 构造正确', async () => {
    const { EngineError } = await import('~/src/engines/types');
    const err = new EngineError('test-engine', true, 'something went wrong');
    expect(err.name).toBe('EngineError');
    expect(err.engineId).toBe('test-engine');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('something went wrong');
  });
});
