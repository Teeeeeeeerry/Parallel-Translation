/**
 * engines/byok.ts — 自带 key 引擎公共构造骨架测试（#333）
 *
 * 验证骨架顺序与契约：
 * - 闸门包裹整个请求体（含取 key）：并发超限时第二个请求等待，
 *   取 key 也发生在闸门内
 * - 缺 key 时不发请求，抛不可重试的 key 无效类错误
 * - 成功：请求构造 → 公共分类 → 响应解析（适配器只留端点/头/体/解析）
 * - 失败分类走公共判定：401/403 → key 无效、429 → 配额、5xx → 瞬时
 * - 适配器 classifyError 特例优先于公共分类
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createByokEngine } from '~/src/engines/byok';
import type { ByokEngineSpec } from '~/src/engines/byok';
import { EngineError } from '~/src/engines/types';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 1 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

/** 最小适配器：原样回显第 0 条文本。 */
function makeSpec(overrides: Partial<ByokEngineSpec> = {}): ByokEngineSpec {
  return {
    id: 'openai',
    displayName: 'Test',
    supportedLangs: 'all',
    buildRequest: ({ texts }, key) => ({
      url: 'https://example.com/translate',
      headers: { Authorization: `Bearer ${key}` },
      body: JSON.stringify({ text: texts[0] }),
    }),
    parseResponse: (data) => ({
      translations: [(data as { text: string }).text],
    }),
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ text: '你好' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function withKey(key: string | undefined): Promise<void> {
  const { getKey } = await import('~/src/storage/keys');
  vi.mocked(getKey).mockResolvedValue(key as never);
}

describe('createByokEngine 骨架（#333）', () => {
  test('成功：请求构造（端点/头/体）与响应解析按适配器执行', async () => {
    await withKey('sk-test');
    const engine = createByokEngine(makeSpec());
    const result = await engine.translate({
      texts: ['Hello'],
      from: 'auto',
      to: 'zh',
    });

    expect(result.translations).toEqual(['你好']);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://example.com/translate');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    );
    expect(JSON.parse(String(init.body))).toEqual({ text: 'Hello' });
    // 路由面：引擎对象满足 TranslateEngine interface（requiresKey 等）
    expect(engine).toMatchObject({
      id: 'openai',
      requiresKey: true,
      supportedLangs: 'all',
    });
  });

  test('缺 key：不发请求，抛不可重试的 key 无效类错误', async () => {
    await withKey(undefined);
    const engine = createByokEngine(makeSpec());

    await expect(
      engine.translate({ texts: ['Hello'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({
      engineId: 'openai',
      retryable: false,
      category: 'invalid-key',
      message: '未配置 API key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('闸门包裹整个请求体（含取 key）：并发超限时第二个请求等待', async () => {
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k' as never);
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((r) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight--;
            r(
              new Response(JSON.stringify({ text: '你好' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          });
        }),
    );

    const engine = createByokEngine(makeSpec());
    const p1 = engine.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    const p2 = engine.translate({ texts: ['b'], from: 'auto', to: 'zh' });

    // 等待第一个请求进入在飞状态（轮询，避免 waitFor 与闸门时序耦合）
    for (let i = 0; i < 100 && inFlight < 1; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(inFlight).toBe(1);
    // maxConcurrency=1：第二个请求被闸门挡住，未触达 fetch
    await new Promise((r) => setTimeout(r, 20));
    expect(inFlight).toBe(1);
    expect(maxInFlight).toBe(1);

    // 释放第一个在飞请求 —— 闸门放行第二个后才发出其 fetch
    for (const release of resolvers) release();
    for (let i = 0; i < 100 && resolvers.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    for (const release of resolvers) release();
    await Promise.all([p1, p2]);
    expect(maxInFlight).toBe(1);
  });

  test('失败分类走公共判定：401/403 → key 无效、429 → 配额、5xx → 瞬时', async () => {
    await withKey('k');
    const engine = createByokEngine(makeSpec());
    const cases: Array<[number, string]> = [
      [401, 'invalid-key'],
      [403, 'invalid-key'],
      [429, 'quota'],
      [500, 'transient'],
    ];
    for (const [status, category] of cases) {
      fetchMock.mockResolvedValue(new Response('err', { status }));
      await expect(
        engine.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
      ).rejects.toMatchObject({
        engineId: 'openai',
        category,
        retryable: category === 'transient',
      });
    }
  });

  test('适配器 classifyError 特例优先于公共分类', async () => {
    await withKey('k');
    // 400 + 错误体明示认证失败 → 适配器特例归为 key 无效
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { status: 'UNAUTHENTICATED', message: 'API key not valid' },
        }),
        { status: 400 },
      ),
    );
    const engine = createByokEngine(
      makeSpec({
        classifyError: async (resp) => {
          const body = (await resp.json()) as { error?: { status?: string } };
          if (body.error?.status === 'UNAUTHENTICATED') {
            return new EngineError('openai', false, 'API key 无效', 'invalid-key');
          }
          return null;
        },
      }),
    );

    await expect(
      engine.translate({ texts: ['a'], from: 'auto', to: 'zh' }),
    ).rejects.toMatchObject({
      category: 'invalid-key',
      message: 'API key 无效',
    });
  });

  test('模型名经 spec.model 提供并传入 buildRequest', async () => {
    await withKey('k');
    const model = vi.fn(() => 'gpt-4o');
    const buildRequest = vi.fn((req: unknown, key: string, m?: string) => ({
      url: 'https://example.com',
      headers: {},
      body: JSON.stringify({ key, model: m }),
    }));
    const engine = createByokEngine(makeSpec({ model, buildRequest }));

    await engine.translate({ texts: ['a'], from: 'auto', to: 'zh' });

    expect(model).toHaveBeenCalled();
    expect(buildRequest).toHaveBeenCalledWith(
      expect.anything(),
      'k',
      'gpt-4o',
    );
  });
});
