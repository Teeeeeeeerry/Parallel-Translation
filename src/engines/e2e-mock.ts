// E2E 确定性 mock —— #90。
//
// fixtures.ts 通过 applyE2EMock 把 mock 描述符写入 chrome.storage.local；
// background 的翻译路由在每次路由前调用 ensureE2EMock 从 storage 读取
// 描述符并（重新）安装 fetch stub。
//
// 背景：若 mock 只做一次“在当前 SW 实例里替换 self.fetch”，实例一旦被
// Chrome 替换（崩溃、闲置回收、扩展更新），stub 随实例消失，后续翻译
// 直连真实 Google —— 本地偶然通过、CI 无外网必失败。#90 的 TC-E2E-22
// 无限滚动回归正是这一模式：初始翻译命中 mock，增量翻译绕过拦截直连。
//
// chrome.storage 是唯一跨实例持久的地方。mock 以“描述符 + 按需安装”
// 的形式随 SW 生命周期自愈；线上环境从不写入该键，读取为空直接返回，
// 无行为变化。

export interface E2EMockConfig {
  prefix?: string;
  fail?: boolean;
  /** 一次性故障：下一次翻译请求返回 500，随后自动恢复（测试专用）。 */
  failOnce?: boolean;
  /**
   * 指定文本的翻译请求返回 500（精确匹配 URL 的 q 参数）。
   * 用于部分失败用例：成功槽位走正常 mock，命中槽位交给下一引擎（#120）。
   */
  failTexts?: string[];
  /**
   * 响应中附带目标语言标记 `[tl=<to>]`，用于验证中途切换语言后
   * 新旧结果不混用（#120 TC-E2E-42）。
   */
  echoTargetLang?: boolean;
  /** 人工响应延迟（毫秒），制造在飞翻译窗口（#120 TC-E2E-42）。 */
  delayMs?: number;
}

const STORAGE_KEY = 'pt-e2e-mock';

/** 当前生效的 mock 配置。null = 无 mock（线上行为）。 */
let activeCfg: E2EMockConfig | null = null;

/** 已触发的一次性故障次数（测试断言用，防止 failOnce 失效导致假绿）。 */
let failOnceServed = 0;

/** 已触发的 fail:true 全量故障次数（测试断言用，防止 fail 失效导致假绿）。 */
let failServed = 0;

/** 已触发的 failTexts 命中次数（测试断言用，防止 failTexts 失效导致假绿）。 */
let failTextsServed = 0;

/** 测试探针：返回 mock 统计。 */
export function getE2EMockStats(): {
  failOnceServed: number;
  failServed: number;
  failTextsServed: number;
} {
  return { failOnceServed, failServed, failTextsServed };
}

/** mock 包裹层函数：带标记字段以便幂等安装 */
type MockFetch = ((input: any, init?: any) => Promise<Response>) & {
  __ptMockStubbed?: boolean;
};

/**
 * 安装 mock 包裹层。以“当前 fetch 是否已是 mock 层”为幂等判据，
 * 而不是模块布尔标志：fetch 被外力还原（SW 实例替换、测试模拟丢失）
 * 之后，下一次 ensureE2EMock 能重新包裹。
 */
function installStub(): void {
  const cur = (self as any).fetch as MockFetch | undefined;
  if (cur?.__ptMockStubbed) return;
  const realFetch = (cur ?? self.fetch).bind(self);
  const wrapper = (async (input: any, init?: any): Promise<Response> => {
    const cfg = activeCfg;
    if (!cfg) return realFetch(input, init);
    const url =
      typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
    if (!url.startsWith('https://translate.googleapis.com/')) {
      return realFetch(input, init);
    }
    const q = new URL(url).searchParams.get('q') ?? '';
    const tl = new URL(url).searchParams.get('tl') ?? '';
    if (cfg.failOnce) {
      // 一次性故障：只活在实例内存里（不持久化）。消费即清除 ——
      // 并发批次消息各自在路由前重读 storage 描述符，若 failOnce
      // 走持久化通道，读到的旧值会重新武装，一个请求变成多个 500。
      failOnceServed++;
      activeCfg = { ...activeCfg, failOnce: false };
      return new Response('Service Unavailable', { status: 500 });
    }
    if (cfg.fail) {
      failServed++;
      return new Response('Service Unavailable', { status: 500 });
    }
    // 部分失败：命中 failTexts 的文本请求返回 500，其余正常（#120 TC-E2E-33）
    if (cfg.failTexts?.includes(q)) {
      failTextsServed++;
      return new Response('Service Unavailable', { status: 500 });
    }
    if (cfg.delayMs) {
      await new Promise((resolve) => self.setTimeout(resolve, cfg.delayMs));
    }
    // 与真实端点同形：data[0] 是分句数组，每项 [0] 为译文。
    const suffix = cfg.echoTargetLang ? ` [tl=${tl}]` : '';
    const body = JSON.stringify([
      [[(cfg.prefix ?? '【译】') + q + suffix, '', null, null, 1]],
      null,
      'en',
    ]);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as MockFetch;
  wrapper.__ptMockStubbed = true;
  (self as any).fetch = wrapper;
}

/**
 * 翻译路由前调用：从 storage 读取 mock 描述符并安装。
 * 每次翻译都读 —— SW 实例被替换后，下一次翻译即恢复 mock。
 * 线上无此键：一次 storage.local.get，无其他开销。
 *
 * 尽力而为：mock 腿的任何失败都不得拖垮线上翻译 —— storage 读取异常
 * 时静默降级为直连真实端点。
 */
export async function ensureE2EMock(): Promise<void> {
  try {
    const { [STORAGE_KEY]: cfg } = await chrome.storage.local.get(STORAGE_KEY);
    if (!cfg) return;
    // failOnce 是实例内存态，不随描述符持久化 —— 合并时保留在飞
    // 的一次性开关，否则路由前的这次读取会把它清掉（#91 调查）
    activeCfg = { ...(cfg as E2EMockConfig), failOnce: activeCfg?.failOnce };
    installStub();
  } catch (e) {
    console.warn('[PT] E2E mock 自愈失败，直连真实端点:', e);
  }
}

/**
 * fixtures 注入路径：写入描述符 + 当前实例立即安装。
 *
 * 无清除 API 是有意为之：E2E 每个测试独占 fresh profile，
 * 描述符只存活于该测试的 storage 中，无需反激活。
 */
export function applyE2EMock(cfg: E2EMockConfig): Promise<void> {
  activeCfg = cfg;
  installStub();
  // failOnce 不持久化：它只在当前 SW 实例内一次性生效。
  // SW 意外被替换时开关丢失 → 测试因 failOnceServed === 0 响亮失败，
  // 不会假绿。
  const persisted = { ...cfg };
  delete persisted.failOnce;
  return new Promise<void>((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: persisted }, () => resolve());
  });
}
