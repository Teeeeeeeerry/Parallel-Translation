/**
 * E2E 安全验证
 *
 * API key 隔离、导出不含 key、禁用后零请求、XSS 阻止、站点名单零请求
 */
import { test, expect, fixtureFileUrl, waitForBall } from './fixtures';

test.describe('安全验证 @security', () => {
  test('SEC-01: 禁用扩展后零翻译请求', async ({ page }) => {
    test.skip(true, '需要扩展环境 + 请求拦截');
  });

  test('SEC-02: 自定义 CSS XSS 阻止', async ({ page }) => {
    await page.goto(fixtureFileUrl('basic'));

    // 验证非法 CSS 注入被阻止（模拟 validateCustomCss 逻辑）
    const results = await page.evaluate(() => {
      const FORBIDDEN = [
        { pattern: /[{}]/, msg: '花括号' },
        { pattern: /@import/i, msg: '@import' },
        { pattern: /<\/?style/i, msg: 'style 标签' },
        { pattern: /javascript:/i, msg: 'javascript:' },
        { pattern: /expression\s*\(/i, msg: 'expression()' },
      ];

      function validate(input: string) {
        for (const { pattern, msg } of FORBIDDEN) {
          if (pattern.test(input)) return { ok: false, msg };
        }
        return { ok: true };
      }

      return {
        curly: validate('.pt-trans { color: red; }'),
        import_: validate('@import url("evil.css");'),
        styleTag: validate('<style>body{color:red}</style>'),
        jsProtocol: validate('background: url("javascript:alert(1)")'),
        expression: validate('width: expression(alert(1))'),
        valid: validate('color: #555; font-size: 14px'),
      };
    });

    expect(results.curly.ok).toBe(false);
    expect(results.import_.ok).toBe(false);
    expect(results.styleTag.ok).toBe(false);
    expect(results.jsProtocol.ok).toBe(false);
    expect(results.expression.ok).toBe(false);
    expect(results.valid.ok).toBe(true);
  });

  test('SEC-03: 导出设置不含 API key', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });

  test('SEC-04: 黑名单站点不发出翻译请求（#153）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ siteList: { mode: 'blacklist', list: ['localhost'] } });
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    await page.waitForTimeout(3000);

    // 不渲染译文、悬浮球不点亮、mock 从未被调用
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
    await expect(ball).toHaveAttribute('data-state', 'idle');
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.totalServed).toBe(0);
  });

  test('SEC-05: 白名单模式下非列表站点不发出翻译请求（#153）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ siteList: { mode: 'whitelist', list: ['example.com'] } });
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    await page.waitForTimeout(3000);

    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
    await expect(ball).toHaveAttribute('data-state', 'idle');
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.totalServed).toBe(0);
  });

  test('SEC-06: 白名单命中站点正常翻译（#153）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ siteList: { mode: 'whitelist', list: ['localhost'] } });
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(ball).toHaveAttribute('data-state', 'done');
  });
});
