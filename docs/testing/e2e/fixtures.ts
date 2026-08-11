/**
 * E2E 夹具 — Playwright 扩展测试核心层。
 *
 * 关键设计:
 * 1. persistent context + --load-extension 加载扩展
 * 2. context.route mock 翻译 API（已验证可拦截 SW 请求）
 * 3. seedSettings 写入 chrome.storage.sync 并等待生效
 * 4. fixture 页面通过 HTTP 提供（绕开 file:// 的 content script 限制）
 */
import { test as base, chromium, expect, type Page, type Worker } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve('.output/chrome-mv3');
const FIXTURES_BASE = 'http://localhost:4173';

/** 所有 fixture 页面的文件名 */
export const FIXTURES = [
  'basic',
  'shadow',
  'custom-elements',
  'iframe',
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
] as const;

export type FixtureName = (typeof FIXTURES)[number];

/** 获取 fixture 页面的 HTTP URL（content script 通过 <all_urls> 注入） */
export function fixtureUrl(name: FixtureName): string {
  return `${FIXTURES_BASE}/${name}.html`;
}

// ── Google Translate API 响应形状 ──
// google-web.ts 解析: data[0] 是分句数组, 每项 [0] 为译文
interface GoogleResponse {
  0: Array<[string, string, null, null, number]>;
}

function googleBody(translation: string): [GoogleResponse, null, string] {
  return [
    {
      0: [[translation, '', null, null, 1]],
    },
    null,
    'en',
  ];
}

export const test = base.extend<
  {
    /** Background service worker — 可 evaluate + 访问 chrome.storage */
    serviceWorker: Worker;
    /** Mock Google 翻译端点（在 SW fetch 层拦截） */
    mockGoogle: (opts?: {
      fail?: boolean;
      translation?: (q: string) => string;
    }) => Promise<void>;
    /** 向 chrome.storage.sync 写入设置并等待生效 */
    seedSettings: (patch: Record<string, unknown>) => Promise<void>;
    /** 导航到 fixture 页面 */
    gotoFixture: (name: FixtureName) => Promise<Page>;
  },
  {
    /** 被 context 覆盖 — Playwright 的 context fixture 返回我们的 persistent context */
    context: object;
  }
>({
  // ── 扩展加载：persistent context ──
  // scope: 'test' 确保每个测试有独立的浏览器 profile，状态不串扰。
  context: [
    async ({}, use, testInfo) => {
      const userDataDir = path.resolve(
        '.output/.playwright-profiles',
        testInfo.testId,
      );

      const context = await chromium.launchPersistentContext(userDataDir, {
        // headless shell 不完全支持 content script 注入（#pt-host-ball 不会出现）。
        // 通过 executablePath 显式指向完整 chromium 来解决。
        headless: true,
        executablePath: chromium.executablePath(),
        viewport: { width: 1280, height: 720 },
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--disable-features=DialMediaRouteProvider',
          ...(process.env.CI ? ['--no-sandbox'] : []),
        ],
      });

      // 关闭 onInstalled 打开的 welcome tab（如果有的话）
      const pages = context.pages();
      for (const p of pages) {
        if (p.url().startsWith('chrome-extension://')) {
          await p.close().catch(() => {});
        }
      }

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ] as any,

  // ── Service Worker ──
  serviceWorker: async ({ context }, use) => {
    // 等待 background service worker 启动
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
    await use(worker);
  },

  // ── Mock Google Translate ──
  mockGoogle: async ({ context }, use) => {
    await use(async (opts = {}) => {
      const { fail = false, translation } = opts;
      await context.route('https://translate.googleapis.com/**', (route) => {
        if (fail) {
          return route.fulfill({
            status: 500,
            contentType: 'text/plain',
            body: 'Service Unavailable',
          });
        }
        const q = new URL(route.request().url()).searchParams.get('q') ?? '';
        const t = translation ? translation(q) : `【译】${q}`;
        const body = JSON.stringify(googleBody(t));
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body,
        });
      });
    });
  },

  // ── 设置种子 ──
  seedSettings: async ({ serviceWorker }, use) => {
    await use(async (patch: Record<string, unknown>) => {
      // 确保关闭缓存 + 开启悬浮球/段落按钮 + 仅启用 google-web
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
      // 写入并等待 SW 确认
      await serviceWorker.evaluate(
        (p) =>
          new Promise<void>((resolve) => {
            chrome.storage.sync.set({ 'pt-settings': p }, () => {
              // 验证写入成功
              chrome.storage.sync.get('pt-settings', () => resolve());
            });
          }),
        merged,
      );
      // background.ts 的 onSettingsChanged 在 storage 事件中同步更新;
      // content script 在页面导航后通过 settingsReady() 读取。
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
