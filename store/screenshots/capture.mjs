/**
 * CWS 上架图实拍脚本。
 *
 * 在真实 Chromium 里加载 .output/chrome-mv3，用真实的 Google 免 key 引擎
 * 翻译演示页面，再按商店规格截图 —— 产出的是实拍图，不是合成图。
 *
 * 链路照搬 docs/testing/e2e/fixtures.ts 已跑通的扩展加载方案
 * （launchPersistentContext + --load-extension + executablePath），
 * 但不走 Playwright test runner：截图是产出物而非断言，runner 的
 * 并行与重试只会让同一张图在不同状态下被拍两次。
 *
 * 用法:
 *   node store/screenshots/capture.mjs                 两套全拍
 *   node store/screenshots/capture.mjs --locale zh      只拍中文套
 *   node store/screenshots/capture.mjs --only 03,04     只重拍指定几张
 *   node store/screenshots/capture.mjs --headed         显示浏览器窗口（排查用）
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

// ── 常量 ─────────────────────────────────────────────

const EXTENSION_SRC = resolve('.output/chrome-mv3');
const EXT_STAGING = resolve('.output/.screenshot-ext');
const PROFILE_DIR = resolve('.output/.screenshot-profiles');
const DEMO_DIR = resolve('store/screenshots/demo');
const MARK_SVG = resolve('design/icon/icon-mark.svg');
const OUT_ROOT = resolve('store/screenshots');

// 4173 是 E2E fixtures-server 的端口，错开以便两者可同时跑
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

/** 商店截图规格 —— CWS 接受 1280x800 或 640x400，本项目统一用前者 */
const SHOT = { width: 1280, height: 800 };

/** 六种译文样式，顺序即 03-styles.png 网格的排布顺序 */
const STYLE_IDS = ['default', 'dim', 'underline', 'bold', 'italic', 'fade'];

/**
 * 每套截图的配置。
 *
 * 中文套：英文演示页译成中文；英文套：西班牙语演示页译成英文 ——
 * 英语读者能直接读懂对照的两层，而不是只能看懂其中一层。
 */
const LOCALES = {
  zh: {
    keepLocale: 'zh_CN',
    chromeLang: 'zh-CN',
    article: 'article-en.html',
    to: 'zh-CN',
    styleLabels: {
      default: '默认',
      dim: '弱化显示',
      underline: '实线下划线',
      bold: '加粗',
      italic: '斜体',
      fade: '半透明',
    },
    // 划词的选区落点：第几个正文段落、选到哪个子串结束
    selection: { paraIndex: 0, endsWith: 'fed by the sun.' },
    styleNotes: { dim: '悬停到段落时才淡入' },
    gridCopy: {
      title: '六种译文样式',
      hint: '设置 → 外观 → 译文样式，随时切换',
    },
  },
  en: {
    keepLocale: 'en',
    chromeLang: 'en-US',
    article: 'article-es.html',
    to: 'en',
    styleLabels: {
      default: 'Default',
      dim: 'Dimmed',
      underline: 'Underline',
      bold: 'Bold',
      italic: 'Italic',
      fade: 'Faded',
    },
    selection: { paraIndex: 1, endsWith: 'ladera abajo en pocas temporadas.' },
    styleNotes: { dim: 'fades in on hover' },
    gridCopy: {
      title: 'Six translation styles',
      hint: 'Settings → Appearance → Translation style',
    },
  },
};

/** 演示用的假 API key。只为让设置页展示「已配置」状态，password 框只渲染圆点。 */
const DEMO_KEYS = {
  openai: 'sk-demo-not-a-real-key-0000000000',
  deepl: 'demo-not-a-real-key-0000:fx',
};

// ── 参数 ─────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { locales: ['zh', 'en'], only: null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--locale') {
      const v = argv[++i];
      if (!LOCALES[v]) throw new Error(`--locale 只接受 zh 或 en，收到: ${v}`);
      opts.locales = [v];
    } else if (a === '--only') {
      opts.only = new Set(argv[++i].split(',').map((s) => s.trim()));
    } else if (a === '--headed') {
      opts.headed = true;
    } else {
      throw new Error(`无法识别的参数: ${a}`);
    }
  }
  return opts;
}

const log = (msg) => console.log(msg);

// ── 前置检查 ─────────────────────────────────────────

