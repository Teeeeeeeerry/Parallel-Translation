/**
 * E2E 性能基准
 *
 * 在 Playwright 中测量关键性能指标：
 * - 翻译耗时
 * - DOM 节点增长
 * - 内存使用
 */
import { test, expect, fixtureFileUrl, waitForBall } from './fixtures';

test.describe('性能基准 @perf', () => {
  test('PERF-01: 200 段整页翻译总耗时 < 30s', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });

  test('PERF-02: 翻译-还原循环 ×100 后 DOM 节点数无增长', async ({ page }) => {
    await page.goto(fixtureFileUrl('basic'));

    // #488: content script 同样注入 file:// 页面，悬浮球与段落按钮的宿主
    // 可能在第一次计数之后才出现。只数页面自身的节点：跳过带 data-pt-ui
    // 标记的扩展界面宿主及其子树。
    const countPageNodes = () =>
      page.evaluate(
        () => [...document.querySelectorAll('*')].filter((el) => !el.closest('[data-pt-ui]')).length,
      );
    const countBefore = await countPageNodes();

    // 模拟 100 次 render/unrender 循环
    for (let i = 0; i < 100; i++) {
      await page.evaluate((n) => {
        const p = document.querySelector('p');
        if (!p) return;
        // 模拟 render
        p.setAttribute('data-pt', 'done');
        const origin = document.createElement('span');
        origin.className = 'pt-origin';
        while (p.firstChild) origin.appendChild(p.firstChild);
        const trans = document.createElement('span');
        trans.className = 'pt-trans';
        trans.textContent = '译'; // cjk-ok: 模拟译文节点的内容
        p.appendChild(origin);
        p.appendChild(trans);

        // 模拟 unrender
        const o = p.querySelector(':scope > .pt-origin');
        const t = p.querySelector(':scope > .pt-trans');
        if (o) {
          while (o.firstChild) p.insertBefore(o.firstChild, o);
          o.remove();
        }
        t?.remove();
        p.removeAttribute('data-pt');
      }, i);
    }

    const countAfter = await countPageNodes();
    expect(countAfter).toBe(countBefore);
  });

  test('PERF-03: 缓存 5000 条内存 < 50MB', async ({ page }) => {
    test.skip(true, '需要扩展环境 + CDP Performance.getMetrics');
  });
});

/**
 * #1083（父 #1071）：观测每批在三层的耗时 —— content 侧发送闸门排队、后台引擎
 * 闸门排队、引擎调用 —— 以及超时次数（content 的单次响应超时与后台的引擎时段
 * 超时，#1071），确认“排队时间吃掉超时预算”是否仍会出现。只观测，不加断言；默认跳过，PT_BATCH_TIMING=1 时才跑：
 *
 *   PT_BATCH_TIMING=1 pnpm exec playwright test --config docs/testing/playwright.config.ts --grep PERF-04
 *
 * 每个组合把调试日志的每一行（[PT] 批次耗时 {…}）写进
 * docs/testing/logs/batch-timing-<夹具>-<延时>.json。替身每个请求慢 delayMs
 * 毫秒（google-web 一条文本一个请求）；PT_BATCH_TIMING_DELAYS 可改延时列表。
 */
test.describe('批次三段耗时观测（#1083） @perf', () => {
  const delays = (process.env.PT_BATCH_TIMING_DELAYS ?? '200,600').split(',').map(Number);
  for (const fixture of ['wiki-results-table', 'wiki-article'] as const) {
    for (const delayMs of delays) {
      test(`PERF-04: ${fixture}，替身每请求 ${delayMs}ms`, async ({ page, serviceWorker, seedSettings, mockGoogle, gotoFixture }) => {
        test.skip(!process.env.PT_BATCH_TIMING, '观测用，PT_BATCH_TIMING=1 时才跑');
        test.setTimeout(1_200_000);
        await seedSettings({ useCache: false });
        await mockGoogle({ delayMs });
        await serviceWorker.evaluate(() => chrome.storage.local.set({ 'pt-debug-batch-timing': true }));
        const records: unknown[] = [];
        page.on('console', (m) => {
          const t = m.text();
          if (t.startsWith('[PT] 批次耗时 ')) records.push(JSON.parse(t.slice('[PT] 批次耗时 '.length))); // cjk-ok: 匹配调试日志前缀
        });
        await gotoFixture(fixture);
        const ball = await waitForBall(page);
        const startedAt = Date.now();
        await ball.click();
        // 观测用：等不到结束也照样把已经记下的写出来
        await expect(ball)
          .toHaveAttribute('data-state', /^(done|error)$/, { timeout: 1_100_000 })
          .catch(() => {});
        const totalMs = Date.now() - startedAt;
        const fs = await import('fs');
        fs.mkdirSync('docs/testing/logs', { recursive: true });
        fs.writeFileSync(
          `docs/testing/logs/batch-timing-${fixture}-${delayMs}.json`,
          JSON.stringify({ fixture, delayMs, totalMs, state: await ball.getAttribute('data-state'), records }, null, 2),
        );
      });
    }
  }
});
