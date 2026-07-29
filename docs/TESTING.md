# 测试方案

面向全功能完成后的自动化测试体系。目标是**全自动**：一条命令跑完，CI 上可无人值守执行。

## 定位与去重

各阶段文档已经带了自己的 DoD 与验证步骤，本文档**不重复它们**。分工如下：

| 关注点 | 归属 |
|---|---|
| 单个阶段内的功能是否实现 | 各阶段文档的 DoD — [phase-0](phases/phase-0-scaffold.md) … [phase-8](phases/phase-8-compat-release.md) |
| 跨阶段组合、长期运行、异常路径、合规 | 本文档 |

阶段 DoD 回答"这个功能做完了吗"，本文档回答"**全部做完之后，它们凑在一起还站得住吗**"。

## 分层策略

```
        ┌──────────────────────────────────┐
   少   │  E2E（Playwright + 本地 fixture） │  真实浏览器、真实扩展、真实翻译接口
        ├──────────────────────────────────┤
        │  集成（扩展上下文内）              │  真实 storage / 消息通道，真实 fetch
        ├──────────────────────────────────┤
   多   │  单元（vitest + mock）            │  纯逻辑，全部 mock，毫秒级
        └──────────────────────────────────┘
```

**真实调用的分层原则**：单元层全 mock（快、稳、可跑千次）；集成与 E2E 层真调（逆向端点随时可能变更，这是本项目最大的技术风险，必须由测试兜住）。

## 为什么 CI 不跑真实站点

Reddit / YouTube / X 的 DOM 会随对方改版而变，会要求登录，会对无头浏览器做拦截。把它们放进 CI，套件会因为**别人改版**而红，而不是因为我们的代码坏了。红得多了就没人信，套件随之作废。

因此拆成两条线：

| 线 | 对象 | 频率 | 性质 |
|---|---|---|---|
| 自动化主线 | 本地 fixture 页面 | 每次 push | 必须绿，红了就是我们的问题 |
| 真实站点冒烟 | Reddit/YouTube/X/Medium/Wikipedia | 发布前 + 每周定时 | 允许红，红了先判断是对方改版还是我们的 bug |

fixture 不是"简化版测试"，而是**把各站点的结构特征提炼成可控样本**：shadow DOM 嵌套、同源 iframe、无限滚动、SPA 路由、激进 CSS reset。这些特征稳定不变，站点的皮肤才是易变的。

## 工具链

| 层 | 工具 |
|---|---|
| 单元 | vitest + jsdom |
| 集成 / E2E | Playwright（`launchPersistentContext` 加载扩展） |
| 性能与内存 | Playwright CDP session（`Performance.getMetrics`、`HeapProfiler`） |
| fixture 托管 | vite preview（静态服务器） |
| CI | GitHub Actions |

```bash
pnpm test          # 单元，秒级
pnpm test:e2e      # E2E，含真实接口调用
pnpm test:all      # 全部
```

---

## 一、Playwright 扩展夹具

MV3 扩展在 Playwright 中的加载方式与普通页面不同 —— 必须用持久化上下文，且扩展 id 要从 service worker 的 URL 里取。

`e2e/fixtures.ts`：

```typescript
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const EXT_PATH = path.resolve(__dirname, '../.output/chrome-mv3');

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    // 扩展只能在持久化上下文中加载，无法用普通 browser.newContext()
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // service worker 可能尚未启动，需要等待
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);   // chrome-extension://<id>/...
  },
});

export const expect = test.expect;

/** 直接改扩展设置，绕开 UI 操作 —— 让测试聚焦被测行为而非点按钮 */
export async function setSettings(context: BrowserContext, patch: object) {
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async (p) => {
    const cur = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] ?? {};
    await chrome.storage.sync.set({ 'pt-settings': { ...cur, ...p } });
  }, patch);
}
```

## 二、fixture 页面

`e2e/fixtures/` 下的静态页面，每个针对一类 DOM 特征：