/** 缺构建产物就直接失败 —— 与 playwright.config.ts 的哨兵同一思路。 */
function assertBuildOutput() {
  if (!existsSync(join(EXTENSION_SRC, 'manifest.json'))) {
    throw new Error(
      `缺少扩展构建产物: ${EXTENSION_SRC}/manifest.json\n` +
        `  请先运行 pnpm build 再拍截图。`,
    );
  }
  const mf = JSON.parse(readFileSync(join(EXTENSION_SRC, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  if (mf.version !== pkg.version) {
    throw new Error(
      `构建产物版本 ${mf.version} 与 package.json 的 ${pkg.version} 不一致 —— ` +
        `请重新 pnpm build，避免拍到旧版界面。`,
    );
  }
  log(`构建产物检查通过: v${mf.version}`);
}

/**
 * 翻译端点连通性探针。
 *
 * 无外网时在这里响亮失败，而不是让后面拍出一堆没有译文的空图 ——
 * 空图比没有图更危险，因为它看起来像是拍成功了。
 */
async function probeTranslateEndpoint() {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const first = body?.[0]?.[0]?.[0];
    if (!first) throw new Error('响应结构不符合预期');
    log(`翻译端点连通: hello → ${first}`);
  } catch (e) {
    throw new Error(
      `翻译端点不可达（${e.message}）。截图依赖真实引擎产出真实译文，` +
        `请确认网络后重试。`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ── 静态服务器 ───────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * 演示页必须走 http —— 内容脚本注入不到 file://。
 * 零依赖静态服务器，思路同 docs/testing/e2e/fixtures-server.mjs（不改动它本身）。
 */
function startServer() {
  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    const pathname = req.url.split('?')[0];
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(DEMO_DIR, rel === '/' ? 'index.html' : rel);
    // 路径穿越防护：正常化后必须仍在 demo 目录内
    if (!file.startsWith(DEMO_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(PORT, () => {
      log(`演示页服务器: ${BASE}`);
      ok(server);
    });
  });
}

// ── 扩展副本：强制 UI 语言 ────────────────────────────

/**
 * 扩展 UI 走 chrome.i18n（src/i18n.ts），语言由浏览器 UI locale 决定，
 * 而 macOS 上 Chromium 基本忽略 --lang。这里改用 default_locale 回退链：
 * 副本里只保留一个 _locales 子目录，UI locale 匹配不上时 Chrome 必然回退
 * 到 default_locale，两套结果因此完全确定。
 *
 * 原始 .output/chrome-mv3 全程只读。
 */
function prepareExtension(locale) {
  const { keepLocale } = LOCALES[locale];
  const dst = join(EXT_STAGING, locale);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(EXTENSION_SRC, dst, { recursive: true });

  const localesDir = join(dst, '_locales');
  for (const dir of readdirSync(localesDir)) {
    if (dir !== keepLocale) rmSync(join(localesDir, dir), { recursive: true, force: true });
  }
  const mfPath = join(dst, 'manifest.json');
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
  mf.default_locale = keepLocale;
  writeFileSync(mfPath, JSON.stringify(mf, null, 2));

  log(`扩展副本就绪 [${locale}]: _locales/${keepLocale}`);
  return dst;
}

// ── 浏览器 ───────────────────────────────────────────

async function launchBrowser(locale, headed) {
  const extDir = prepareExtension(locale);
  const userDataDir = join(PROFILE_DIR, locale);
  // 每次从干净 profile 出发：旧 profile 会缓存上一版 service worker 脚本
  rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    // 必须指向完整 Chromium 二进制 —— headless shell 不加载扩展（同 fixtures.ts）
    executablePath: chromium.executablePath(),
    viewport: SHOT,
    deviceScaleFactor: 1,
    locale: LOCALES[locale].chromeLang,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      `--lang=${LOCALES[locale].chromeLang}`,
      '--disable-features=DialMediaRouteProvider',
      '--force-device-scale-factor=1',
      // 商店截图里不该出现滚动条
      '--hide-scrollbars',
    ],
  });

  for (const p of context.pages()) {
    if (p.url().startsWith('chrome-extension://')) await p.close().catch(() => {});
  }

  const sw =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 30_000 }));
  const extId = new URL(sw.url()).host;
  log(`扩展已加载 [${locale}]: ${extId}`);

  return { context, sw, extId };
}

/** 写 chrome.storage.sync 的 pt-settings（键名见 src/storage/settings.ts）。 */
async function seedSettings(sw, patch) {
  const merged = {
    enabled: true,
    enginePriority: ['google-web', 'bing-edge'],
    from: 'auto',
    displayMode: 'bilingual',
    paraDisplayMode: 'follow',
    style: 'default',
    customCss: '',
    siteList: { mode: 'blacklist', list: [] },
    showFloatingBall: true,
    showParagraphBtn: true,
    maxConcurrency: 6,
    useCache: true,
    models: {},
    ...patch,
  };
  await sw.evaluate(
    (p) =>
      new Promise((ok) => {
        chrome.storage.sync.set({ 'pt-settings': p }, () =>
          chrome.storage.sync.get('pt-settings', () => ok()),
        );
      }),
    merged,
  );
}

