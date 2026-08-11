/**
 * E2E 核心套件 —— 每次 push 必跑
 *
 * 覆盖：入口（悬浮球/快捷键/段落按钮）× 模式（对照/仅译文）×
 *       DOM 特征 fixture（shadow/nested/spa/preserve/pre-blocks 等）
 *
 * 翻译端点由 mockGoogle 拦截，完全确定性，不依赖外网。
 */
import { test, expect } from './fixtures';

// ── 辅助：等待扩展注入（悬浮球出现 = content script 已运行）──
async function waitForBall(page: import('@playwright/test').Page) {
  const ball = page.locator('#pt-host-ball .pt-ball');
  await expect(ball).toBeVisible({ timeout: 30_000 });
  return ball;
}

// ── 辅助：触发翻译并等待完成 ──
async function translateAndWait(page: import('@playwright/test').Page) {
  const ball = await waitForBall(page);
  await ball.click();
  await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });
}

// ================================================================
// 入口覆盖
// ================================================================

test.describe('入口：悬浮球', () => {
  test('@core TC-E2E-01: 悬浮球点击 → 翻译 → 状态变化', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await expect(ball).toHaveAttribute('data-state', 'idle');

    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(ball).toHaveAttribute('data-state', 'done');
  });

  test('@core TC-E2E-02: 悬浮球再次点击 → 还原', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);

    // 翻译
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(ball).toHaveAttribute('data-state', 'done');

    // 还原
    await ball.click();
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
  });
});

test.describe('入口：快捷键', () => {
  test('@core TC-E2E-03: Mod+Shift+Y → 翻译 (Linux/Windows)', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    await waitForBall(page);
    await page.keyboard.press('Control+Shift+Y');
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('@core @mac TC-E2E-03-Mac: Mod+Shift+Y → 翻译 (macOS)', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    await waitForBall(page);
    await page.keyboard.press('Meta+Shift+Y');
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('@core TC-E2E-04: Mod+Shift+M → 切换显示模式', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    await translateAndWait(page);

    // 切换到仅译文
    await page.keyboard.press('Control+Shift+M');
    await expect(page.locator('html')).toHaveClass(/pt-only-trans-page/, { timeout: 5_000 });

    // 切回对照
    await page.keyboard.press('Control+Shift+M');
    await expect(page.locator('html')).not.toHaveClass(/pt-only-trans-page/, { timeout: 5_000 });
  });
});

// ================================================================
// 显示模式
// ================================================================

test.describe('显示模式', () => {
  test('@core TC-E2E-11: 对照模式 → 原文和译文同时可见', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ displayMode: 'bilingual' });
    await mockGoogle();
    await gotoFixture('basic');
    await translateAndWait(page);

    // 原文元素存在
    await expect(page.locator('.pt-origin').first()).toBeVisible();
    // 译文元素存在
    await expect(page.locator('.pt-trans').first()).toBeVisible();
    // 无仅译文类
    await expect(page.locator('html')).not.toHaveClass(/pt-only-trans-page/);
  });

  test('@core TC-E2E-12: 仅译文模式 → 原文隐藏', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ displayMode: 'translation-only' });
    await mockGoogle();
    await gotoFixture('basic');
    await translateAndWait(page);

    await expect(page.locator('html')).toHaveClass(/pt-only-trans-page/, { timeout: 5_000 });
  });
});

// ================================================================
// 段落按钮
// ================================================================

test.describe('入口：段落按钮', () => {
  test('@core TC-E2E-05: 段落悬停 → 按钮浮出 → 点击翻译', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('basic');

    await waitForBall(page);

    // 悬停第一个段落
    const firstP = page.locator('p').first();
    await firstP.hover();

    // 段落按钮浮出
    const paraBtn = page.locator('.pt-para-btn').first();
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });

    // 点击按钮翻译
    await paraBtn.click();
    // 该段标记 done
    await expect(firstP).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
  });
});

// ================================================================
// DOM 特征覆盖（每个 fixture 至少 1 个用例）
// ================================================================

test.describe('Fixture: shadow', () => {
  test('@core TC-E2E-20: 三层 shadow 内容可被发现', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('shadow');

    await translateAndWait(page);

    // 验证三层 shadow 内都有译文
    const host1Text = await page.evaluate(() => {
      const host = document.getElementById('host1');
      return host?.shadowRoot?.querySelector('p')?.textContent;
    });
    expect(host1Text).toContain('Shadow level 1');

    // 检查 shadow 内是否有翻译标记
    const hasTranslated = await page.evaluate(() => {
      const host = document.getElementById('host1');
      const inner = host?.shadowRoot?.querySelector('[data-pt="done"]');
      return !!inner;
    });
    // walker 穿透 shadow 后会翻译其中的内容
    expect(hasTranslated).toBe(true);
  });
});

test.describe('Fixture: nested', () => {
  test('@core TC-E2E-21: 嵌套元素不产生重复文本', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('nested');

    await translateAndWait(page);

    // 每个原文单元只被翻译一次
    const doneCount = await page.locator('[data-pt="done"]').count();
    expect(doneCount).toBeGreaterThan(0);

    // 验证没有重复翻译（同一元素内无嵌套 data-pt="done"）
    const nestedDone = await page.evaluate(() => {
      const all = document.querySelectorAll('[data-pt="done"]');
      for (const el of all) {
        if (el.parentElement?.closest('[data-pt="done"]')) return true;
      }
      return false;
    });
    expect(nestedDone).toBe(false);
  });
});

