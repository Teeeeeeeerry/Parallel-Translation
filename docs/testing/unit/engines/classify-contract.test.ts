/**
 * engines — 跨引擎分类契约测试（#264）
 *
 * 同一状态码 × 五家引擎 → 同一分类口径，不一致即红 —— #161 式分歧
 * 在 CI 被抓住。契约 = classifyStatus 公共口径（#239）：
 * - 自带 key 引擎（openai / deepl / gemini）：401/403 → invalid-key、
 *   429 → quota、其余非 2xx → transient
 * - 免 key 引擎（google-web / bing-edge）：一律 transient
 *
 * 经各适配器的真实 translate 路径断言（mock fetch 返回指定状态码），
 * 表驱动覆盖 401 / 403 / 429 / 5xx 矩阵。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import type { TranslateEngine } from '~/src/engines/types';
import { EngineError } from '~/src/engines/types';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: {} })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const KEYED = ['openai', 'deepl', 'gemini'] as const;
const KEYLESS = ['google-web', 'bing-edge'] as const;

/** 引擎 id → 模块导出名（google-web → googleWeb 等）。 */
const EXPORT_NAME: Record<string, string> = {
  openai: 'openai',
  deepl: 'deepl',
  gemini: 'gemini',
  'google-web': 'googleWeb',
  'bing-edge': 'bingEdge',
};

/** keyed 类引擎的公共口径（#239）。 */
const KEYED_EXPECTED: Record<number, string> = {
  401: 'invalid-key',
  403: 'invalid-key',
  429: 'quota',
  500: 'transient',
  503: 'transient',
};

const STATUS_MATRIX = [401, 403, 429, 500, 503];

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 驱动真实适配器走一遍 translate，返回失败类别。
 * fetch mock：bing-edge 的 auth 端点返回 200，其余端点返回指定状态码。
 */
async function categoryFor(engineId: string, status: number): Promise<string> {
  vi.resetModules();
  const { getKey } = await import('~/src/storage/keys');
  vi.mocked(getKey).mockResolvedValue('k');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('edge.microsoft.com/translate/auth')) {
        return new Response('jwt-token', { status: 200 });
      }
      return new Response('err', { status });
    }),
  );
  const mod = (await import(`~/src/engines/${engineId}`)) as Record<
    string,
    TranslateEngine
  >;
  const engine = mod[EXPORT_NAME[engineId]!]!;
  try {
    await engine.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    return 'no-error';
  } catch (e) {
    return (e as EngineError).category;
  }
}

describe('跨引擎分类契约（#264）', () => {
  for (const status of STATUS_MATRIX) {
    test(`状态码 ${status}：五家引擎分类一致（keyed 类按公共口径，非 keyed 类瞬时）`, async () => {
      const results: Record<string, string> = {};
      for (const id of [...KEYED, ...KEYLESS]) {
        results[id] = await categoryFor(id, status);
      }
      // keyed 类：401/403 → invalid-key、429 → quota、5xx → transient
      for (const id of KEYED) {
        expect(results[id], `${id} 在 ${status} 上的分类`).toBe(
          KEYED_EXPECTED[status],
        );
      }
      // 非 keyed 类：一律瞬时（bing-edge 401 会话失效仍可重试）
      for (const id of KEYLESS) {
        expect(results[id], `${id} 在 ${status} 上的分类`).toBe('transient');
      }
    });
  }
});