| 文件 | 复刻的特征 | 对应真实站点 |
|---|---|---|
| `basic.html` | 标准 `p`/`li`/`h*` 结构 | Wikipedia |
| `shadow.html` | 三层嵌套 shadow root，含 closed 模式旁路 | Reddit |
| `custom-elements.html` | 自定义元素 + slot 分发 | YouTube |
| `iframe.html` | 同源 iframe 内含可翻译内容 | 各类嵌入 |
| `infinite.html` | 滚动到底部追加 20 个段落 | X 时间线 |
| `spa.html` | `history.pushState` 切换视图并整体替换内容 | Medium |
| `hostile.html` | `* { all: unset !important }`、`z-index: 2147483646`、`div { position: static !important }` | X / Notion |
| `noise.html` | 纯数字、日期、价格、超长段落、`.notranslate` | 通用边界 |
| `nested.html` | `div > p`、`p > span > a` 等嵌套结构 | 重复翻译陷阱 |

`shadow.html` 骨架：

```html
<div id="host-a"></div>
<script>
  const a = document.getElementById('host-a').attachShadow({ mode: 'open' });
  a.innerHTML = '<p>First level shadow paragraph for translation.</p><div id="host-b"></div>';
  const b = a.querySelector('#host-b').attachShadow({ mode: 'open' });
  b.innerHTML = '<p>Second level shadow paragraph for translation.</p><div id="host-c"></div>';
  const c = b.querySelector('#host-c').attachShadow({ mode: 'open' });
  c.innerHTML = '<p>Third level shadow paragraph for translation.</p>';
</script>
```

## 三、跨阶段集成场景

阶段文档各自验证单点功能，这里验证**组合起来是否仍成立**。

`e2e/integration.spec.ts`：

```typescript
test('样式切换后新滚动出的内容保持当前样式', async ({ page, context }) => {
  // 阶段 3 的 observer × 阶段 4 的样式系统
  await setSettings(context, { style: 'underline' });
  await page.goto(`${FIXTURE}/infinite.html`);
  await translatePage(page);
  await page.mouse.wheel(0, 20000);                    // 触发追加
  await page.waitForFunction(() => document.querySelectorAll('.pt-trans').length > 20);

  const decorated = await page.$$eval('.pt-trans', els =>
    els.every(e => getComputedStyle(e).textDecorationLine.includes('underline')));
  expect(decorated).toBe(true);   // 新节点也应带下划线，而非默认样式
});

test('仅译文模式下单段翻译新段落，原文仍保持隐藏', async ({ page, context }) => {
  // 阶段 4 的模式 × 阶段 5 的段落按钮
});

test('故障切换发生后缓存记录的是实际生效引擎', async ({ page, context }) => {
  // 阶段 1 的缓存 key × 阶段 2 的 router
  // 屏蔽 Google → 走 Bing → 缓存 key 前缀应为 bing-edge 而非 google-web
  // 否则恢复 Google 后会误命中 Bing 的译文
});

test('快捷键切换模式后自定义 CSS 仍然生效', async ({ page, context }) => {
  // 阶段 6 的快捷键 × 阶段 4 的自定义 CSS
});

test('设置页改引擎优先级，已打开的标签页立即生效', async ({ page, context }) => {
  // 阶段 1 的 onSettingsChanged × 阶段 2 的 router，验证跨上下文同步
});

test('翻译 → 还原 → 再翻译，DOM 结构与首次一致', async ({ page }) => {
  // 阶段 4 的 render/unrender 幂等性，反复操作不应残留或嵌套
});
```

## 四、性能与内存

这是阶段文档完全没覆盖的部分，也是长期运行下最容易出事的地方。

`e2e/perf.spec.ts`：

