/**
 * engines/router.ts — 路由与故障切换 单元测试
 *
 * 需要 mock storage/settings、storage/cache、各引擎模块
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---- Mock 设置模块 ----
vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({
    enginePriority: ['google-web', 'bing-edge'] as string[],
    useCache: true,
  })),
}));

// ---- Mock 缓存模块 ----
vi.mock('~/src/storage/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheKey: vi.fn().mockImplementation(
    async (engine: string, from: string, to: string, text: string) =>
      `pt-c:${engine}:${from}:${to}:mock-${text.slice(0, 10)}`,
  ),
}));

// ---- Mock 各引擎 ----
const mockGoogleTranslate = vi.fn();
const mockBingTranslate = vi.fn();

vi.mock('~/src/engines/google-web', () => ({
  googleWeb: {
    id: 'google-web',
    displayName: 'Google 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    translate: (...args: unknown[]) => mockGoogleTranslate(...args),
  },
}));

vi.mock('~/src/engines/bing-edge', () => ({
  bingEdge: {
    id: 'bing-edge',
    displayName: 'Bing 翻译',
    requiresKey: false,
    supportedLangs: 'all' as const,
    translate: (...args: unknown[]) => mockBingTranslate(...args),
  },
}));

vi.mock('~/src/engines/openai', () => ({
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    requiresKey: true,
    supportedLangs: 'all' as const,
    translate: vi.fn(),
  },
}));

vi.mock('~/src/engines/deepl', () => ({
  deepl: {
    id: 'deepl',
    displayName: 'DeepL',
    requiresKey: true,
    supportedLangs: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru'] as string[],
    translate: vi.fn(),
  },
}));

vi.mock('~/src/engines/gemini', () => ({
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    requiresKey: true,
    supportedLangs: 'all' as const,
    translate: vi.fn(),
  },
}));

import { route } from '~/src/engines/router';
import { getSettings } from '~/src/storage/settings';
import { cacheGet, cacheSet } from '~/src/storage/cache';
import { EngineError, AllEnginesFailedError } from '~/src/engines/types';

describe('route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleTranslate.mockReset();
    mockBingTranslate.mockReset();

    // 默认设置
    vi.mocked(getSettings).mockReturnValue({
      enginePriority: ['google-web', 'bing-edge'],
      useCache: true,
      enabled: true,
      from: 'auto',
      to: 'zh-CN',
      displayMode: 'bilingual',
      paraDisplayMode: 'follow',
      style: 'default',
      customCss: '',
      hotkeys: {} as never,
      siteList: { mode: 'blacklist', list: [] },
      showFloatingBall: true,
      showParagraphBtn: true,
      maxConcurrency: 6,
      models: {},
    });

    vi.mocked(cacheGet).mockResolvedValue(null);
  });

  test('按 enginePriority 顺序尝试引擎', async () => {
    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好', '世界'],
    });

    const resp = await route({
      texts: ['Hello', 'World'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好', '世界']);
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).not.toHaveBeenCalled();
  });

  test('第一个引擎成功 → 不调第二个', async () => {
    mockGoogleTranslate.mockResolvedValue({
      translations: ['第一'],
    });

    await route({
      texts: ['First'],
      from: 'en',
      to: 'zh-CN',
    });

    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).not.toHaveBeenCalled();
  });

  test('引擎不支持目标语言 → 跳过', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...vi.mocked(getSettings)(),
      enginePriority: ['deepl', 'google-web'],
    });

    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好'],
    });

    // DeepL 不支持 th，应被跳过
    const resp = await route({
      texts: ['Hello'],
      from: 'auto',
      to: 'th',
    });

    expect(resp.translations).toEqual(['你好']);
    // Google 被调用（DeepL 被跳过）
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
  });

  test('retryable=true 失败 → 切下一个引擎', async () => {
    mockGoogleTranslate.mockRejectedValue(
      new EngineError('google-web', true, 'Network error'),
    );
    mockBingTranslate.mockResolvedValue({
      translations: ['你好'],
    });

    const resp = await route({
      texts: ['Hello'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好']);
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).toHaveBeenCalledTimes(1);
  });

  test('retryable=false 失败 → 立即抛，不尝试后续', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...vi.mocked(getSettings)(),
      enginePriority: ['openai', 'google-web'],
    });

    // openai 的 requiresKey=true，实际错误由引擎抛出
    // 我们需要 mock openai 的 translate 抛出 non-retryable 错误
    const { openai } = await import('~/src/engines/openai');
    vi.mocked(openai.translate).mockRejectedValue(
      new EngineError('openai', false, 'API key 无效'),
    );

    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好'],
    });

    await expect(
      route({
        texts: ['Hello'],
        from: 'auto',
        to: 'zh-CN',
      }),
    ).rejects.toThrow();

    // Google 不应该被调用（openai 的 non-retryable 直接抛）
    expect(mockGoogleTranslate).not.toHaveBeenCalled();
  });

  test('全部引擎失败 → 错误消息列出所有失败原因', async () => {
    mockGoogleTranslate.mockRejectedValue(new Error('Google fail'));
    mockBingTranslate.mockRejectedValue(new Error('Bing fail'));

    await expect(
      route({
        texts: ['Hello'],
        from: 'auto',
        to: 'zh-CN',
      }),
    ).rejects.toThrow(/所有引擎均失败/);
  });

  test('全部引擎失败 → 显式类型化结果：瞬时、可重试（#237）', async () => {
    mockGoogleTranslate.mockRejectedValue(new Error('Google fail'));
    mockBingTranslate.mockRejectedValue(new Error('Bing fail'));

    try {
      await route({
        texts: ['Hello'],
        from: 'auto',
        to: 'zh-CN',
      });
      expect.unreachable('应抛出 AllEnginesFailedError');
    } catch (e) {
      const err = e as AllEnginesFailedError;
      expect(e).toBeInstanceOf(AllEnginesFailedError);
      expect(e).toBeInstanceOf(EngineError);
      expect(err.category).toBe('transient');
      expect(err.retryable).toBe(true);
      expect(err.invalidated).toBe(false);
      expect(err.aborted).toBe(false);
      // 携带各引擎原始失败
      expect(err.engineErrors.map((x) => x.engineId)).toEqual([
        'google-web',
        'bing-edge',
      ]);
    }
  });

  test('单引擎 non-retryable 失败 → 原样抛出不改写类别（#237）', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...vi.mocked(getSettings)(),
      enginePriority: ['openai', 'google-web'],
    });

    const { openai } = await import('~/src/engines/openai');
    vi.mocked(openai.translate).mockRejectedValue(
      new EngineError('openai', false, 'API key 无效', 'invalid-key'),
    );
    mockGoogleTranslate.mockResolvedValue({ translations: ['你好'] });

    try {
      await route({ texts: ['Hello'], from: 'auto', to: 'zh-CN' });
      expect.unreachable('应抛出 EngineError');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).category).toBe('invalid-key');
      expect((e as EngineError).retryable).toBe(false);
      // non-retryable 不尝试后续引擎
      expect(mockGoogleTranslate).not.toHaveBeenCalled();
    }
  });

  test('useCache=false → 跳过缓存查询', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...vi.mocked(getSettings)(),
      useCache: false,
    });

    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好'],
    });

    await route({
      texts: ['Hello'],
      from: 'auto',
      to: 'zh-CN',
    });

    // 缓存查询不应被调用
    expect(cacheGet).not.toHaveBeenCalled();
  });

  test('缓存全部命中 → 不调引擎，直接返回', async () => {
    vi.mocked(cacheGet).mockResolvedValue('你好');

    const resp = await route({
      texts: ['Hello'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好']);
    expect(mockGoogleTranslate).not.toHaveBeenCalled();
  });

  test('缓存部分命中 → 只请求未命中条目', async () => {
    // 第一条缓存命中，第二条不命中
    vi.mocked(cacheGet)
      .mockResolvedValueOnce('你好') // Hello 命中缓存
      .mockResolvedValueOnce(null); // World 不命中

    mockGoogleTranslate.mockResolvedValue({
      translations: ['世界'],
    });

    const resp = await route({
      texts: ['Hello', 'World'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好', '世界']);
    // 只请求了一个条目
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    const callReq = mockGoogleTranslate.mock.calls[0]![0];
    expect(callReq.texts).toEqual(['World']); // 只有未命中的
  });

  test('部分失败(failedIndices) → 失败槽位留给下一个引擎重试', async () => {
    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好', ''], // 第二条翻译失败
      failedIndices: [1],
    });
    mockBingTranslate.mockResolvedValue({
      translations: ['世界'],
    });

    const resp = await route({
      texts: ['Hello', 'World'],
      from: 'auto',
      to: 'zh-CN',
    });

    // 最终全部成功
    expect(resp.translations).toEqual(['你好', '世界']);
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).toHaveBeenCalledTimes(1);
    // Bing 只收到了失败的 slot
    const bingReq = mockBingTranslate.mock.calls[0]![0];
    expect(bingReq.texts).toEqual(['World']);
  });

  test('引擎返回短数组 → 不足槽位置 null 交给下一引擎补齐（#171）', async () => {
    // 请求 3 条，引擎只返回 1 条 —— 短出的槽位不能是 undefined
    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好'],
    });
    mockBingTranslate.mockResolvedValue({
      translations: ['世界', '再见'],
    });

    const resp = await route({
      texts: ['Hello', 'World', 'Bye'],
      from: 'auto',
      to: 'zh-CN',
    });

    // 全部补齐，无 undefined
    expect(resp.translations).toEqual(['你好', '世界', '再见']);
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).toHaveBeenCalledTimes(1);
    // Bing 只收到短出的 2 条
    const bingReq = mockBingTranslate.mock.calls[0]![0];
    expect(bingReq.texts).toEqual(['World', 'Bye']);
    // 短数组槽位不得写入缓存
    const cacheWrites = vi.mocked(cacheSet).mock.calls.map((c) => c[1]);
    expect(cacheWrites).not.toContain(undefined);
  });

  test('useCache=false 部分失败 → 下一引擎只补失败槽位，不覆盖已成功译文（#120）', async () => {
    vi.mocked(getSettings).mockReturnValue({
      enginePriority: ['google-web', 'bing-edge'],
      useCache: false,
      enabled: true,
      from: 'auto',
      to: 'zh-CN',
      displayMode: 'bilingual',
      paraDisplayMode: 'follow',
      style: 'default',
      customCss: '',
      hotkeys: {} as never,
      siteList: { mode: 'blacklist', list: [] },
      showFloatingBall: true,
      showParagraphBtn: true,
      maxConcurrency: 6,
      models: {},
    });
    // 修复前：非缓存路径不跳过已填充槽位 —— 下一引擎重翻全部并
    // 覆盖成功译文（TC-E2E-33 暴露）；修复后只补失败槽位
    mockGoogleTranslate.mockResolvedValue({
      translations: ['你好', '', '再见'],
      failedIndices: [1],
    });
    mockBingTranslate.mockResolvedValue({
      translations: ['世界'],
    });

    const resp = await route({
      texts: ['Hello', 'World', 'Bye'],
      from: 'auto',
      to: 'zh-CN',
    });

    expect(resp.translations).toEqual(['你好', '世界', '再见']);
    expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
    expect(mockBingTranslate).toHaveBeenCalledTimes(1);
    // Bing 只收到失败槽位，不得收到全部 3 条
    const bingReq = mockBingTranslate.mock.calls[0]![0];
    expect(bingReq.texts).toEqual(['World']);
  });
});
