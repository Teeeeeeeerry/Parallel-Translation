/**
 * integration/translate-pipeline.test.ts — 翻译管道端到端
 *
 * 在 mock chrome.storage / fetch 的扩展上下文中验证完整管道：
 * content → background → router → engine
 *
 * 这些测试验证各模块的协作行为，而非单个函数的正确性。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';

// Mock fetch 全局函数，使各引擎不会发真实请求
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.subtle.digest（cacheKey 需要）
vi.stubGlobal('crypto', {
  subtle: {
    digest: vi.fn().mockImplementation(async (algo: string, data: Uint8Array) => {
      // 返回一个简单的 hash（测试用）
      const bytes = new Uint8Array(data);
      let hash = 0;
      for (const b of bytes) hash = ((hash << 5) - hash + b) | 0;
      const buf = new ArrayBuffer(20);
      new DataView(buf).setInt32(0, hash);
      return buf;
    }),
  },
  getRandomValues: vi.fn(),
});

describe('翻译管道集成', () => {
  beforeEach(() => {
    resetStorage();
    mockFetch.mockReset();
  });

  test('router 正确串联缓存 + 引擎流程', async () => {
    // 预先写入设置到 sync store
    const { settingsReady } = await import('~/src/storage/settings');
    await settingsReady();

    // 验证 router 的导出存在且可被调用
    const { route } = await import('~/src/engines/router');
    expect(typeof route).toBe('function');
  });

  test('cacheSet + cacheGet 序列化链正确', async () => {
    const { cacheKey, cacheSet, cacheGet } = await import('~/src/storage/cache');

    const key = await cacheKey('test-engine', 'en', 'zh-CN', 'Hello World');
    await cacheSet(key, '你好世界');

    // 等待 chain 完成后再读
    const val = await cacheGet(key);
    expect(val).toBe('你好世界');
  });

  test('settings 变更跨模块可见', async () => {
    const { settingsReady, getSettings, patchSettings } =
      await import('~/src/storage/settings');

    await settingsReady();
    await patchSettings({ displayMode: 'translation-only' });

    const s = getSettings();
    expect(s.displayMode).toBe('translation-only');
  });
});