```typescript
async function heapUsed(page: Page): Promise<number> {
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');    // 强制 GC，否则读数无意义
  await client.send('Performance.enable');
  const { metrics } = await client.send('Performance.getMetrics');
  return metrics.find(m => m.name === 'JSHeapUsedSize')!.value;
}

test('无限滚动 50 轮后堆内存不持续增长', async ({ page }) => {
  await page.goto(`${FIXTURE}/infinite.html`);
  await translatePage(page);

  const baseline = await heapUsed(page);
  for (let i = 0; i < 50; i++) {
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(200);
  }
  const after = await heapUsed(page);

  // 允许合理增长（译文节点本身占内存），但不应成倍膨胀
  expect(after).toBeLessThan(baseline * 2.5);
});

test('反复翻译-还原 100 次无节点泄漏', async ({ page }) => {
  await page.goto(`${FIXTURE}/basic.html`);
  const before = await page.evaluate(() => document.querySelectorAll('*').length);

  for (let i = 0; i < 100; i++) {
    await translatePage(page);
    await restorePage(page);
  }

  const after = await page.evaluate(() => document.querySelectorAll('*').length);
  expect(after).toBe(before);   // 严格相等：还原必须完全干净
});

test('长页面翻译耗时在可接受范围', async ({ page }) => {
  await page.goto(`${FIXTURE}/basic-long.html`);   // 200 段
  const t0 = Date.now();
  await translatePage(page);
  await page.waitForFunction(() => document.querySelectorAll('.pt-trans').length >= 200);
  expect(Date.now() - t0).toBeLessThan(30_000);
});

test('并发请求数不超过配置上限', async ({ page }) => {
  let inflight = 0, peak = 0;
  page.on('request', r => { if (isTranslateApi(r.url())) peak = Math.max(peak, ++inflight); });
  page.on('requestfinished', r => { if (isTranslateApi(r.url())) inflight--; });
  page.on('requestfailed',   r => { if (isTranslateApi(r.url())) inflight--; });

  await page.goto(`${FIXTURE}/basic-long.html`);
  await translatePage(page);
  expect(peak).toBeLessThanOrEqual(6);
});

test('observer 断开后不再产生请求', async ({ page }) => {
  // 关闭扩展 → 滚动 → 不应有新翻译请求，验证 observer 被正确 disconnect
});

test('缓存达上限后条目数稳定', async ({ context }) => {
  const [sw] = context.serviceWorkers();
  const count = await sw.evaluate(async () => {
    for (let i = 0; i < 5200; i++) { /* 写入 */ }
    return (await chrome.storage.local.get('pt-cache-index'))['pt-cache-index'].length;
  });
  expect(count).toBeLessThanOrEqual(5000);
});
```

## 五、异常与边界

`e2e/resilience.spec.ts`：

| 场景 | 注入方式 | 预期 |
|---|---|---|
| 主引擎不可达 | `route.abort()` 拦截 Google 域 | 自动切 Bing，用户无感 |
| 全部引擎不可达 | 拦截两个域 | error 态 + 可读提示，页面不崩、原文无损 |
| 端点限流 429 | `route.fulfill({ status: 429 })` | 视为 retryable，切换或退避重试 |
| JWT 过期 401 | 首次 200 后续 401 | 清空缓存令牌并重取，翻译最终成功 |
| 端点返回畸形 JSON | `route.fulfill({ body: 'not json' })` | 捕获异常，不污染页面 |
| 响应条目数不匹配 | 返回少于请求数的译文 | 缺失段落留空，**其余段落不错位** |
| BYOK 密钥无效 | 401 | 直接报错，**不触发故障切换** |
| 网络中途断开 | 翻译进行中 `context.setOffline(true)` | 已完成部分保留，未完成给出提示 |
| 超长段落 | fixture 含 5000 字符段落 | 被跳过，不发送请求 |
| 空页面 | `<body></body>` | 不报错，不发请求 |
| 快速重复点击 | 200ms 内点悬浮球 10 次 | 请求不重复叠加，状态机不错乱 |
| 翻译中途切换语言 | 请求在飞时改 `to` | 旧结果被丢弃，不与新语言译文混排 |
| 页面 CSP 极严 | fixture 设 `Content-Security-Policy: default-src 'none'` | 注入 UI 仍正常（shadow + 内联样式不受 CSP script 限制） |
| storage 配额耗尽 | 塞满 sync 区 | 给出提示，不静默丢设置 |

