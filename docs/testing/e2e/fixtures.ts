/**
 * E2E 夹具 — Playwright 扩展测试核心层。
 *
 * 关键设计:
 * 1. persistent context + --load-extension 加载扩展
 * 2. mockGoogle 在 SW 内 stub fetch（#89：CDP route 对 SW 请求拦截不可靠）
 * 3. seedSettings 写入 chrome.storage.sync 并等待生效；交出 service worker
 *    之前先等首装按界面语言写入的目标语言落盘（#723）
 * 4. fixture 页面通过 HTTP 提供（绕开 file:// 的 content script 限制）
 */
import { test as base, chromium, expect, type Page, type Worker } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const EXTENSION_PATH = path.resolve('.output/chrome-mv3');
const FIXTURES_BASE = 'http://localhost:4173';

/** 所有 fixture 页面的文件名 */
export const FIXTURES = [
  'basic',
  'auto-mutate',
  'shadow',
  'shadow-collapse',
  'custom-elements',
  'iframe',
  'iframe-cross',
  'infinite',
  'spa',
  'hostile',
  'noise',
  'nested',
  'preserve',
  'pre-blocks',
  'rtl',
  'media-mix',
  'entity',
  'input',
  'svg-chart',
  'rich-input',
  'br-post',
  'markup-dense',
] as const;

export type FixtureName = (typeof FIXTURES)[number];

/** 获取 fixture 页面的 HTTP URL（content script 通过 <all_urls> 注入） */
export function fixtureUrl(name: FixtureName): string {
  return `${FIXTURES_BASE}/${name}.html`;
}

/**
 * 获取 fixture 页面的 file:// URL（#88）。
 *
 * 用于不依赖本地 HTTP 服务的自包含用例（如纯 DOM 逻辑验证）。
 * 注意 content script 同样会注入 file:// 页面（#488），悬浮球等界面宿主
 * 随时可能出现：数 DOM 节点的断言须跳过带 data-pt-ui 标记的子树。
 * spec 以 ES module 运行，__dirname 不存在，须用 import.meta.url 推导目录。
 */
export function fixtureFileUrl(name: FixtureName): string {
  return 'file://' + fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url));
}

/** 悬浮球定位器（#136：与 #124 getBoundingClientRect 同思路收敛到夹具层）。 */
export const BALL_LOCATOR = '#pt-host-ball .pt-ball';

/** 等待扩展注入：悬浮球出现 = content script 已运行（core/extended/real-sites 共用）。 */
export async function waitForBall(
  page: Page,
  timeout = 60_000,
): Promise<import('@playwright/test').Locator> {
  const ball = page.locator(BALL_LOCATOR);
  await expect(ball).toBeVisible({ timeout });
  return ball;
}

export const test = base.extend<
  {
    serviceWorker: Worker;
    mockGoogle: (opts?: {
      fail?: boolean;
      prefix?: string;
      /** 一次性故障：下一次翻译请求 500，随后自动恢复（#91） */
      failOnce?: boolean;
      /** 指定文本的请求 500（精确匹配 q 参数），用于部分失败（#120） */
      failTexts?: string[];
      /** 响应附带 [tl=<to>] 标记，验证语言切换（#120） */
      echoTargetLang?: boolean;
      /** 人工响应延迟毫秒，制造在飞窗口（#120） */
      delayMs?: number;
    }) => Promise<void>;
    /** DeepL 替身：写入假 key，并装上能扛住 SW 重启的端点替身（#723） */
    mockDeepl: (opts?: { detectedSourceLanguage?: string }) => Promise<void>;
    seedSettings: (patch: Record<string, unknown>) => Promise<void>;
    gotoFixture: (name: FixtureName) => Promise<Page>;
  },
  {
    context: object;
  }
