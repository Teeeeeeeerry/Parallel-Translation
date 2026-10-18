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
import {
  test as base,
  chromium,
  expect,
  type Locator,
  type Page,
  type Worker,
} from '@playwright/test';
import fs from 'fs';
import { SetupTimeline } from './setup-steps';
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
  'br-lines',
  'same-language',
  'mixed-language',
  'content-foreign',
  'content-zh-declared-en',
  'content-short',
  'markup-dense',
  'wiki-article',
  'input-frames',
  'input-blank-frames',
  'input-opaque-frames',
  'same-language-frames',
  'input-content-zh',
  'content-zh-book-list',
  'skip-summary',
  'skip-frames',
  'wiki-results-table',
] as const;

export type FixtureName = (typeof FIXTURES)[number];

/** e2e-mock 替身层的统计（getE2EMockStats 的返回值） */
interface MockStats {
  totalServed: number;
  queries: string[];
  googleAborted: number;
  bingServed: number;
  chatServed: Record<string, number>;
}

/** mockRequests 读到的增量：各端点请求数与发给 Google 的原文（#766） */
export interface MockRequests {
  google: number;
  /** Google 请求在替身延迟期间被中止的次数（#1001） */
  googleAborted: number;
  bing: number;
  /** 键是对话式端点 URL */
  chat: Record<string, number>;
  queries: string[];
}

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
      /** 不含拉丁字母的文本原样还回来，模拟本来就是目标语言的段落（#796） */
      keepCjk?: boolean;
    }) => Promise<void>;
    /** DeepL 替身：写入假 key，并装上能扛住 SW 重启的端点替身（#723） */
    mockDeepl: (opts?: { detectedSourceLanguage?: string }) => Promise<void>;
    /** Bing 替身：鉴权与翻译两个端点，译文是 prefix 加原文（#766） */
    mockBing: (opts?: { prefix?: string }) => Promise<void>;
    /**
     * OpenAI 兼容的对话式端点替身（#766）：按请求的编号行回显并加 prefix；
     * dropText 命中的行不回显（模拟 LLM 漏行）；status 不是 200 时按它失败
     */
    mockChat: (
      endpoint: string,
      opts?: { prefix?: string; status?: number; dropText?: string },
    ) => Promise<void>;
    /**
     * 替身层的请求记录（#766）：返回一个读取函数，读到的是调用之后的增量。
     * 记录只活在 SW 实例内存里，实例被替换就清零 —— 读取时若实例换过，
     * 以“记录不可信”报错，而不是让“零请求”假绿
     */
    mockRequests: () => Promise<() => Promise<MockRequests>>;
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
      // #1061：建 context 分步计时，每一步各自一个上限。卡住时报的是具体哪一步、
      // 等了多久、前面各步的耗时（启动那一步还有 Playwright 自己的 call log），而不是整条用例的 180 秒
      // 被吃光后的一句“setting up context 超时”。各步上限加起来远小于 180 秒
      const setup = new SetupTimeline();

      // 每次启动前清空 profile：testId 跨运行稳定，上次运行留下的
      // profile 里缓存着旧版 service worker 脚本 —— Chrome 会直接
      // 复用旧脚本，扩展改动在本地迭代时“假失败”（SW 里查不到新
      // 加的全局函数）。清空保证每个用例都从干净的扩展状态出发。
      // 同步删除没法中途打断，这一步只记耗时
      await setup.step('清 profile', 30_000, () =>
        fs.rmSync(userDataDir, { recursive: true, force: true }),
      );

      // 启动的上限交给 Playwright 自己（它超时会收拾掉浏览器进程），外面这一层
      // 比它多留 5 秒，只在 Playwright 自己也没返回时兜底报出这一步
      const context = await setup.step('启动浏览器', 65_000, () =>
        chromium.launchPersistentContext(userDataDir, {
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
          timeout: 60_000,
        }),
      );

      // 启动之后的某一步卡住或出错：先关掉已经起来的浏览器再报错，不留孤儿进程
      try {
        // #1048：每个 frame 里记下输入翻译圆点停手后的那一挪，供 clickInputDot 等它
        await setup.step('装 init script', 10_000, () => context.addInitScript(recordInputDotMoves));

        // #1035：首装时 background 的 onInstalled 用 chrome.tabs.create 打开欢迎页，
        // 这一步是异步的 —— launchPersistentContext 返回时它多半还没建出来，直接扫
        // pages() 一张都关不掉，用例就带着它跑。所以先等到欢迎页本身（已在列表里，
        // 或等它的 page 事件），再由下面的循环关掉扩展页。每个用例的 profile 都是
        // 清空的，必然是首装，等不到就是首装流程变了，直接报错而不是静默跳过
        const isWelcome = (p: Page) => p.url().endsWith('/welcome.html');
        await setup.step('等欢迎页', 10_000, async () => {
          if (!context.pages().some(isWelcome)) {
            await context.waitForEvent('page', { predicate: isWelcome });
          }
        });
        await setup.step('关扩展页', 10_000, async () => {
          for (const p of context.pages()) {
            if (p.url().startsWith('chrome-extension://')) {
              await p.close().catch(() => {});
            }
          }
        });
      } catch (e) {
        await context.close().catch(() => {});
        throw e;
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
      keepCjk?: boolean;
    } = {}) => {
      const {
        fail = false,
        prefix = '【译】',
        failOnce = false,
        failTexts,
        echoTargetLang,
        delayMs,
        keepCjk,
      } = opts;
      await serviceWorker.evaluate(
        async (cfg: {
          fail: boolean;
          prefix: string;
          failOnce: boolean;
          failTexts?: string[];
          echoTargetLang?: boolean;
          delayMs?: number;
          keepCjk?: boolean;
        }) => {
          // 其他引擎的替身（mockDeepl、mockBing、mockChat）留着，调用先后不影响
          const cur: any = (await chrome.storage.local.get('pt-e2e-mock'))['pt-e2e-mock'] ?? {};
          await (self as any).applyE2EMock({ deepl: cur.deepl, bing: cur.bing, chat: cur.chat, ...cfg });
        },
        { fail, prefix, failOnce, failTexts, echoTargetLang, delayMs, keepCjk },
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

  // ── Mock Bing 与对话式引擎 ──
  // #766：与 mockDeepl 同一套装法。用例原先在 SW 里直接改写 self.fetch，
  // SW 被回收重启后替身消失，请求打到真实端点
  mockBing: async ({ serviceWorker }, use) => {
    await use(async ({ prefix = '[BING] ' } = {}) => {
      await serviceWorker.evaluate(async (p: string) => {
        const cur = (await chrome.storage.local.get('pt-e2e-mock'))['pt-e2e-mock'] ?? {};
        await (self as any).applyE2EMock({ ...cur, bing: { prefix: p } });
      }, prefix);
    });
  },

  mockChat: async ({ serviceWorker }, use) => {
    await use(async (endpoint, opts = {}) => {
      await serviceWorker.evaluate(
        async ({ endpoint, opts }: { endpoint: string; opts: object }) => {
          const cur: any = (await chrome.storage.local.get('pt-e2e-mock'))['pt-e2e-mock'] ?? {};
          await (self as any).applyE2EMock({ ...cur, chat: { ...cur.chat, [endpoint]: opts } });
        },
        { endpoint, opts },
      );
    });
  },

  // ── 替身层的请求记录 ──
  // #766：照 #795 的写法 —— 计数与原文都记在 e2e-mock 替身层，读之前先认
  // SW 上的存活标记。替身本身随描述符自愈，记录却只在实例内存里，所以实例
  // 换过就报错，不让“零请求”或“发出去的原文”在清零后的记录上假绿
  mockRequests: async ({ serviceWorker }, use) => {
    await use(async () => {
      const token = `pt-${Date.now()}-${Math.random()}`;
      const base = await serviceWorker.evaluate(async (t: string) => {
        if (!(await chrome.storage.local.get('pt-e2e-mock'))['pt-e2e-mock']) return null;
        ((self as any).__ptLiveTokens ??= new Set<string>()).add(t);
        return (self as any).getE2EMockStats() as MockStats;
      }, token);
      if (!base) throw new Error('还没有装引擎替身，请求不经过替身层，记录不到：先调 mockGoogle 等夹具');
      return async () => {
        const { live, stats } = await serviceWorker.evaluate((t: string) => ({
          live: (self as any).__ptLiveTokens?.has(t) === true,
          stats: (self as any).getE2EMockStats() as MockStats,
        }), token);
        if (!live) throw new Error('service worker 中途被替换，替身层的请求记录已清零，不可信');
        const chat: Record<string, number> = {};
        for (const [url, n] of Object.entries(stats.chatServed)) chat[url] = n - (base.chatServed[url] ?? 0);
        return {
          google: stats.totalServed - base.totalServed,
          googleAborted: stats.googleAborted - base.googleAborted,
          bing: stats.bingServed - base.bingServed,
          chat,
          queries: stats.queries.slice(base.queries.length),
        };
      };
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

/**
 * 在一段时间内始终没有提示（#832）。
 *
 * 会重试的否定断言（`toHaveCount(0)`、`toBeHidden()`）抓不住“本该不出现、却
 * 出现了一下又消失”的提示：状态类提示 3 秒后自己消失（设置页的提示 2 秒），
 * 重试一直等到条数变成 0，断言照样通过。这里从现在起持续采样 `ms` 毫秒，
 * 任何一次采到可见的提示就失败，并报出采到的文字。
 *
 * 在“该出现提示的时刻”之后立即调用：提示若在调用之前就出现过，只要还没自己
 * 消失，第一次采样就能采到。
 */
export async function expectNoToastFor(
  toasts: Locator,
  message: string,
  ms = 3_500,
): Promise<void> {
  const page = toasts.page();
  const end = Date.now() + ms;
  for (;;) {
    const visible: string[] = [];
    for (const toast of await toasts.all()) {
      if (await toast.isVisible().catch(() => false)) {
        visible.push(((await toast.textContent().catch(() => '')) ?? '').trim());
      }
    }
    expect(visible, message).toEqual([]);
    if (Date.now() >= end) return;
    await page.waitForTimeout(200);
  }
}

/**
 * 输入翻译圆点的挪位记录器（#1048），以 init script 装进每个页面的每个 frame。
 *
 * 打字时圆点先放在回落位置（或停在上一次对齐的位置），停手 SHOW_DELAY 后才挪到
 * 文字末尾旁边（#670）。点击赶上这一挪，按下与抬起落在不同位置，click 不触发。
 * 记录器只看页面上看得见的两件事，不读产品内部状态：
 * - 编辑：焦点所在的框收到 input 事件，或焦点所在的 contenteditable 里有 DOM 变动
 *   （受控编辑器不发 input 事件，#656）；
 * - 挪位：圆点的 left / top 变了。
 * 与编辑同一个任务里的挪位是刚浮出时放到回落位置，不算；之后另一个任务里的挪位
 * 才是停手对齐。最后一次编辑之后对齐过，圆点就不会再自己挪，这时点它不会点空。
 *
 * 对齐的结果与当前位置相同时浏览器不产生变动记录，等不到 —— 那种情形圆点本来就不
 * 挪，没有竞态，调用方不用这个辅助函数，并在用例里写明原因。
 */
function recordInputDotMoves(): void {
  type Recorder = { settled(): boolean };
  const w = window as unknown as { __ptInputDot?: Recorder };
  if (w.__ptInputDot) return;
  // 最后一次编辑之后还没挪过位：圆点还欠一次停手对齐
  let pending = false;
  let inEditTask = false;
  let dot: HTMLElement | null = null;
  let lastPos = '';
  let editable: Element | null = null;
  const pos = (el: HTMLElement) => `${el.style.left}|${el.style.top}`;
  const mo = new MutationObserver((records) => handle(records));
  /** 找到圆点并盯住它的 style。圆点宿主被站点移除后会重新挂一个，换了就重新找 */
  const attach = () => {
    if (dot?.isConnected) return;
    dot =
      document
        .getElementById('pt-host-input-dot')
        ?.shadowRoot?.querySelector<HTMLElement>('.pt-input-dot') ?? null;
    if (!dot) return;
    lastPos = pos(dot);
    mo.observe(dot, { attributes: true, attributeFilter: ['style'] });
  };
  const markEdit = () => {
    attach();
    // 编辑时还没有圆点（站点未获准入等），这次编辑不会排下对齐
    if (!dot) return;
    pending = true;
    if (!inEditTask) {
      inEditTask = true;
      setTimeout(() => (inEditTask = false), 0);
    }
  };
  function handle(records: MutationRecord[]) {
    for (const r of records) {
      if (r.target === dot) {
        const now = pos(dot);
        if (now === lastPos) continue;
        lastPos = now;
        if (!inEditTask) pending = false;
      } else if (editable?.contains(r.target)) {
        markEdit();
      }
    }
  }
  /** 焦点换到别的元素：受控编辑器不发 input 事件，改盯它的 DOM 变动（#656） */
  const focusOn = (target: Element | null) => {
    handle(mo.takeRecords());
    mo.disconnect();
    dot = null;
    attach();
    editable = target instanceof HTMLElement && target.isContentEditable ? target : null;
    if (editable) mo.observe(editable, { childList: true, characterData: true, subtree: true });
  };
  // 都挂在 window 的捕获阶段：先于内容脚本挂在 document 上的监听，编辑先记下，
  // 随后同一任务里的回落放置才认得出来
  window.addEventListener('focusin', (e) => focusOn((e.composedPath()[0] as Element) ?? null), true);
  window.addEventListener('input', markEdit, true);
  w.__ptInputDot = {
    settled: () => {
      attach();
      return !!dot && dot.style.display === 'block' && !pending;
    },
  };
}

/**
 * 点输入翻译圆点（#1034、#1048）。先断言字确实进了框，再等圆点停手后挪到文字
 * 末尾旁边（记录器见 recordInputDotMoves），然后才点 —— 不靠固定延时。
 *
 * text 是此刻框里应有的全部文字（contenteditable 里换行的写法因浏览器而异时传正则）。double 用双击；force 跳过 Playwright 的
 * 静止等待，用于进行中（转圈）时再点。
 */
export async function clickInputDot(
  dot: Locator,
  box: Locator,
  text: string | RegExp,
  { double = false, force = false }: { double?: boolean; force?: boolean } = {},
): Promise<void> {
  // #1034：CI 上见过打完字框还是空的。在这里断言，失败时报的是“字没进框”
  if (await box.evaluate((el) => (el as HTMLElement).isContentEditable)) {
    await expect(box).toHaveText(text);
  } else {
    await expect(box).toHaveValue(text);
  }
  await expect
    .poll(
      () =>
        dot.evaluate((el) => {
          const r = (el.ownerDocument.defaultView as unknown as { __ptInputDot?: { settled(): boolean } })
            .__ptInputDot;
          if (!r) throw new Error('这个 frame 里没有圆点挪位记录器'); // cjk-ok: 断言说明，不是界面文案
          return r.settled();
        }),
      { message: '圆点停手后挪到文字末尾旁边' }, // cjk-ok: 断言说明，不是界面文案
    )
    .toBe(true);
  if (double) await dot.dblclick({ force });
  else await dot.click({ force });
}

export { expect };
