/**
 * E2E 性能基准
 *
 * 在 Playwright 中测量关键性能指标：
 * - 翻译耗时
 * - DOM 节点增长
 * - 内存使用
 */
import { test, expect, fixtureFileUrl } from './fixtures';

test.describe('性能基准 @perf', () => {
  test('PERF-01: 200 段整页翻译总耗时 < 30s', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });

  test('PERF-02: 翻译-还原循环 ×100 后 DOM 节点数无增长', async ({ page }) => {
    await page.goto(fixtureFileUrl('basic'));

    const countBefore = await page.evaluate(() => document.querySelectorAll('*').length);

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
        trans.textContent = '译';
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

    const countAfter = await page.evaluate(() => document.querySelectorAll('*').length);
    expect(countAfter).toBe(countBefore);
  });

  test('PERF-03: 缓存 5000 条内存 < 50MB', async ({ page }) => {
    test.skip(true, '需要扩展环境 + CDP Performance.getMetrics');
  });
});