>({
  // ── 扩展加载：persistent context ──
  context: [
    async ({}, use: any, testInfo: any) => {
      const userDataDir = path.resolve(
        '.output/.playwright-profiles',
        testInfo.testId,
      );

      // 每次启动前清空 profile：testId 跨运行稳定，上次运行留下的
      // profile 里缓存着旧版 service worker 脚本 —— Chrome 会直接
      // 复用旧脚本，扩展改动在本地迭代时“假失败”（SW 里查不到新
      // 加的全局函数）。清空保证每个用例都从干净的扩展状态出发。
      fs.rmSync(userDataDir, { recursive: true, force: true });

      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        executablePath: chromium.executablePath(),
        viewport: { width: 1280, height: 720 },
        // #469: 固定界面语言。首装时 background 按界面语言推导目标语言，
        // 推导结果不是 zh-CN 就写一次设置；这次写入时机不定，晚于 seedSettings
        // 落盘时会把种子设置整份覆盖回默认值。界面语言为 zh-CN 时首装不写设置。
        // 只传 --lang 不够，Chromium 的界面语言仍会随机落到 en-US
        locale: 'zh-CN',
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--disable-features=DialMediaRouteProvider',
          ...(process.env.CI ? ['--no-sandbox'] : []),
        ],
      });

      for (const p of context.pages()) {
        if (p.url().startsWith('chrome-extension://')) {
          await p.close().catch(() => {});
        }
      }

      await use(context);
      await context.close();
    },
    { scope: 'test' },
  ] as any,

  // ── Service Worker ──
  //
  // #723：首装时 background 按界面语言推导目标语言，结果不是 zh-CN 就
  // patchSettings 写一次（#469）。上面的 locale 并不能保证首装看到的是
  // zh-CN：它是挂上 worker 之后才覆盖的界面语言，CI 的 Linux 上真实界面
  // 是 en-US，本地也会随机赶在覆盖之前。这次写入先读后写，在 worker 起来
  // 后一两百毫秒落盘，与 seedSettings 交错时合并基底是空存储，种子整份被
  // 覆盖回默认值（enginePriority 回到 google-web，目标语言变成 en）。
  // 所以等 background 报告首装处理落定，再把 worker 交给用例。
  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    await expect
      .poll(() => worker.evaluate(() => typeof (self as any).ptInstallSettled), {
        message: 'background 没有暴露首装落定的信号 ptInstallSettled',
        timeout: 10_000,
      })
      .toBe('object');
    await worker.evaluate(() => (self as any).ptInstallSettled);
    await use(worker);
  },

  // ── Mock Google Translate ──
  // #89: 在 SW 内 stub fetch（引擎运行处），而不是 context.route ——
  // CDP 对 SW 发起的请求拦截不可靠：部分请求绕过时，本地恰好直连真实
  // Google 而“假绿”，CI 无外网则必失败。SW 侧 stub 完全确定性。
  //
  // #90: 描述符经 applyE2EMock 写入 chrome.storage.local 并立即安装。
  // SW 实例一旦被 Chrome 替换，实例内存里的 stub 会消失 —— 翻译路由
  // 前的 ensureE2EMock 从 storage 自愈重装，增量翻译不再直连真实端点。
  mockGoogle: async ({ serviceWorker }, use) => {
    await use(async (opts: {
      fail?: boolean;
      prefix?: string;
      failOnce?: boolean;
      failTexts?: string[];
      echoTargetLang?: boolean;
      delayMs?: number;
    } = {}) => {
      const {
        fail = false,
        prefix = '【译】',
        failOnce = false,
        failTexts,
        echoTargetLang,
        delayMs,
      } = opts;
      await serviceWorker.evaluate(
        (cfg: {
          fail: boolean;
          prefix: string;
          failOnce: boolean;
          failTexts?: string[];
          echoTargetLang?: boolean;
          delayMs?: number;
        }) => (self as any).applyE2EMock(cfg),
        { fail, prefix, failOnce, failTexts, echoTargetLang, delayMs },
      );
    });
  },

  // ── Mock DeepL ──
  // #723：与 mockGoogle 同一套描述符（applyE2EMock 写入 storage，翻译路由
  // 前 ensureE2EMock 自愈重装）。用例自己在 SW 里改写 self.fetch 的替身
  // 随实例消失，请求就打到真实端点。描述符与已有的合并，可与 mockGoogle
  // 叠用；只装 DeepL 时 Google 端点同样被替身接住，不会直连真实引擎。
  mockDeepl: async ({ serviceWorker }, use) => {
    await use(async ({ detectedSourceLanguage = 'EN' } = {}) => {
      await serviceWorker.evaluate(async (detected: string) => {
        await chrome.storage.local.set({ 'pt-keys': { deepl: 'e2e:fx' } });
        const cur = (await chrome.storage.local.get('pt-e2e-mock'))['pt-e2e-mock'] ?? {};
        await (self as any).applyE2EMock({
          ...cur,
          deepl: { detectedSourceLanguage: detected },
        });
      }, detectedSourceLanguage);
    });
  },

  // ── 设置种子 ──
  seedSettings: async ({ serviceWorker }, use) => {
    await use(async (patch: Record<string, unknown>) => {
      const merged = {
        enabled: true,
        useCache: false,
        showFloatingBall: true,
        showParagraphBtn: true,
        from: 'auto',
        to: 'zh-CN',
        enginePriority: ['google-web'],
        ...patch,
      };
      await serviceWorker.evaluate(
        (p) =>
          new Promise<void>((resolve) => {
            chrome.storage.sync.set({ 'pt-settings': p }, () => {
              chrome.storage.sync.get('pt-settings', () => resolve());
            });
          }),
        merged,
      );
    });
  },

  // ── 导航到 fixture ──
  gotoFixture: async ({ page }, use) => {
    await use(async (name: FixtureName) => {
      await page.goto(fixtureUrl(name), { waitUntil: 'domcontentloaded' });
      return page;
    });
  },
});

export { expect };