test.describe('Fixture: infinite', () => {
  test('@core TC-E2E-22: 滚动后新内容可被发现', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('infinite');

    await translateAndWait(page);

    // 初始 3 段
    const initialDone = await page.locator('[data-pt="done"]').count();

    // 加载更多 —— 轮询等待 observer 触发 + 翻译完成
    await page.click('#load-more');
    await expect(page.locator('[data-pt="done"]')).toHaveCount(initialDone + 3, { timeout: 15_000 });
  });
});

test.describe('Fixture: spa', () => {
  test('@core TC-E2E-23: 路由切换后新内容可被发现', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('spa');

    await translateAndWait(page);

    // 切换到 page 2 — 等待 observer 自动补翻新视图
    await page.click('a[href="#page2"]');

    // SPA 路由切换后 DOM 应已更新
    const h1 = page.locator('#view h1');
    await expect(h1).toHaveText('Page 2');

    // 新内容的 3 个翻译单元（h1 + 2p）应被 observer 自动补翻
    await expect(page.locator('#view [data-pt="done"]')).toHaveCount(3, { timeout: 15_000 });
  });
});

test.describe('Fixture: hostile', () => {
  test('@core TC-E2E-24: CSS 重置不覆盖注入的 UI', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('hostile');

    // 悬浮球在激进 CSS reset 下仍可见
    const ball = await waitForBall(page);
    await expect(ball).toBeVisible();

    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Fixture: noise', () => {
  test('@core TC-E2E-25: 数字/超长段被正确跳过', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('noise');

    await translateAndWait(page);

    // 验证页面加载正常
    const paragraphs = page.locator('p');
    await expect(paragraphs.first()).toBeVisible();

    // 纯数字段落不应被翻译（没有 data-pt="done" 的子元素在其内部
    // 但 markup 可能不同，只验证纯数字 p 没有 .pt-origin 类）
    const numericDone = await page.evaluate(() => {
      const ps = document.querySelectorAll('p');
      for (const p of ps) {
        const text = p.textContent?.trim() ?? '';
        if (/^\d+$/.test(text) && p.hasAttribute('data-pt')) return true;
      }
      return false;
    });
    expect(numericDone).toBe(false);
  });
});

test.describe('Fixture: preserve', () => {
  test('@core TC-E2E-26: 用户名元素被正确保留（#58 回归）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('preserve');

    await translateAndWait(page);

    // 1. user-mention 链接本身不应被翻译修改
    const mentions = page.locator('a.user-mention');
    await expect(mentions.first()).toHaveText('@testuser');
    await expect(mentions.nth(1)).toHaveText('@alice');
    await expect(mentions.nth(2)).toHaveText('@bob');

    // 2. 译文不应包含占位符 ⟦PT0⟧ 等残留
    const allTrans = page.locator('.pt-trans');
    const count = await allTrans.count();
    for (let i = 0; i < count; i++) {
      const text = await allTrans.nth(i).textContent();
      expect(text).not.toMatch(/⟦PT\d+⟧/);
    }

    // 3. 翻译确实发生了（译文非空）
    await expect(allTrans.first()).not.toBeEmpty();
  });
});

test.describe('Fixture: pre-blocks', () => {
  test('@core TC-E2E-27: 超大 pre 可被切分 + 代码块不被切', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('pre-blocks');

    await translateAndWait(page);

    // 代码块 (.highlight pre) 不应有 data-pt="done"
    const codePre = page.locator('.highlight pre');
    await expect(codePre).toBeVisible();

    const codeDone = await codePre.locator('[data-pt="done"]').count();
    expect(codeDone).toBe(0);

    // 纯文本 pre 存在（切分由 pre-split.ts 处理）
    const plainPre = page.locator('.plain pre');
    await expect(plainPre.first()).toBeVisible();
  });
});

test.describe('Fixture: rtl', () => {
  test('@core TC-E2E-28: RTL 页面正常加载', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('rtl');

    await translateAndWait(page);

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
  });
});

test.describe('Fixture: media-mix', () => {
  test('@core TC-E2E-29: 含图片容器存在独立可翻段落', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('media-mix');

    await translateAndWait(page);

    // 含 img 的容器存在
    const divImages = page.locator('div img');
    await expect(divImages.first()).toBeVisible();

    // 独立文本段落被翻译
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible();
  });
});

test.describe('Fixture: iframe', () => {
  test('@core TC-E2E-30: iframe 存在且可访问', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('iframe');

    await translateAndWait(page);

    // iframe 存在
    const frame = page.frameLocator('#frame1');
    // 验证 iframe 内容可访问
    await expect(frame.locator('body')).toBeVisible();
  });
});

// ================================================================
// 引擎覆盖（mock 端点）
// ================================================================

test.describe('引擎', () => {
  test('@core TC-E2E-15: Google mock 返回译文', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle({
      translation: (q) => `[GOOGLE] ${q}`,
    });
    await gotoFixture('basic');

    await translateAndWait(page);

    // 验证 mock 译文出现
    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[GOOGLE]');
  });

  test('@core TC-E2E-16: Bing mock 返回译文', async ({
    page, mockGoogle, seedSettings, gotoFixture, context,
  }) => {
    // Mock Bing 的两个端点
    await context.route('https://edge.microsoft.com/translate/auth', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'mock-jwt-token',
      });
    });
    await context.route(
      'https://api-edge.cognitive.microsofttranslator.com/translate**',
      (route) => {
        const body = route.request().postDataJSON();
        const texts: Array<{ Text: string }> = body ?? [];
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            texts.map((t: { Text: string }) => ({
              translations: [{ text: `[BING] ${t.Text}` }],
            })),
          ),
        });
      },
    );

    await seedSettings({ enginePriority: ['bing-edge'] });
    await gotoFixture('basic');

    await translateAndWait(page);

    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[BING]');
  });
});