/** 写演示用假 key 到 chrome.storage.local 的 pt-keys（见 src/storage/keys.ts）。 */
async function seedKeys(sw, keys) {
  await sw.evaluate(
    (k) => new Promise((ok) => chrome.storage.local.set({ 'pt-keys': k }, () => ok())),
    keys,
  );
}

// ── 页面动作 ─────────────────────────────────────────

const BALL = '#pt-host-ball .pt-ball';

async function openArticle(context, locale) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE}/${LOCALES[locale].article}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(BALL, { timeout: 60_000 });
  return page;
}

/**
 * 等整页翻译落定：done 段落数连续若干次不再变化即认为收敛。
 * 同时校验译文非空、且不是 e2e mock 的产物 —— 后者一旦出现说明
 * 误用了 src/engines/e2e-mock.ts，拍出来的图不能上架。
 */
async function waitForTranslated(page, { min = 6, timeout = 150_000 } = {}) {
  const start = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - start < timeout) {
    const n = await page.locator('[data-pt="done"]').count();
    if (n === last && n >= min) {
      if (++stable >= 4) break;
    } else {
      stable = 0;
      last = n;
    }
    await page.waitForTimeout(500);
  }
  if (stable < 4) throw new Error(`翻译未在 ${timeout}ms 内收敛，done=${last}`);

  const texts = await page.$$eval('.pt-trans', (els) =>
    els.map((e) => (e.textContent ?? '').trim()),
  );
  const filled = texts.filter(Boolean);
  if (filled.length < min) {
    throw new Error(`译文数量不足: ${filled.length} < ${min}`);
  }
  if (filled.some((t) => t.startsWith('【译】'))) {
    throw new Error('检测到 e2e mock 译文前缀，拒绝产出 —— 请排查 e2e-mock 是否被误装');
  }
  log(`  翻译完成: ${last} 段`);
  return last;
}

/** 点悬浮球触发整页翻译，与真实用户操作同路径。 */
async function translatePage(page) {
  await page.click(BALL);
  return waitForTranslated(page);
}

/**
 * 把正文滚到「标题 + 段落 + 引用」都在画面里的位置。
 *
 * 以第一个 h2 为锚，只留 30px 余量：h2 的 margin-top 是 44px（demo.css），
 * 留得比它小，画面顶端落在纯空白里，不会切出半行字。
 */
async function scrollToBody(page) {
  await page.evaluate(() => {
    const h2 = document.querySelector('article h2');
    const top = h2 ? h2.getBoundingClientRect().top + window.scrollY : 0;
    window.scrollTo(0, Math.max(0, top - 30));
  });
  await page.waitForTimeout(400);
}

/**
 * 正文列的截取范围 —— 03 的六格共用，保证六张小图像素级对齐。
 * ratio 由拼图模板里格子的实际宽高比给出，两边一致，object-fit 就不会裁内容。
 * y 取 16：scrollToBody 把 h2 停在 30px 处，16px 落在它上方的空白里。
 */
async function bodyClip(page, ratio) {
  return page.evaluate((r) => {
    const art = document.querySelector('article');
    const box = art.getBoundingClientRect();
    const width = Math.round(box.width);
    // 锚到 h2 之后的第一段：取景框正好装下「一段原文 + 它的译文」，
    // 六种样式的差别就落在画面中央，而不是只剩标题那一行
    const p = art.querySelector('h2 + p');
    const top = p ? p.getBoundingClientRect().top - 10 : 16;
    return {
      x: Math.round(box.left),
      y: Math.max(0, Math.round(top)),
      width,
      height: Math.round(width / r),
    };
  }, ratio);
}

// ── 各张截图 ─────────────────────────────────────────

async function shot01and02(context, sw, locale, outDir, only) {
  const cfg = LOCALES[locale];
  await seedSettings(sw, { to: cfg.to, displayMode: 'bilingual', style: 'default' });
  const page = await openArticle(context, locale);
  await translatePage(page);
  await scrollToBody(page);

  if (!only || only.has('01')) {
    const p = join(outDir, '01-bilingual.png');
    await page.screenshot({ path: p });
    log(`  ${p}`);
  }

  if (!only || only.has('02')) {
    // 只切显示模式，两张图并排看就是同一段落的模式对比。
    // 隐藏原文后上方内容变短，重新按 h2 锚一次，保证两张构图起点一致
    await seedSettings(sw, { to: cfg.to, displayMode: 'translation-only', style: 'default' });
    await page.waitForTimeout(900);
    await scrollToBody(page);
    const p = join(outDir, '02-translation-only.png');
    await page.screenshot({ path: p });
    log(`  ${p}`);
  }

  await page.close();
}

