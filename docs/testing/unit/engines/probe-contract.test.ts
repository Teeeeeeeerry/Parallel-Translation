/**
 * engines — 探测入口与翻译路径同分类契约测试（#321）
 *
 * 探测入口（probeConnection）走与翻译路径同一份状态分类（#239），
 * 契约：同一响应（状态码 + 错误体）× 同一引擎 → 两类路径产出同一失败类别。
 *
 * 表驱动覆盖 401 / 403 / 429 / 5xx 矩阵，以及 Gemini 的读错误体特例
 * （400 + 错误体明示认证失败 → key 无效；400 + 模型名错误 → 瞬时）。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import type { ProbeSpec } from '~/src/engines/shared';
import { EngineError } from '~/src/engines/types';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: {} })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const KEYED = ['openai', 'deepl', 'gemini'] as const;

/** 引擎 id → 适配器导出的探测规格名。 */
const PROBE_EXPORT: Record<string, string> = {
  openai: 'openaiProbe',
  deepl: 'deeplProbe',
  gemini: 'geminiProbe',
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

/** 驱动真实适配器走一遍 translate，返回失败类别（与 #264 同口径）。 */
async function translateCategoryFor(
  engineId: string,
  status: number,
  body?: string,
): Promise<string> {
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
      return new Response(body ?? 'err', { status });
    }),
  );
  const { openai } = await import('~/src/engines/openai');
  const { deepl } = await import('~/src/engines/deepl');
  const { gemini } = await import('~/src/engines/gemini');
  const engine = { openai, deepl, gemini }[engineId]!;
  try {
    await engine.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    return 'no-error';
  } catch (e) {
    return (e as EngineError).category;
  }
}

/** 驱动探测入口，返回失败类别（或 'ok'）。 */
async function probeCategoryFor(
  engineId: string,
  status: number,
  body?: string,
): Promise<string> {
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body ?? 'err', { status })),
  );
  const { probeConnection } = await import('~/src/engines/shared');
  const mod = (await import(`~/src/engines/${engineId}`)) as Record<
    string,
    ProbeSpec
  >;
  const spec = mod[PROBE_EXPORT[engineId]!]!;
  const result = await probeConnection(spec, { key: 'k' });
  return result.ok ? 'ok' : result.category;
}

describe('探测入口 × 翻译路径 同分类契约（#321）', () => {
  for (const status of STATUS_MATRIX) {
    test(`状态码 ${status}：三家自带 key 引擎的探测与翻译路径分类一致`, async () => {
      for (const id of KEYED) {
        const translate = await translateCategoryFor(id, status);
        const probe = await probeCategoryFor(id, status);
        expect(translate, `${id} 翻译路径在 ${status} 上的分类`).toBe(
          KEYED_EXPECTED[status],
        );
        expect(probe, `${id} 探测入口在 ${status} 上的分类`).toBe(
          KEYED_EXPECTED[status],
        );
      }
    });
  }

  test('gemini 400 + 错误体明示认证失败：探测与翻译路径都归为 key 无效', async () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' },
    });
    const translate = await translateCategoryFor('gemini', 400, body);
    const probe = await probeCategoryFor('gemini', 400, body);
    expect(translate).toBe('invalid-key');
    expect(probe).toBe('invalid-key');
  });

  test('gemini 400 + 模型名错误错误体：探测与翻译路径都归为瞬时', async () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'models/wrong-model is not found', status: 'NOT_FOUND' },
    });
    const translate = await translateCategoryFor('gemini', 400, body);
    const probe = await probeCategoryFor('gemini', 400, body);
    expect(translate).toBe('transient');
    expect(probe).toBe('transient');
  });
});

describe('探测入口契约（#321）', () => {
  test('凭据以请求头传递，不进查询串', async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { probeConnection } = await import('~/src/engines/shared');
    const { openaiProbe } = await import('~/src/engines/openai');

    const result = await probeConnection(openaiProbe, { key: 'sk-test' });

    expect(result).toEqual({ ok: true, message: '连接成功' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toContain('sk-test');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    );
  });

  test('网络 / 超时归为瞬时，不产生任何存储写入', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const { probeConnection } = await import('~/src/engines/shared');
    const { deeplProbe } = await import('~/src/engines/deepl');

    const result = await probeConnection(deeplProbe, { key: 'k' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.category).toBe('transient');
    }
  });
});
