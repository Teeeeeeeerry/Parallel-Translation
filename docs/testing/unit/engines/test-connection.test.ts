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