async function shot03(context, sw, locale, outDir) {
  const cfg = LOCALES[locale];
  // 关掉段落按钮：dim 那格必须靠悬停触发，开着按钮会只在这一格多出一个悬浮控件
  await seedSettings(sw, {
    to: cfg.to,
    displayMode: 'bilingual',
    style: 'default',
    showParagraphBtn: false,
  });

  // 先开拼图页量格子的宽高比，再据此决定 clip —— 比例写死在两处迟早会漂
  const grid = await context.newPage();
  await grid.setViewportSize(SHOT);
  await grid.goto(`${BASE}/styles-grid.html`, { waitUntil: 'domcontentloaded' });
  const ratio = await grid.evaluate(() => window.shotRatio());

  const page = await openArticle(context, locale);
  await translatePage(page);
  await scrollToBody(page);
  const clip = await bodyClip(page, ratio);

  const items = [];
  for (const id of STYLE_IDS) {
    await seedSettings(sw, {
      to: cfg.to,
      displayMode: 'bilingual',
      style: id,
      showParagraphBtn: false,
    });
    await page.waitForTimeout(700);
    // 样式切换不该移动视口，但设置回写与重排都可能带偏，每格重新锚一次
    await scrollToBody(page);
    // 指针始终留在正文外：dim 预设的译文平时 opacity:0，悬停才淡入
    // （src/styles/presets.css）。静态图拍它的悬停态毫无意义 —— 那和 default
    // 长得一样；拍静止态才说得清这个样式在做什么，配 note 一行说明即可。
    await page.mouse.move(4, 4);
    const buf = await page.screenshot({ clip });
    items.push({
      id,
      label: cfg.styleLabels[id],
      note: cfg.styleNotes?.[id],
      dataUri: `data:image/png;base64,${buf.toString('base64')}`,
    });
    log(`  样式小图: ${id}`);
  }

  // 拼图页也在 localhost 上，内容脚本会往它上面画悬浮球 —— 先关掉
  await seedSettings(sw, {
    enabled: false,
    showFloatingBall: false,
    showParagraphBtn: false,
  });
  await grid.reload({ waitUntil: 'domcontentloaded' });
  await grid.evaluate(
    ([its, copy]) => window.renderGrid(its, copy),
    [items, cfg.gridCopy],
  );
  await grid.waitForTimeout(500);
  const p = join(outDir, '03-styles.png');
  await grid.screenshot({ path: p });
  log(`  ${p}`);

  await grid.close();
  await page.close();
}

