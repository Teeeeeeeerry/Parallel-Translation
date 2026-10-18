/**
 * 建 context 的分步计时（#1061）
 *
 * e2e 夹具建 context 偶发把整条用例的 180 秒全耗光，报错只有一句“setting up
 * context 超时”，看不出卡在哪一步。SetupTimeline 给每一步记开始时刻与耗时、
 * 各自一个上限：哪一步超了上限就报哪一步、等了多久，连同前面各步的耗时。
 * 这里只断言失败信息里有没有这些，不断言毫秒数。
 */
import { describe, test, expect } from 'vitest';
import { SetupTimeline, SetupStepError } from '../../e2e/setup-steps';

const never = () => new Promise<never>(() => {});
const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe('建 context 的分步计时（#1061）', () => {
  test('每一步都按时完成：返回各步的结果，时间线里按顺序记下每一步', async () => {
    const t = new SetupTimeline();
    expect(await t.step('清 profile', 1_000, () => 1)).toBe(1);
    expect(await t.step('启动浏览器', 1_000, () => after(5, 'ctx'))).toBe('ctx');
    expect(t.report()).toMatch(/清 profile \d+ms.*启动浏览器 \d+ms/s);
  });

  test('某一步一直不返回：在它自己的上限报错，指出是哪一步、等了多久，带上前面各步的耗时', async () => {
    const t = new SetupTimeline();
    await t.step('清 profile', 1_000, () => undefined);
    const started = Date.now();
    const err = await t.step('等欢迎页', 50, never).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(err).toBeInstanceOf(SetupStepError);
    const e = err as SetupStepError;
    expect(e.step).toBe('等欢迎页');
    expect(e.timedOut).toBe(true);
    expect(e.elapsedMs).toBeGreaterThanOrEqual(45);
    expect(e.message).toContain('“等欢迎页”');
    expect(e.message).toMatch(/等了 \d+ 毫秒（上限 50 毫秒）/);
    expect(e.message).toMatch(/清 profile \d+ms/);
  });

  test('某一步自己抛错：同样指出是哪一步，原错误挂在 cause 上，不算超时', async () => {
    const t = new SetupTimeline();
    const boom = new Error('browserType.launchPersistentContext: Target closed');
    const err = (await t.step('启动浏览器', 1_000, () => Promise.reject(boom)).catch((e: unknown) => e)) as SetupStepError;
    expect(err).toBeInstanceOf(SetupStepError);
    expect(err.step).toBe('启动浏览器');
    expect(err.timedOut).toBe(false);
    expect(err.cause).toBe(boom);
    expect(err.message).toContain('Target closed');
  });

  test('超时之后计时器不留在事件循环里：按时完成的步骤不挂着它自己的上限', async () => {
    const t = new SetupTimeline();
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await t.step('关扩展页', 60_000, () => undefined);
    const now = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    expect(now).toBe(before);
  });
});
