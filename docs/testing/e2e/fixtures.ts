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
import { fileURLToPath } from 'node:url';

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

/**
 * 获取 fixture 页面的 file:// URL（#88）。
 *
 * 用于不需要 content script 注入的自包含用例（如纯 DOM 逻辑验证）：
 * 经 HTTP 加载时 content script 会注入并可能干扰页面 DOM 计数等断言，
 * 因此这类用例直接以 file:// 打开本地 fixture。
 * spec 以 ES module 运行，__dirname 不存在，须用 import.meta.url 推导目录。
 */
export function fixtureFileUrl(name: FixtureName): string {
  return 'file://' + fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url));
}

// ── Google Translate API 响应形状 ──
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
    serviceWorker: Worker;
    mockGoogle: (opts?: {
      fail?: boolean;
      translation?: (q: string) => string;
    }) => Promise<void>;
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

      const context = await chromium.launchPersistentContext(userDataDir, {
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
  serviceWorker: async ({ context }, use) => {
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
