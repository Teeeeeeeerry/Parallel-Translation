/**
 * engines/e2e-mock.ts — mock 包裹层单元测试（#135）
 *
 * 验证：描述符安装 / 幂等包裹、各类故障模式（failOnce / fail /
 * failTexts）、echoTargetLang、delayMs、非 Google URL 透传、
 * storage 自愈路径（ensureE2EMock）。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const G_URL =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh&q=Hello';
const OTHER_URL = 'https://example.com/x';

/** 本地 storage 替代实现（setup 的 set 不回调，applyE2EMock 会挂起） */
function installStorageStub(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  const area = chrome.storage.local as unknown as {
    get: (keys: string) => Promise<Record<string, unknown>>;
    set: (
      items: Record<string, unknown>,
      cb?: () => void,
    ) => Promise<void>;
  };
  area.get = vi.fn((keys: string) => Promise.resolve({ [keys]: store.get(keys) }));
  area.set = vi.fn((items: Record<string, unknown>, cb?: () => void) => {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
    cb?.();
    return Promise.resolve();
  });
  return store;
}

describe('e2e-mock', () => {
  let realFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installStorageStub();
    realFetch = vi.fn().mockResolvedValue(new Response('real', { status: 200 }));
    (self as unknown as { fetch: unknown }).fetch = realFetch;
  });

  afterEach(() => {
    // 注意：不能用 vi.unstubAllGlobals() —— 会连 setup.ts stub 的 chrome 一起清掉
    delete (self as unknown as { fetch?: unknown }).fetch;
  });

  test('未配置 mock → ensureE2EMock 不安装包裹层，请求透传', async () => {
    const { ensureE2EMock } = await import('~/src/engines/e2e-mock');
    await ensureE2EMock();
    const resp = await fetch(G_URL);
    expect(resp.status).toBe(200);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  test('applyE2EMock → Google URL 命中 mock，其他 URL 透传', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ prefix: '【译】' });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【译】Hello');
    expect(realFetch).not.toHaveBeenCalled();

    await fetch(OTHER_URL);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  test('failOnce：首次 500，之后自动恢复', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ failOnce: true });

    const r1 = await fetch(G_URL);
    expect(r1.status).toBe(500);
    const r2 = await fetch(G_URL);
    expect(r2.status).toBe(200);
    expect(getE2EMockStats().failOnceServed).toBe(1);
  });

  test('fail：全部请求 500，计数可断言', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ fail: true });

    const r1 = await fetch(G_URL);
    const r2 = await fetch(G_URL);
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(500);
    expect(getE2EMockStats().failServed).toBe(2);
  });

  test('failTexts：命中文本 500，其余正常', async () => {
    const { applyE2EMock, getE2EMockStats } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ failTexts: ['Hello'] });

    const bad = await fetch(G_URL);
    expect(bad.status).toBe(500);
    const ok = await fetch(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh&q=World',
    );
    expect(ok.status).toBe(200);
    expect(getE2EMockStats().failTextsServed).toBe(1);
  });

  test('echoTargetLang：响应带 [tl=] 标记', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ echoTargetLang: true });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【译】Hello [tl=zh]');
  });

  test('delayMs：响应延迟生效', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ delayMs: 60 });

    const t0 = Date.now();
    await fetch(G_URL);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  test('重复安装幂等：包裹层不叠加', async () => {
    const { applyE2EMock } = await import('~/src/engines/e2e-mock');
    await applyE2EMock({ prefix: 'A' });
    await applyE2EMock({ prefix: 'B' });

    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('BHello');
    expect(realFetch).not.toHaveBeenCalled();
  });

  test('ensureE2EMock：从 storage 读取描述符并安装（SW 自愈路径）', async () => {
    const { ensureE2EMock, applyE2EMock } = await import('~/src/engines/e2e-mock');
    // 模拟 fixture 已把描述符写入 storage
    await applyE2EMock({ prefix: '【存】' });
    // 模拟 SW 实例被替换：fetch 还原为真实 fetch，activeCfg 丢失
    delete (self as unknown as { fetch?: unknown }).fetch;
    (self as unknown as { fetch: unknown }).fetch = realFetch;

    await ensureE2EMock();
    const resp = await fetch(G_URL);
    const body = await resp.json();
    expect(body[0][0][0]).toBe('【存】Hello');
    expect(realFetch).not.toHaveBeenCalled();
  });
});