```typescript
test('响应条目数不足时其余段落不错位', async ({ page, context }) => {
  await context.route('**/translate**', async route => {
    // 请求 5 段，只返回 3 段
    await route.fulfill({ json: mockPartialResponse(3) });
  });
  await page.goto(`${FIXTURE}/basic.html`);
  await translatePage(page);

  const pairs = await page.$$eval('[data-pt="done"]', els => els.map(e => ({
    o: e.querySelector('.pt-origin')?.textContent?.trim(),
    t: e.querySelector('.pt-trans')?.textContent?.trim(),
  })));
  // 逐条断言译文与原文对应关系，而不只是数量
  expect(pairs.every(p => p.t === '' || isCorrectPair(p.o!, p.t!))).toBe(true);
});
```

## 六、隐私与合规

可自动化的部分全部自动化 —— 这些是上架审核会逐条核对的内容。

`e2e/privacy.spec.ts`：

```typescript
test('全流程仅访问允许的主机', async ({ page, context }) => {
  const ALLOWED = [
    'translate.googleapis.com',
    'edge.microsoft.com',
    'api-edge.cognitive.microsofttranslator.com',
    'localhost',           // fixture 服务器
  ];
  const violations: string[] = [];
  context.on('request', r => {
    const host = new URL(r.url()).hostname;
    if (r.url().startsWith('chrome-extension://')) return;
    if (!ALLOWED.some(a => host.endsWith(a))) violations.push(r.url());
  });

  // 跑一整套核心流程
  await runFullFlow(page, context);
  expect(violations).toEqual([]);   // 零埋点、零分析、零意外外发
});

test('manifest 权限最小化', async () => {
  const m = JSON.parse(fs.readFileSync('.output/chrome-mv3/manifest.json', 'utf8'));
  expect(m.permissions.sort()).toEqual(['contextMenus', 'storage']);
  expect(m.host_permissions).toBeUndefined();
  expect(m.content_scripts[0].matches).toEqual(['<all_urls>']);
});

test('API 密钥不进 sync 存储', async ({ context }) => {
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => setKey('openai', 'sk-test-should-never-sync'));
  const sync = await sw.evaluate(() => chrome.storage.sync.get(null));
  expect(JSON.stringify(sync)).not.toContain('sk-test');
});

test('设置导出不含密钥', async ({ context }) => {
  const [sw] = context.serviceWorkers();
  const exported = await sw.evaluate(() => exportSettings());
  expect(JSON.stringify(exported)).not.toContain('sk-');
  expect(Object.keys(exported)).not.toContain('pt-keys');
});

test('禁用扩展后不发出任何请求', async ({ page, context }) => {
  await setSettings(context, { enabled: false });
  const reqs: string[] = [];
  context.on('request', r => { if (isTranslateApi(r.url())) reqs.push(r.url()); });
  await page.goto(`${FIXTURE}/basic.html`);
  await page.waitForTimeout(3000);
  expect(reqs).toEqual([]);
});

test('黑名单站点不发出请求', async ({ page, context }) => {
  await setSettings(context, { siteList: { mode: 'blacklist', list: ['localhost'] } });
  // 同上断言
});
```

**隐私政策一致性**：`privacy-policy.md` 中列出的外发主机，必须与上面 `ALLOWED` 常量完全一致。加一个测试直接解析文档做比对，防止改了代码忘了改政策：

```typescript
test('隐私政策列出的主机与实际允许清单一致', () => {
  const doc = fs.readFileSync('store/privacy-policy.md', 'utf8');
  for (const host of ALLOWED.filter(h => h !== 'localhost')) {
    expect(doc).toContain(host);
  }
});
```

## 七、单元测试要点

阶段文档已列出各模块的验证点，此处只强调**单元层专属**的覆盖 —— 用 mock 才跑得起来的边界：

