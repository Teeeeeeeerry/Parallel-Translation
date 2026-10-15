/**
 * 免 key 引擎真实端点冒烟的判定口径（#1022）
 *
 * 经 probe() 断言：给一个假 fetch，看判成通过、记录还是失败。被限流不等于挂了：
 * 429、408、5xx、超时只记录；404、410、DNS 失败、200 但结构变了才判失败。
 * 另外对照引擎模块真正发出的地址，探测地址跟着引擎走，不会各说各话。
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { PROBES, probe, formatResult, type EngineProbe } from '~/scripts/check-engines';

vi.mock('~/src/storage/settings', () => ({
  getSettings: vi.fn(() => ({ maxConcurrency: 6 })),
  onSettingsChanged: vi.fn(() => () => {}),
}));

const bing = PROBES.find((p) => p.engine === 'bing-edge')!;
const google = PROBES.find((p) => p.engine === 'google-web')!;

const reply = (status: number, body = '') =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
const json = (v: unknown) => JSON.stringify(v);

const BING_OK = json([{ translations: [{ text: '你好世界' }] }]);
const GOOGLE_OK = json([[['你好世界', 'Hello world', null, null]], null, 'en']);

describe('判定口径（#1022）', () => {
  test.each([404, 410, 400, 401, 403, 405])('HTTP %i → 失败', async (status) => {
    expect((await probe(bing, reply(status))).verdict).toBe('fail');
  });

  test.each([429, 408, 500, 502, 503])('HTTP %i → 只记录，不判失败', async (status) => {
    expect((await probe(google, reply(status))).verdict).toBe('soft');
  });

  test('DNS 解析不了 → 失败', async () => {
    const dns = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    const r = await probe(bing, dns);
    expect(r).toMatchObject({ verdict: 'fail', status: null });
    expect(r.detail).toContain('ENOTFOUND');
  });

  test('超时 → 只记录，不判失败', async () => {
    const slow = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect((await probe(google, slow)).verdict).toBe('soft');
  });

  test('200 且结构对得上 → 通过', async () => {
    expect((await probe(bing, reply(200, BING_OK))).verdict).toBe('ok');
    expect((await probe(google, reply(200, GOOGLE_OK))).verdict).toBe('ok');
  });

  test('200 但结构变了（鉴权流程或返回格式换了）→ 失败', async () => {
    // 例如端点改成先发令牌：200 回来的是一段纯文本 JWT
    expect((await probe(bing, reply(200, 'eyJhbGciOi.payload.sig'))).verdict).toBe('fail');
    expect((await probe(bing, reply(200, json({ token: 'x' })))).verdict).toBe('fail');
    expect((await probe(google, reply(200, json({ sentences: [] })))).verdict).toBe('fail');
  });

  test('失败信息点名引擎、步骤与状态码', async () => {
    const line = formatResult(await probe(bing, reply(404, 'Not Found')));
    expect(line).toContain('bing-edge');
    expect(line).toContain('翻译请求');
    expect(line).toContain('HTTP 404');
    expect(line).toContain('失败');
  });
});

describe('探测地址跟着引擎模块走（#1022）', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function engineUrl(load: () => Promise<{ translate: (r: never) => Promise<unknown> }>, ok: string) {
    const f = vi.fn(async (_url: string) => new Response(ok, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const engine = await load();
    await engine.translate({ texts: ['Hello world'], from: 'en', to: 'zh-CN' } as never);
    const u = new URL(String(f.mock.calls[0]![0]));
    return `${u.origin}${u.pathname}`;
  }
  const pathOf = (p: EngineProbe) => {
    const u = new URL(p.url);
    return `${u.origin}${u.pathname}`;
  };

  test('bing-edge', async () => {
    const url = await engineUrl(async () => (await import('~/src/engines/bing-edge')).bingEdge, BING_OK);
    expect(pathOf(bing)).toBe(url);
  });

  test('google-web', async () => {
    const url = await engineUrl(async () => (await import('~/src/engines/google-web')).googleWeb, GOOGLE_OK);
    expect(pathOf(google)).toBe(url);
  });

  test('每个免 key 引擎都有探测', async () => {
    const { ENGINE_CATALOG, isByokEngine } = await import('~/src/storage/schema');
    const free = ENGINE_CATALOG.filter((e) => !isByokEngine(e)).map((e) => e.id).sort();
    expect(PROBES.map((p) => p.engine).sort()).toEqual(free);
  });
});
