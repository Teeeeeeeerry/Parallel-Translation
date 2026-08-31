/**
 * engines/test-connection.ts — 设置页测试连接单测（#322）
 *
 * openai / deepl 的测试连接统一走探测入口后：
 * - 401 与 403 在两家引擎上都被报告为 key 问题（此前 openai 只查 401、
 *   deepl 只查 403，另一个状态码被显示成裸 HTTP 错误码）
 * - 429 被报告为配额问题
 * - 成功 / 其余非 2xx 保持既有文案形态
 * - DeepL 免费版（:fx）与专业版端点区分不变
 */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { testConnection } from '~/src/engines/test-connection';

vi.mock('~/src/storage/keys', () => ({
  getKey: vi.fn(),
}));

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6, models: {} })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 让下一个探测请求返回指定状态码。 */
function respond(status: number, body?: string): void {
  fetchMock.mockResolvedValue(new Response(body ?? 'err', { status }));
}

describe('testConnection（openai / deepl，#322）', () => {
  test('openai 401 与 403 都报告为 key 问题', async () => {
    for (const status of [401, 403]) {
      respond(status);
      const result = await testConnection('openai', 'sk-test');
      expect(result.ok).toBe(false);
      expect(result.msg).toBe('API key 无效');
    }
  });

  test('deepl 401 与 403 都报告为 key 问题', async () => {
    for (const status of [401, 403]) {
      respond(status);
      const result = await testConnection('deepl', 'k');
      expect(result.ok).toBe(false);
      expect(result.msg).toBe('API key 无效');
    }
  });

  test('openai 与 deepl 的 429 都报告为配额问题', async () => {
    for (const engine of ['openai', 'deepl'] as const) {
      respond(429);
      const result = await testConnection(engine, 'k');
      expect(result.ok).toBe(false);
      expect(result.msg).toBe('配额已用尽');
    }
  });

  test('5xx 报告为裸 HTTP 错误码（瞬时）', async () => {
    respond(503);
    const result = await testConnection('openai', 'sk-test');
    expect(result.ok).toBe(false);
    expect(result.msg).toBe('HTTP 503');
  });

  test('连接成功返回 ok 且文案为连接成功', async () => {
    respond(200);
    const result = await testConnection('openai', 'sk-test');
    expect(result.ok).toBe(true);
    expect(result.msg).toBe('连接成功');
  });

  test('凭据以请求头传递，不进查询串', async () => {
    respond(200);
    await testConnection('openai', 'sk-test');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).not.toContain('sk-test');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    );
  });

  test('DeepL 免费版 key（:fx 结尾）走 free 端点，专业版走正式端点', async () => {
    respond(200);
    await testConnection('deepl', 'k:fx');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api-free.deepl.com/v2/usage',
    );

    respond(200);
    await testConnection('deepl', 'k');
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://api.deepl.com/v2/usage',
    );
  });

  test('网络错误报告为瞬时故障', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await testConnection('deepl', 'k');
    expect(result.ok).toBe(false);
    expect(result.msg).not.toBe('API key 无效');
    expect(result.msg).not.toMatch(/^HTTP /);
  });
});

describe('testConnection（gemini，#323）', () => {
  test('模型名填错时报告模型名问题而非 key 问题（修复前失败）', async () => {
    respond(
      400,
      JSON.stringify({
        error: { code: 400, message: 'models/wrong-model is not found', status: 'NOT_FOUND' },
      }),
    );
    const result = await testConnection('gemini', 'k', 'wrong-model');
    expect(result.ok).toBe(false);
    // 不是 key 问题：文案不得以「API key 无效」开头
    expect(result.msg).not.toMatch(/^API key 无效/);
    // 报告真实原因：包含模型名信息
    expect(result.msg).toContain('wrong-model');
  });

  test('key 确实失效（401）时报告 key 问题', async () => {
    respond(401);
    const result = await testConnection('gemini', 'k');
    expect(result.ok).toBe(false);
    expect(result.msg).toBe('API key 无效');
  });

  test('错误体明示认证失败（400）时报告 key 问题', async () => {
    respond(
      400,
      JSON.stringify({
        error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' },
      }),
    );
    const result = await testConnection('gemini', 'k');
    expect(result.ok).toBe(false);
    expect(result.msg).toBe('API key 无效');
  });

  test('配额耗尽报告为配额问题', async () => {
    respond(
      429,
      JSON.stringify({ error: { code: 429, message: 'quota exceeded', status: 'RESOURCE_EXHAUSTED' } }),
    );
    const result = await testConnection('gemini', 'k');
    expect(result.ok).toBe(false);
    expect(result.msg).toBe('配额已用尽');
  });

  test('服务端瞬时故障报告为可重试而非 key 问题', async () => {
    respond(503);
    const result = await testConnection('gemini', 'k');
    expect(result.ok).toBe(false);
    expect(result.msg).toBe('HTTP 503');
  });

  test('探测结论与实际翻译对同一响应一致（400 认证体：两者都归 key 无效）', async () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' },
    });
    // 每次调用新建 Response —— 响应体只能消费一次，探测与翻译各拿一份
    fetchMock.mockImplementation(async () => new Response(body, { status: 400 }));
    const probe = await testConnection('gemini', 'k');

    // 同一响应驱动真实翻译路径
    const { getKey } = await import('~/src/storage/keys');
    vi.mocked(getKey).mockResolvedValue('k');
    const { gemini } = await import('~/src/engines/gemini');
    let translateCategory = '';
    try {
      await gemini.translate({ texts: ['a'], from: 'auto', to: 'zh' });
    } catch (e) {
      translateCategory = (e as { category: string }).category;
    }
    expect(translateCategory).toBe('invalid-key');
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.msg).toBe('API key 无效');
  });

  test('探测请求带模型名且 key 走请求头不进查询串', async () => {
    respond(200);
    await testConnection('gemini', 'k', 'gemini-2.0-flash');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash',
    );
    expect(String(url)).not.toContain('k');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });
});