| 模块 | 重点用例 |
|---|---|
| `engines/*` | 各家响应格式解析；畸形响应；`from: 'auto'` 的参数差异（Google 传 `auto`、Bing 传空串）；`retryable` 判定 |
| `engines/router` | 优先级遍历顺序；`retryable: false` 立即抛；`supportedLangs` 跳过；全失败的错误聚合 |
| `parseNumbered` | 漏行、多行、编号乱序、编号格式变体（`1.` / `1、` / `1)`）；**输出长度恒等于输入长度** |
| `dom/classify` | 三集合判定；嵌套结构只产生一个翻译单元；数字识别的真/假阳性 |
| `dom/walker` | 多层 shadow 递归；`data-pt-ui` 拒绝整棵子树；去重 |
| `hotkeys/normalize` | mac/win 同一物理按键得到同一平台无关表示；单修饰键返回 null；无修饰键返回 null |
| `hotkeys/platform` | `formatHotkey` 在三平台的输出；Mac 修饰键顺序 ⌃⌥⇧⌘ |
| `styles/custom` | 各类非法输入被拒；合法输入正确包裹作用域 |
| `storage/settings` | 读取时与默认值合并，`hotkeys` / `siteList` / `models` 递归到子键；`patchSettings` 传嵌套对象不丢兄弟键，也不把用户自定义值退回默认；变更订阅触发与退订 |
| `storage/cache` | LRU 淘汰；并发 `cacheSet` / `cacheGet` 不丢 index 条目、不留孤儿；命中刷新 LRU 位置；key 生成的稳定性与跨站点一致性 |
| `storage/keys` | 密钥只写 local；`removeKey` 不误伤其他引擎 |

## 八、CI 编排

`.github/workflows/test.yml`：

```yaml
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm test                      # 全 mock，秒级，每次 push 都跑

  e2e:
    runs-on: ubuntu-latest
    # 真调翻译接口，串行避免额度浪费与端点限流
    concurrency: { group: e2e, cancel-in-progress: true }
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }

  hotkeys-macos:
    # 快捷键显示的 Mac 分支只能在 macOS runner 上真实验证
    runs-on: macos-latest
    steps:
      - run: pnpm test:e2e -- --grep "@mac"

  smoke-real-sites:
    # 真实站点单独跑，允许失败，不阻塞合并
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    continue-on-error: true
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:e2e -- --grep "@real"
```

**关键编排决策**：真实站点 job 设 `continue-on-error: true` 且只在定时或手动触发时跑。它红了是信号不是故障 —— 说明某个站点改版了，需要人去看，但不该阻塞其他人合并代码。

## 九、发布前全量检查

上架前跑一次完整流程：

```bash
pnpm test:all                              # 单元 + E2E 全绿
pnpm build && pnpm build -b firefox && pnpm build -b edge
pnpm test:e2e -- --grep "@real"            # 真实站点冒烟，人工确认
```

外加下列**无法自动化**的人工项 —— 诚实列出，不假装覆盖：

- [ ] 5 个真实站点 × 6 个入口 × 3 种模式的人工走查（详见 [phase-8](phases/phase-8-compat-release.md) 的回归矩阵）
- [ ] Firefox / Edge 手动加载并跑核心流程（跨浏览器自动化投入产出比不划算）
- [ ] 译文质量主观评估（各引擎各抽 10 段人工阅读）
- [ ] 注入 UI 在 10 个真实站点上的视觉一致性目测
- [ ] 商店截图与描述的准确性
- [ ] 隐私政策文本的法律表述

## 覆盖率目标

| 层 | 目标 |
|---|---|
| 单元 | `src/engines`、`src/dom`、`src/hotkeys`、`src/styles` 行覆盖 ≥ 85% |
| E2E | 9 个 fixture 页面全部通过；六个触发入口全部覆盖；三种模式全部覆盖 |
| 异常 | 上表 14 个场景全部有对应用例 |
| 合规 | 6 项隐私断言全绿 |

覆盖率不是目标本身 —— `src/ui` 这类重 DOM 交互的模块不强求行覆盖，靠 E2E 保证即可。