async function shot04(context, sw, extId, locale, outDir) {
  const cfg = LOCALES[locale];
  await seedSettings(sw, { to: cfg.to, enginePriority: ['google-web', 'bing-edge', 'openai'] });
  // 假 key 只为让密钥卡片显示「已配置」；输入框是 type=password，画面里只有圆点
  await seedKeys(sw, DEMO_KEYS);

  const page = await context.newPage();
  await page.setViewportSize(SHOT);
  await page.goto(`chrome-extension://${extId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.click('[data-section="engines"]');
  await page.waitForTimeout(900);

  const p = join(outDir, '04-options.png');
  await page.screenshot({ path: p });
  log(`  ${p}`);
  await page.close();
}

async function shot05(context, sw, locale, outDir) {
  const cfg = LOCALES[locale];
  // 干净页面（不整页翻译）更能说清「划词翻译」这一件事；
  // 段落按钮同样关掉 —— 它会浮在选区右端，把画面重点搅乱
  await seedSettings(sw, {
    to: cfg.to,
    displayMode: 'bilingual',
    style: 'default',
    showParagraphBtn: false,
  });
  const page = await openArticle(context, locale);

  // 划词的目标必须留在视口里：拖选一旦从视口外起手，浏览器会把页面
  // 拽去跟随选区，取景就全乱了。这里以目标段落为锚自己定位。
  const { paraIndex, endsWith } = cfg.selection;
  const geo = await page.evaluate(
    ({ idx, tail }) => {
      const p = document.querySelectorAll('article p.byline ~ p')[idx];
      const top = p.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 180));

      // 选区终点落在句号后面，而不是按比例横拖 —— 后者会把最后一个词
      // 拦腰截断，译文跟着断在半句上
      const node = p.firstChild;
      const end = node.data.indexOf(tail) + tail.length;
      const range = document.createRange();
      range.setStart(node, end - 1);
      range.setEnd(node, end);
      const r = range.getBoundingClientRect();
      const start = p.getBoundingClientRect();
      return {
        startX: start.left + 2,
        startY: start.top + 10,
        endX: r.right,
        endY: r.top + r.height / 2,
      };
    },
    { idx: paraIndex, tail: endsWith },
  );
  await page.waitForTimeout(400);

  // 修饰键 + 拖光标：src/ui/selection-drag.ts 要求 mousedown 与 mouseup
  // 全程按住修饰键，中途松开即取消
  await page.keyboard.down('Alt');
  await page.mouse.move(geo.startX, geo.startY);
  await page.mouse.down();
  await page.mouse.move(geo.endX, geo.endY, { steps: 24 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  // toast 只活 3 秒（src/ui/toast.ts 的 TOAST_DURATION），必须在这个窗口内拍完；
  // 但也不能一出现就拍 —— pt-pop 淡入动画要 0.2s，抢拍会得到一个半透明的 toast
  await page.waitForSelector('#pt-host-toast .pt-toast', { timeout: 25_000 });
  await page.waitForTimeout(450);
  const p = join(outDir, '05-selection.png');
  await page.screenshot({ path: p });
  log(`  ${p}`);
  await page.close();
}

async function shotPromos(context, sw, locale, outDir) {
  // 宣传图页面同样在 localhost 上，内容脚本会照常注入。
  // 悬浮球只受 showFloatingBall 控制，与 enabled 无关（关掉扩展后球仍在，
  // 好让用户能再打开 —— 见 entrypoints/content.ts），所以这里两个都要关。
  await seedSettings(sw, {
    enabled: false,
    showFloatingBall: false,
    showParagraphBtn: false,
  });

  const sizes = [
    { name: 'promo-440x280.png', size: 'small', w: 440, h: 280 },
    { name: 'promo-1400x560.png', size: 'large', w: 1400, h: 560 },
  ];
  // 标识从图标的矢量源注入，而不是在 promo.html 里另画一份 ——
  // 字形只在 src/ui/logo.ts 定义一次，这里拿的是它生成的产物
  if (!existsSync(MARK_SVG)) {
    throw new Error(`缺少标识矢量源: ${MARK_SVG}\n  请先运行 pnpm icon:build。`);
  }
  const markSvg = readFileSync(MARK_SVG, 'utf8');

  const page = await context.newPage();
  for (const s of sizes) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto(`${BASE}/promo.html?lang=${locale}&size=${s.size}`, {
      waitUntil: 'load',
    });
    await page.evaluate((svg) => {
      document.getElementById('icon').innerHTML = svg;
    }, markSvg);
    await page.waitForTimeout(500);
    const p = join(outDir, s.name);
    await page.screenshot({ path: p });
    log(`  ${p}`);
  }
  await page.close();
}

// ── 主流程 ───────────────────────────────────────────

async function captureLocale(locale, opts) {
  const { only, headed } = opts;
  const outDir = join(OUT_ROOT, locale);
  mkdirSync(outDir, { recursive: true });

  log(`\n=== ${locale} 套 ===`);
  const { context, sw, extId } = await launchBrowser(locale, headed);
  try {
    if (!only || only.has('01') || only.has('02')) {
      await shot01and02(context, sw, locale, outDir, only);
    }
    if (!only || only.has('03')) await shot03(context, sw, locale, outDir);
    if (!only || only.has('04')) await shot04(context, sw, extId, locale, outDir);
    if (!only || only.has('05')) await shot05(context, sw, locale, outDir);
    if (!only || only.has('promo')) await shotPromos(context, sw, locale, outDir);
  } finally {
    await context.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  assertBuildOutput();
  // promo 不经翻译引擎，只拍它时没必要要求外网
  const needsEngine = !opts.only || [...opts.only].some((k) => k !== 'promo');
  if (needsEngine) await probeTranslateEndpoint();

  const server = await startServer();
  try {
    for (const locale of opts.locales) {
      await captureLocale(locale, opts);
    }
  } finally {
    server.close();
  }
  log('\n全部完成。上传前请按 store/screenshots/README.md 的清单逐张复核。');
}

main().catch((e) => {
  console.error(`\n截图失败: ${e.message}`);
  process.exit(1);
});
