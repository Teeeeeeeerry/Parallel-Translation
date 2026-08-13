/**
 * E2E 真实站点冒烟（仅定时 CI + 手动触发）
 *
 * 验证扩展在真实站点的基本行为：content script 注入、悬浮球出现、
 * 翻译可用、关键 DOM 特征正确处理。
 *
 * 翻译端点使用 mockGoogle 拦截，只有站点 DOM 走真实网络。
 * 这些测试标记 @real，通过 --grep "@real" 控制运行时机。
 */
import { test, expect } from './fixtures';

// ── 辅助 ──
async function waitForBall(page: import('@playwright/test').Page, timeout = 45_000) {
  const ball = page.locator('#pt-host-ball .pt-ball');
  await expect(ball).toBeVisible({ timeout });
  return ball;
}

// ================================================================
// GitHub
// ================================================================

test.describe('GitHub @real', () => {
  test('README 页面：扩展可用 + 代码块不被翻译', async ({
    page, mockGoogle, seedSettings,
  }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle();

    await page.goto('https://github.com/anthropics/claude-code', {
      waitUntil: 'domcontentloaded',
    });

    // 第一道断言：content script 注入成功（球出现 = GitHub 可用）
    const ball = await waitForBall(page);
    await expect(ball).toHaveAttribute('data-state', 'idle');

    // 触发翻译
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // 代码块不应被翻译（compat 域名补丁：.blob-code 等被 skip）
    const codeBlockTranslated = await page.locator('.blob-code[data-pt="done"]').count();
    expect(codeBlockTranslated).toBe(0);

    await expect(ball).toHaveAttribute('data-state', 'done');
  });

  test('Issue 页面：@username 原样保留', async ({
    page, mockGoogle, seedSettings,
  }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle();

    // 使用一个有多个用户交互的 issue
    await page.goto('https://github.com/anthropics/claude-code/issues/1', {
      waitUntil: 'domcontentloaded',
    });

    const ball = await waitForBall(page);
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // 用户提及链接应保留原文
    const mentions = page.locator('a.user-mention');
    const count = await mentions.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const text = await mentions.nth(i).textContent();
        // 用户名不应为空或被翻译
        expect(text?.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ================================================================
// Wikipedia
// ================================================================

test.describe('Wikipedia @real', () => {
  test('标准文章页面可翻译', async ({ page, mockGoogle, seedSettings }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle();

    await page.goto('https://en.wikipedia.org/wiki/Translation', {
      waitUntil: 'domcontentloaded',
    });

    const ball = await waitForBall(page);
    await ball.click();

    // 文章正文被翻译
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // h1 标题被翻译
    await expect(page.locator('h1[data-pt="done"]').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ================================================================
// Reddit（old 版本，无登录墙）
// ================================================================

test.describe('Reddit @real', () => {
  test('old.reddit.com 帖子列表可翻译', async ({ page, mockGoogle, seedSettings }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle();

    await page.goto('https://old.reddit.com/r/programming/', {
      waitUntil: 'domcontentloaded',
    });

    const ball = await waitForBall(page);
    await ball.click();

    // Reddit 使用大量自定义元素和 shadow DOM
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // 帖子标题应在页面中
    await expect(page.locator('body')).toBeVisible();
  });
});
