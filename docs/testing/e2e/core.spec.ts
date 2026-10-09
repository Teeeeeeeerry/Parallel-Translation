/**
 * E2E 核心套件 —— 每次 push 必跑
 *
 * 覆盖：入口（悬浮球/快捷键/段落按钮）× 模式（对照/仅译文）×
 *       DOM 特征 fixture（shadow/nested/spa/preserve/pre-blocks 等）
 *
 * 翻译端点由 mockGoogle 拦截，完全确定性，不依赖外网。
 */
import fs from 'fs';
import { test, expect, waitForBall, type MockRequests } from './fixtures';
import type { UserSiteRules } from '~/src/storage/specialization';

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

  test('@core TC-E2E-53: 在飞期间重复触发 —— 只发一次请求、不立即还原（#156 回归）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 慢引擎制造在飞窗口。走快捷键路径而非点击悬浮球：悬浮球自身有
    // loading 守卫，而 popup/快捷键路径没有 —— 修复前第二次触发并发
    // 整页请求（请求翻倍），或首轮刚完成时触发还原（刚翻好的页面被
    // 立即还原）。快捷键与 popup 都直接调 togglePage，互斥守卫相同。
    await mockGoogle({ delayMs: 800 });
    await gotoFixture('basic');
    await waitForBall(page);

    const served = () =>
      serviceWorker.evaluate(() => (self as any).getE2EMockStats().totalServed);
    const toggleKey = process.platform === 'darwin' ? 'Meta+Shift+Y' : 'Control+Shift+Y';

    // 基线：单次触发的请求数
    await page.keyboard.press(toggleKey);
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });
    const baseline = await served();

    // 还原，回到未翻译态
    await page.keyboard.press(toggleKey);
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });

    // 在飞窗口内连按两次（两次按键间隔远小于 800ms 延迟）
    const before = await served();
    await page.keyboard.press(toggleKey);
    await page.keyboard.press(toggleKey);

    // 最终页面处于已翻译态（第二次触发未被还原）
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // 第二次触发未产生整页翻译的请求量（未并发翻倍）。用上界而非精确
    // 增量：SW 实例可能被 Chrome 替换（totalServed 清零、mock 自愈，
    // #90）—— 修复前并发第二次翻译会让增量达到 2×baseline。
    const after = await served();
    expect(after - before).toBeLessThanOrEqual(baseline);
  });
});

test.describe('入口：快捷键', () => {
  test('@core TC-E2E-03: Mod+Shift+Y → 翻译 (Linux/Windows)', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // Mod 在 macOS 上是 Meta（⌘），Control 变体在 mac 上不触发 ——
    // mac 平台由 TC-E2E-03-Mac 覆盖
    test.skip(process.platform === 'darwin', 'macOS 用 Meta 键（见 TC-E2E-03-Mac）');
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
    // fromEvent 在 Linux 上忽略 metaKey，Meta 变体在 Linux 不触发 ——
    // Linux/Windows 平台由 TC-E2E-03 覆盖
    test.skip(process.platform === 'linux', 'Linux 无 Meta 语义（见 TC-E2E-03）');
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
    test.skip(process.platform === 'darwin', 'macOS 上 Mod=Meta，Control 变体不触发');
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
  test('@core TC-E2E-05: 逐段翻译 → 按钮浮出 → 点击翻译', async ({
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

  test('@core TC-E2E-55: 离开段落再回到同一段落 —— 按钮保持显示（#165 回归）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('basic');

    await waitForBall(page);

    const firstP = page.locator('p').first();
    const paraBtn = page.locator('.pt-para-btn');

    // 悬停段落 → 按钮浮出
    await firstP.hover();
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });

    // 移到远离段落的空白处 → 触发 scheduleHide（1.5s 隐藏窗口）
    await page.mouse.move(5, 710);

    // 在隐藏窗口内移回同一段落
    await page.waitForTimeout(200);
    await firstP.hover();
    await expect(paraBtn).toBeVisible({ timeout: 2_000 });

    // 修复前：隐藏定时器继续倒数 → 按钮在鼠标停留期间自行消失
    await page.waitForTimeout(1_800); // 超过 HIDE_DELAY(1.5s)
    await expect(paraBtn).toBeVisible({ timeout: 1_000 });
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

  test('@core TC-E2E-54: shadow 内译文受仅译文模式控制 —— 原文被隐藏（#163 回归）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('shadow');

    await translateAndWait(page);

    // 切到仅译文模式（快捷键）
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M',
    );
    await expect(page.locator('html')).toHaveClass(/pt-only-trans-page/, { timeout: 5_000 });

    // 对照组：文档侧 .pt-origin 被隐藏
    const docOriginDisplay = await page.evaluate(() => {
      const origin = document.querySelector('[data-pt="done"] .pt-origin') as HTMLElement | null;
      return origin ? getComputedStyle(origin).display : null;
    });
    expect(docOriginDisplay).toBe('none');

    // #163 主体：shadow 内 .pt-origin 也被隐藏（样式注入生效）
    const shadowOriginDisplay = await page.evaluate(() => {
      const host = document.getElementById('host1');
      const origin = host?.shadowRoot?.querySelector(
        '[data-pt="done"] .pt-origin',
      ) as HTMLElement | null;
      return origin ? getComputedStyle(origin).display : null;
    });
    expect(shadowOriginDisplay).toBe('none');
  });
});

test.describe('Fixture: shadow-collapse', () => {
  test('@core TC-E2E-59: shadow 内折叠内容展开后自动补翻（#318 回归）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('shadow-collapse');

    await translateAndWait(page);

    // 整页翻译后：折叠区内内容仍隐藏，尚未翻译
    const before = await page.evaluate(() => {
      const host = document.getElementById('host');
      return host?.shadowRoot?.getElementById('hidden-content')?.getAttribute('data-pt') ?? null;
    });
    expect(before).toBeNull();

    // 展开折叠区（移除 display:none —— 纯属性级操作，不产生 childList
    // 记录，只能靠 IntersectionObserver 的隐藏单元注册链路触发补翻）
    await page.evaluate(() => {
      const host = document.getElementById('host');
      const wrap = host?.shadowRoot?.getElementById('collapsible') as HTMLElement;
      wrap.style.display = 'block';
    });

    // 自动补翻：shadow 内折叠内容出现译文标记
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const host = document.getElementById('host');
            return host?.shadowRoot?.getElementById('hidden-content')?.getAttribute('data-pt') ?? null;
          }),
        { timeout: 15_000 },
      )
      .toBe('done');
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

    // 验证没有重复文本（#23：混合内容元素只翻直接文本，块级子元素独立
    // 翻译 —— 父译文不得吞掉子段落内容；父子均为 done 是预期结构，
    // 判定重复的标准是译文内容而非 DOM 嵌套）
    const mixedDiv = page.locator('div').first();
    const divTrans = mixedDiv.locator(':scope > .pt-trans');
    await expect(divTrans).toContainText('Direct text in div');
    await expect(divTrans).not.toContainText('block-level child paragraph');
    // 子段落独立成翻译单元
    await expect(page.locator('p').first()).toHaveAttribute('data-pt', 'done');
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

  test('@core TC-E2E-46: mock 丢失后增量翻译自动恢复（#90 回归）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 在装 mock 前捕获真实 fetch —— 用于模拟 SW 实例被替换：
    // 实例内存里的 fetch stub 随实例消失。
    await serviceWorker.evaluate(() => {
      (self as any).__ptRealFetch = self.fetch.bind(self);
    });
    // 显式前缀：断言不依赖 mockGoogle 的默认值
    await mockGoogle({ prefix: '[MOCK] ' });
    await gotoFixture('infinite');

    await translateAndWait(page);
    const initialDone = await page.locator('[data-pt="done"]').count();

    // 模拟 stub 丢失（等效实例替换后的状态）。修复前后续翻译直连真实
    // Google（本地可侥幸通过但译文不带 mock 前缀；CI 无外网则必失败）。
    await serviceWorker.evaluate(() => {
      (self as any).fetch = (self as any).__ptRealFetch;
    });

    await page.click('#load-more');
    await expect(page.locator('[data-pt="done"]')).toHaveCount(initialDone + 3, { timeout: 15_000 });

    // 新段译文必须带 mock 前缀 —— 证明翻译路由前自动重装了 mock。
    // 注：本测试验证“路由前重装”这条 seam（同实例内 stub 丢失即恢复）；
    // 跨实例的 storage 持久由 chrome.storage 保证（真实重启无法在
    // headless 测试中可靠触发，见 #90 调查记录）。
    const newPara = page.locator('#content p').nth(3);
    await expect(newPara.locator('.pt-trans')).toContainText('[MOCK]');
  });
});

test.describe('Fixture: auto-mutate', () => {
  test('@core 无用户操作时不出现译文 —— 内容脚本启动时不得自动启动 observer', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('auto-mutate');

    // 页面自身在 500ms 后自动插入段落（模拟 SPA 变更），
    // 等待其落地 + observer 防抖窗口（300ms）+ 传输余量
    await page.waitForTimeout(2500);

    // 未点击任何翻译入口 —— 页面任何位置都不应出现译文标记
    expect(await page.locator('[data-pt="done"]').count()).toBe(0);
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

  test('@core TC-E2E-56: SPA 纯文本更新（textContent 原地改）→ 自动补翻（#179）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('spa');

    await translateAndWait(page);

    // React 式原地更新：复用同一 DOM 元素，只改原文文本节点数据 ——
    // 修复前 observer 只监 childList，新文本永不补翻
    await page.evaluate(() => {
      const view = document.getElementById('view')!;
      const h1 = view.querySelector('h1')!;
      // 已翻译单元的原文在 .pt-origin 内
      h1.querySelector('.pt-origin')!.firstChild!.nodeValue = 'In-place updated heading text';
    });

    // 单元被还原并重新翻译 —— .pt-trans 携带新文本的译文（mock 前缀 + 原文）
    await expect(page.locator('#view h1 .pt-trans')).toContainText(
      'In-place updated heading text',
      { timeout: 15_000 },
    );
  });

  test('@core TC-E2E-57: 延迟 attachShadow 的组件内容 → 自动补翻（#179）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('spa');

    await translateAndWait(page);
    const initialDone = await page.locator('[data-pt="done"]').count();

    // host 已入 DOM 后才建 shadow root（childList 捕不到 attachShadow）
    await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const p = document.createElement('p');
      p.textContent = 'Late shadow root paragraph content.';
      root.appendChild(p);
    });

    await expect(page.locator('[data-pt="done"]')).toHaveCount(initialDone + 1, { timeout: 15_000 });
  });

  test('@core TC-E2E-47: 增量翻译瞬时失败后自动重试（#91 回归）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ prefix: '[MOCK] ' });
    await gotoFixture('spa');

    await translateAndWait(page);

    // 武装一次性故障：下一次翻译请求必失败（等效 CI 中 SW 实例替换
    // 后的瞬时引擎故障）。修复前增量翻译是一次性的 —— 失败后
    // 新内容永久漏翻，与 #91 的“Retry #1/#2”失败签名一致。
    await mockGoogle({ failOnce: true, prefix: '[MOCK] ' });

    await page.click('a[href="#page2"]');

    // 故障已被触发且只触发一次（failOnceServed === 1 证明重试发生
    // 在失败之后；failOnce 失效时计数为 0，测试不再假绿）
    await expect(page.locator('#view [data-pt="done"]')).toHaveCount(3, { timeout: 20_000 });
    await expect(page.locator('#view h1 .pt-trans').first()).toContainText('[MOCK]');
    const stats = await serviceWorker.evaluate(() =>
      (self as any).getE2EMockStats(),
    );
    expect(stats.failOnceServed).toBe(1);
  });

  test('@core TC-E2E-48: 多批增量翻译部分失败自动重试（#91 审查跟进）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ prefix: '[MOCK] ' });
    await gotoFixture('basic');

    await translateAndWait(page);
    const initialDone = await page.locator('[data-pt="done"]').count();

    // 一次性注入 20 段 —— 跨 FULL_PAGE_BATCH_SIZE(15) 两个批次；
    // failOnce 只击落其中一个批次的请求，另一批正常。修复前失败
    // 批被 allFailed 掩码（整页 status 仍是 'translated'），漏翻永
    // 不重试；修复后批次级重试补齐。
    await mockGoogle({ failOnce: true, prefix: '[MOCK] ' });
    await page.evaluate(() => {
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= 20; i++) {
        const p = document.createElement('p');
        p.textContent = `Paragraph ${i} added after initial translation.`;
        frag.appendChild(p);
      }
      document.body.appendChild(frag);
    });

    await expect(page.locator('[data-pt="done"]')).toHaveCount(initialDone + 20, { timeout: 30_000 });
    const stats = await serviceWorker.evaluate(() =>
      (self as any).getE2EMockStats(),
    );
    expect(stats.failOnceServed).toBe(1);
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

    // 纯文本 pre 超长 → 被 splitPre 按空行切块，切出的块独立翻译
    const plainPre = page.locator('pre.plain');
    await expect(plainPre).toHaveAttribute('data-pt-split', '1');
    const chunks = plainPre.locator(':scope > [data-pt-chunk="1"]');
    await expect(chunks.first()).toBeVisible();
    // 至少 2 个块，且块已被翻译（data-pt="done" 落在 .pt-chunk 自身）
    expect(await chunks.count()).toBeGreaterThanOrEqual(2);
    await expect(chunks.first()).toHaveAttribute('data-pt', 'done');
  });

  test('@core TC-E2E-49: pre 内译文行内贴合原文，与装饰行视觉分行', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('pre-blocks');

    await translateAndWait(page);

    // 翻译并发乱序，不能取“第一个 trans”——定位标题 chunk（原文含
    // README Title）的译文，它与装饰行的位置关系才是本用例的断言对象。
    const titleChunk = page
      .locator('pre.plain > .pt-chunk')
      .filter({ hasText: 'README Title' });
    const titleTrans = titleChunk.locator('.pt-trans.pt-pre');
    await expect(titleTrans).toBeVisible();

    // ── 机制：译文必须行内显示（display:inline），否则块级换行 +
    // 原文行尾 \n 会在原文与译文之间制造空行、把装饰行挤离标题。
    // ::after 补行尾硬换行，隔开后续装饰行。
    const styles = await titleTrans.evaluate((el) => {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      return {
        display: cs.display,
        whiteSpace: cs.whiteSpace,
        afterContent: after.content,
        afterWhiteSpace: after.whiteSpace,
      };
    });
    expect(styles.display).toBe('inline');
    // pre-line：保留引擎译文中的硬换行 —— normal 会把列表译文的
    // 换行折叠成一行长文本
    expect(styles.whiteSpace).toBe('pre-line');
    expect(styles.afterContent).toContain('\\a ');
    expect(styles.afterWhiteSpace).toBe('pre');

    // ── 行为：标题译文行与装饰行“============”必须视觉分行
    // （::after 失效时会粘成同一行“【译】README Title============”）。
    // 装饰行是 chunk 之外的 raw 文本节点，用 Range 定位取 y 坐标。
    const rects = await page.evaluate(() => {
      const pre = document.querySelector('pre.plain')!;
      // 标题 chunk 的译文（与 Playwright 侧 titleTrans 同一元素）
      const titleChunk = [...pre.querySelectorAll('.pt-chunk')].find((c) =>
        (c.textContent ?? '').includes('README Title'),
      );
      const trans = titleChunk?.querySelector('.pt-trans.pt-pre') ?? null;
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      // currentNode 初始是 root（pre 自身，textContent 含装饰行会误命中），
      // 必须先 nextNode() 进入遍历
      let node: Node | null = walker.nextNode();
      let decoTop: number | null = null;
      while (node) {
        if ((node.textContent ?? '').includes('============')) {
          // Range.selectNodeContents() 返回 undefined，不能链式调用
          const range = document.createRange();
          range.selectNodeContents(node);
          decoTop = range.getBoundingClientRect().top;
          break;
        }
        node = walker.nextNode();
      }
      const transRect = trans?.getBoundingClientRect();
      return {
        transFound: trans !== null,
        decoTop,
        transTop: transRect?.top ?? null,
        transBottom: transRect?.bottom ?? null,
      };
    });
    expect(rects.transFound).toBe(true);
    expect(rects.decoTop).not.toBeNull();
    expect(rects.transTop).not.toBeNull();
    // 装饰行在译文行下方（y 更大），且不与译文行重叠
    expect(rects.decoTop!).toBeGreaterThanOrEqual(rects.transBottom!);

    // ── 列表行级对照：每条目独立成翻译单元，渲染后
    //    一行原文紧贴一行译文交替（原文 i → 译文 i → 原文 i+1 …）。
    //    回归背景：列表曾作为一个 chunk 整块翻译（块级对照），
    //    也曾因输入归一化折叠成一行长文本。
    const listLayout = await page.evaluate(() => {
      const pre = document.querySelector('pre.plain')!;
      const chunks = [...pre.querySelectorAll('.pt-chunk')];
      // 列表条目 chunk：origin 文本以 '* ' 开头
      const listChunks = chunks.filter((c) =>
        (c.querySelector('.pt-origin')?.textContent ?? '').trimStart().startsWith('* '),
      );
      return listChunks.map((c) => {
        const o = c.querySelector('.pt-origin')!.getBoundingClientRect();
        const t = c.querySelector('.pt-trans')!.getBoundingClientRect();
        return { oTop: o.top, oBottom: o.bottom, tTop: t.top, tBottom: t.bottom };
      });
    });

    // fixture 里 5 个列表条目 → 5 个独立单元
    expect(listLayout.length).toBe(5);
    listLayout.forEach((r, i) => {
      // 译文行紧跟自己的原文行（y 相邻，无空行）
      expect(r.tTop).toBeGreaterThanOrEqual(r.oBottom - 1);
      if (i > 0) {
        // 交错：条目 i 的原文在条目 i-1 的译文之后
        expect(r.oTop).toBeGreaterThanOrEqual(listLayout[i - 1]!.tBottom);
      }
    });
  });

  test('@core TC-E2E-50: 分步 append + 慢引擎 —— 每单元只发一次请求（#158 回归）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 慢引擎（800ms > 300ms 防抖窗口）：二次 flush 发生时首轮翻译仍在飞，
    // 修复前同一单元被再次请求（分步 append 祖先+后代 / pre 切块两条路径）
    await mockGoogle({ prefix: '[MOCK] ', delayMs: 800 });
    await gotoFixture('basic');

    await translateAndWait(page);
    const initialDone = await page.locator('[data-pt="done"]').count();
    const served = () =>
      serviceWorker.evaluate(() => (self as any).getE2EMockStats().totalServed);

    // 阶段 1：分步 append 容器 + 20 段（同一防抖窗口）。修复前 collect(容器)
    // 与 collect(每段) 各收集一遍 → 40 单元 → 40 请求；修复后只收容器
    // 覆盖的子树 → 20 单元 → 20 请求（google-web 每文本一个请求）
    const before1 = await served();
    await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      for (let i = 1; i <= 20; i++) {
        const p = document.createElement('p');
        p.textContent = `Stepwise paragraph ${i} added after initial translation.`;
        container.appendChild(p);
      }
    });
    await expect(page.locator('[data-pt="done"]')).toHaveCount(initialDone + 20, { timeout: 30_000 });
    expect(await served()).toBe(before1 + 20);

    // 阶段 2：分步 append 容器 + 超大纯文本 pre（24 个空行分隔的段落块）。
    // flush#1 的 collect 同步 splitPre 切出 24 块并收集；切块插入产生的
    // mutation 若再进 pending，flush#2 会把这些在飞块重复请求 —— 修复后
    // 忽略 .pt-chunk 自身插入 → 24 单元 → 24 请求
    const before2 = await served();
    await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const pre = document.createElement('pre');
      const para = (i: number) =>
        Array.from(
          { length: 5 },
          (_, j) =>
            `Pre line ${i * 5 + j} of stepwise appended long plain text document paragraph.`,
        ).join('\n');
      pre.textContent = Array.from({ length: 24 }, (_, i) => para(i)).join('\n\n');
      container.appendChild(pre);
    });
    const chunks = page.locator('[data-pt-chunk="1"]');
    await expect(chunks).toHaveCount(24, { timeout: 30_000 });
    await expect(chunks.first()).toHaveAttribute('data-pt', 'done');
    expect(await served()).toBe(before2 + 24);
  });
});

// ================================================================
// #157：还原 vs 在飞翻译竞态
// ================================================================

test.describe('还原 vs 在飞翻译（#157）', () => {
  // 等在飞/排队请求全部结算（并发闸门 6 路 × 800ms，30 条最多约 5s 排空）。
  // 还原只能中止未发出的请求 —— 已入队请求仍会走完，须等其结算再断言。
  const waitDrained = (page: import('@playwright/test').Page, served: () => Promise<number>) =>
    expect
      .poll(async () => {
        const s1 = await served();
        await page.waitForTimeout(1200);
        return (await served()) === s1;
      }, { timeout: 20_000 })
      .toBe(true);

  test('@core TC-E2E-51: 部分批次已渲染时还原 —— 球回 idle、无错误 toast、无自动补翻', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 800ms 慢引擎制造在飞窗口：首批渲染后、次批仍在飞时还原
    await mockGoogle({ delayMs: 800 });
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    const served = () =>
      serviceWorker.evaluate(() => (self as any).getE2EMockStats().totalServed);
    const errorToast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');

    // 追加 20 段 → 30 单元 → 2 批（15/批），批间天然错峰
    await page.evaluate(() => {
      for (let i = 1; i <= 20; i++) {
        const p = document.createElement('p');
        p.textContent = `In-flight paragraph ${i} for restore race.`;
        document.body.appendChild(p);
      }
    });

    await ball.click();
    await expect(ball).toHaveAttribute('data-state', 'loading');

    // 等首批渲染（hasTranslated=true），次批仍在飞
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 10_000 });

    // 快捷键还原（悬浮球 loading 屏蔽点击，快捷键不设防 —— #157 场景）
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Y' : 'Control+Shift+Y',
    );

    // 球回 idle 而非 done/error；页面全部还原
    await expect(ball).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });

    // 等所有在飞批次结算，确认无“所有引擎均失败”错误 toast
    await waitDrained(page, served);
    await expect(errorToast).toHaveCount(0);

    // 还原后不启动 observer：新增段落不被自动补翻（无新请求、无译文）
    const before = await served();
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'Appended after restore — must not auto-translate.';
      document.body.appendChild(p);
    });
    await page.waitForTimeout(2500);
    expect(await served()).toBe(before);
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
  });

  test('@core TC-E2E-52: 增量补翻在飞时还原（全批中止）—— 不误报引擎失败', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    const errorToast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    const served = () =>
      serviceWorker.evaluate(() => (self as any).getE2EMockStats().totalServed);

    // 完整翻译 → observer 已启动
    await translateAndWait(page);
    await expect(ball).toHaveAttribute('data-state', 'done');

    // 换成慢引擎，追加 20 段 → 增量补翻在飞（约 300ms 防抖 + 800ms 响应）
    await mockGoogle({ delayMs: 800 });
    const baseline = await served();
    await page.evaluate(() => {
      for (let i = 1; i <= 20; i++) {
        const p = document.createElement('p');
        p.textContent = `Incremental paragraph ${i} for restore race.`;
        document.body.appendChild(p);
      }
    });
    // 等增量请求真正发出（在飞窗口），再触发还原
    await expect
      .poll(async () => await served(), { timeout: 10_000 })
      .toBeGreaterThan(baseline);

    // 增量批次在飞时还原（球 done 可点击）
    await ball.click();
    await expect(ball).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });

    // 等在飞/排队批次结算（#157 前：全批中止 → 结算瞬间弹「所有引擎均失败」
    // 并停留 3s —— toHaveCount(0) 会等 toast 自动过期而漏检，须持续采样）
    await waitDrained(page, served);
    let sawErrorToast = false;
    const toastEnd = Date.now() + 3500;
    while (Date.now() < toastEnd) {
      if ((await errorToast.count()) > 0) {
        sawErrorToast = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    expect(sawErrorToast).toBe(false);

    // observer 已停：追加内容不再触发新请求
    const settled = await served();
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'Appended after restore — must not auto-translate.';
      document.body.appendChild(p);
    });
    await page.waitForTimeout(2500);
    expect(await served()).toBe(settled);
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
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

    // 1. 行内 favicon 不阻断翻译（#55：位置性判定 —— 行内装饰不阻断）
    const faviconP = page.locator('p:has(img[width="16"])');
    await expect(faviconP).toHaveAttribute('data-pt', 'done');

    // 2. 大图容器整体不翻译，内嵌 caption p 独立翻译
    const imageDiv = page.locator('div:has(> img[width="800"])');
    await expect(imageDiv.locator('img').first()).toBeVisible();
    await expect(imageDiv).not.toHaveAttribute('data-pt', 'done');
    await expect(imageDiv.locator('p')).toHaveAttribute('data-pt', 'done');

    // 3. 含 button 的 section 被降级，内嵌两段 p 各自翻译
    const buttonSection = page.locator('section:has(button)');
    await expect(buttonSection).not.toHaveAttribute('data-pt', 'done');
    const sectionPs = buttonSection.locator('p');
    await expect(sectionPs).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(sectionPs.nth(i)).toHaveAttribute('data-pt', 'done');
    }

    // 4. 媒体/交互控件不被藏进译文单元：done 单元不含 button，
    //    大图不在任何 done 单元内（行内 favicon 由 #55 允许，见断言 1）
    const mediaLeak = await page.evaluate(() => {
      const done = [...document.querySelectorAll('[data-pt="done"]')];
      return {
        hasButton: done.some((el) => el.querySelector('button')),
        bigImgInDone: done.some((el) => el.querySelector('img[width="800"]')),
      };
    });
    expect(mediaLeak).toEqual({ hasButton: false, bigImgInDone: false });
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

  test('@core TC-E2E-58: popup 广播到多 frame —— 响应必是主 frame 的结果（#180 验证）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('iframe');
    // #439：先等主 frame 的 content script 就绪再发消息。悬浮球与消息监听在
    // 初始化完成后的同一段同步代码里注册，悬浮球出现即说明监听已在。
    // CI 机器慢时不等就发，sendMessage 会因没有监听者被拒绝。
    await waitForBall(page);

    // 与 popup 同路径：SW 端 tabs.sendMessage 不带 frameId 广播到全部 frame。
    // 若子 frame 的 undefined 返回抢先决议，status 会是 undefined。
    // 遍历标签页：无 content script 的标签页 sendMessage 会拒绝，跳过。
    const resp = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id == null) continue;
        try {
          const r = (await chrome.tabs.sendMessage(tab.id, {
            type: 'pt:toggle-translate',
          })) as { ok?: boolean; status?: string };
          if (r && typeof r === 'object') {
            return { ok: r.ok ?? false, status: r.status };
          }
        } catch {
          // 无 content script 的标签页
        }
      }
      return { error: '所有标签页均无 content script 响应' };
    });

    expect(resp.error).toBeUndefined();
    // 主 frame 的响应（ok:true + 翻译态），而非子 frame 的 undefined
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe('translated');
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });
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
    await mockGoogle({ prefix: '[GOOGLE] ' });
    await gotoFixture('basic');

    await translateAndWait(page);

    // 验证 mock 译文出现
    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[GOOGLE]');
  });

  test('@core TC-E2E-16: Bing mock 返回译文；SW 实例被替换后替身自愈、请求记录以“不可信”报错（#766）', async ({
    page, serviceWorker, mockBing, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['bing-edge'] });
    // 在装替身前捕获真实 fetch，用于模拟 SW 实例被替换（同 TC-E2E-46）
    await serviceWorker.evaluate(() => {
      (self as any).__ptRealFetch = self.fetch.bind(self);
    });
    // #766：Bing 的鉴权与翻译两个端点走 e2e-mock 描述符，不再由用例改写 self.fetch
    await mockBing({ prefix: '[BING] ' });
    await gotoFixture('basic');
    const requests = await mockRequests();

    await translateAndWait(page);

    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[BING]');
    expect((await requests()).bing).toBeGreaterThan(0);

    // 模拟 SW 实例被替换：SW 上被改写的 fetch 回到真实 fetch，实例内存里的
    // 存活标记一并消失。改动前用例自己改写的替身到这里就没了，下一次翻译
    // 直连真实 Bing（本地拿回不带前缀的真实译文，CI 无外网则直接失败）
    await serviceWorker.evaluate(() => {
      (self as any).fetch = (self as any).__ptRealFetch;
      delete (self as any).__ptLiveTokens;
    });
    // 替身层的记录随实例清零，读取以“不可信”报错，而不是给出清零后的数
    await expect(requests()).rejects.toThrow('不可信');

    // 还原后再整页翻译一次：路由前从描述符自愈，译文仍来自替身
    const ball = page.locator('#pt-host-ball .pt-ball');
    await ball.click();
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(trans).toContainText('[BING]');
  });
});

// ================================================================
// 设置页：导出（#494）
// ================================================================

test.describe('设置页：导出', () => {
  test('@core TC-E2E-83: 高级分区导出设置 → 下载 JSON 文件，内容为当前设置且不含 API key（#494）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="advanced"]');
    await page.selectOption('#pt-select-concurrency', '4');
    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => {
          const all = await chrome.storage.sync.get(null);
          return JSON.stringify(all).includes('"maxConcurrency":4');
        }),
      )
      .toBe(true);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#pt-export-settings-btn'),
    ]);
    expect(download.suggestedFilename()).toBe('parallel-translation-settings.json');
    const json = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'));
    expect(json.maxConcurrency).toBe(4);
    expect(json).not.toHaveProperty('apiKeys');
    await expect(page.locator('#pt-toast')).toBeVisible();
  });
});

test.describe('设置页：侧栏品牌头', () => {
  test('@core TC-E2E-102: 设置页侧栏顶部是与 popup 头部同源的标识、单行名称与副标题（#605）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    const popup = await page.context().newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const popupLogo = await popup.locator('.pt-hdr .pt-logo').innerHTML();
    expect(popupLogo).toContain('<svg');
    await popup.close();

    await page.goto(`chrome-extension://${extId}/options.html`);
    const hdr = page.locator('.pt-nav .pt-nav-hdr');
    const logo = hdr.locator('.pt-logo');
    // 标识与 popup 同源同尺寸：SVG 标记逐字相同，标为装饰
    expect(await logo.innerHTML()).toBe(popupLogo);
    await expect(logo.locator('svg')).toHaveAttribute('aria-hidden', 'true');

    const name = hdr.locator('.pt-hdr-name');
    await expect(name).toHaveText('Parallel-Translation');
    // 名称只占一行，也没有被截断
    const box = await name.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      clipped: el.scrollWidth > el.clientWidth,
    }));
    expect(box.height).toBeLessThan(box.fontSize * 2);
    expect(box.clipped).toBe(false);
    await expect(hdr.locator('.pt-hdr-sub')).toHaveText('Bilingual Reader');

    // 导航按钮照常切换分区
    await page.click('.pt-nav-btn[data-section="engines"]');
    await expect(page.locator('#pt-section-engines')).toBeVisible();
    // 主内容区在常见窗口宽度下没有横向滚动
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

test.describe('设置页：布局', () => {
  test('@core TC-E2E-106: 设置页侧栏是离开窗口边缘、固定在视口内的圆角卡片，内容区加宽，小窗口不横向滚动（#607）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`chrome-extension://${extId}/options.html`);
    const nav = page.locator('.pt-nav');
    await expect(nav.locator('.pt-nav-btn.pt-active')).toBeVisible();

    const navBox = () =>
      nav.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
        };
      });
    // 圆角卡片，离视口左边和上边都留有空隙
    const box = await navBox();
    expect(box.radius).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThan(0);

    // 内容区明显宽于原来的 720px
    const mainWidth = await page.locator('.pt-main').evaluate((el) => el.getBoundingClientRect().width);
    expect(mainWidth).toBeGreaterThanOrEqual(900);

    // 选中的一级菜单项仍有左侧竖线，且竖线在侧栏卡片之内
    await page.click('.pt-nav-btn[data-section="domains"]');
    const active = page.locator('.pt-nav-btn.pt-active');
    await expect(active).toHaveAttribute('data-section', 'domains');
    const bar = await active.evaluate((el) => ({
      width: parseFloat(getComputedStyle(el).borderLeftWidth),
      left: el.getBoundingClientRect().left,
    }));
    expect(bar.width).toBeGreaterThan(0);
    expect(bar.left).toBeGreaterThanOrEqual(box.left);
    expect(bar.left + bar.width).toBeLessThanOrEqual(box.right);

    // 长分区滚到底部，侧栏仍在视口内
    await page.locator('.pt-main').evaluate((el) => {
      // 保证页面足够长，滚动判据才有意义
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      el.querySelector('.pt-section.pt-active')!.appendChild(filler);
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const scrolled = await navBox();
    expect(scrolled.top).toBeGreaterThanOrEqual(0);
    expect(scrolled.bottom).toBeLessThanOrEqual(900);

    // 小窗口：文档宽度不超过视口，没有横向滚动
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const section of ['general', 'domains', 'site-rules', 'engines']) {
      await page.click(`.pt-nav-btn[data-section="${section}"]`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
});

// ================================================================
// 站点页面规则（#365）
// ================================================================

test.describe('站点页面规则', () => {
  /** 设置页：新增 localhost 站点卡片，按字段填入选择器并保存 */
  async function saveLocalhostRules(
    page: import('@playwright/test').Page,
    serviceWorker: import('@playwright/test').Worker,
    fields: Record<string, string>,
  ): Promise<void> {
    const extId = new URL(serviceWorker.url()).host;
    const options = await page.context().newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.click('.pt-nav-btn[data-section="site-rules"]');
    await options.fill('#pt-site-rules-site-input', 'localhost');
    await options.click('#pt-site-rules-add-btn');
    const card = options.locator('.pt-site-rules-card', { hasText: 'localhost' });
    for (const [field, value] of Object.entries(fields)) {
      await card.locator(`textarea[data-field="${field}"]`).fill(value);
    }
    await card.locator('.pt-site-rules-save').click();
    await expect(options.locator('#pt-toast')).toBeVisible();
    await options.close();
  }

  /** 经后台直接写入站点规则的用户规则列表：打开设置页前用来准备数据，打开后相当于另一个设置页标签页保存了改动 */
  const writeUserSiteRules = (serviceWorker: import('@playwright/test').Worker, user: unknown[]) =>
    serviceWorker.evaluate((u) => chrome.storage.local.set({ 'pt-site-rules': { user: u } }), user);

  /**
   * 经后台读取站点规则存储里的用户规则列表，用来断言写入结果。返回类型按
   * 存储模块的类型断言，不做运行时校验：读到旧结构的数据时类型检查不会报错
   */
  const readUserSiteRules = (serviceWorker: import('@playwright/test').Worker): Promise<UserSiteRules[]> =>
    serviceWorker.evaluate(
      async () => ((await chrome.storage.local.get('pt-site-rules'))['pt-site-rules'] as any).user,
    );

  /** 站点规则导入文件 */
  const siteRulesFile = (sites: Record<string, unknown>) => ({
    name: 'parallel-translation-site-rules.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'parallel-translation-site-rules', version: 1, sites })),
  });

  /** 设置页里每次写入存储之后，读取都失败，直到 __ptFailGet 被清掉 */
  const failGetAfterWrite = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const local = chrome.storage.local as any;
      const w = window as any;
      const { get, set } = local;
      w.__ptSet = set;
      local.get = (...a: unknown[]) =>
        w.__ptFailGet ? Promise.reject(new Error('boom')) : get.apply(local, a);
      local.set = async (...a: unknown[]) => {
        await set.apply(local, a);
        w.__ptFailGet = true;
      };
    });
  /** 页面里打桩：__ptFailRender 为 true 时，构造卡片的文本框抛错（#558）。打桩后标记即为 true */
  const failCardRender = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const create = document.createElement.bind(document);
      (document as any).createElement = (tag: string, options?: ElementCreationOptions) => {
        if ((window as any).__ptFailRender && tag === 'textarea') throw new Error('[PT] 渲染出错');
        return create(tag, options);
      };
      (window as any).__ptFailRender = true;
    });

  /**
   * 列表没刷新的提示文案：done 是已完成操作的提示文案，返回与存储读取失败的
   * 原因（domainStorageReadFailed，随界面语言）合成后的整句提示
   */
  const listStale = (page: import('@playwright/test').Page, done: string) =>
    page.evaluate(
      (d) => chrome.i18n.getMessage('siteRulesListStale', [d, chrome.i18n.getMessage('domainStorageReadFailed')]),
      done,
    );

  test('@core TC-E2E-60: 设置页新增排除 → 刷新 → 元素不翻译（#370）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);

    await saveLocalhostRules(page, serviceWorker, { exclude: 'ul' });

    // 刷新该站点
    await page.reload({ waitUntil: 'domcontentloaded' });
    const ball = await waitForBall(page);

    // 逐段翻译：排除区内不出按钮，排除区外照常浮出
    await page.locator('li').first().hover();
    await page.waitForTimeout(1_000);
    await expect(page.locator('.pt-para-btn')).toBeHidden();
    await page.locator('p').first().hover();
    await expect(page.locator('.pt-para-btn')).toBeVisible({ timeout: 5_000 });

    // 全页翻译：段落照常翻译，列表项不翻译
    await ball.click();
    await expect(page.locator('p').last()).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    await expect(page.locator('li[data-pt]')).toHaveCount(0);
    await expect(page.locator('li').first()).not.toContainText('【译】');
  });

  test('@core TC-E2E-61: 设置页填写限定范围 → 刷新 → 只翻译范围内（#374）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);

    await saveLocalhostRules(page, serviceWorker, { scope: 'ul' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const ball = await waitForBall(page);

    // 逐段翻译：范围外不出按钮，范围内照常浮出
    await page.locator('p').first().hover();
    await page.waitForTimeout(1_000);
    await expect(page.locator('.pt-para-btn')).toBeHidden();
    await page.locator('li').first().hover();
    await expect(page.locator('.pt-para-btn')).toBeVisible({ timeout: 5_000 });

    // 全页翻译：列表项翻译，范围外的标题与段落不翻译
    await ball.click();
    await expect(page.locator('li').last()).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    await expect(page.locator('p[data-pt], h1[data-pt]')).toHaveCount(0);
    await expect(page.locator('p').first()).not.toContainText('【译】');
  });

  test('@core TC-E2E-62: 设置页填写保留原文 → 刷新 → 行内元素原文留在译文里（#373）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('preserve');
    await waitForBall(page);

    await saveLocalhostRules(page, serviceWorker, { preserve: 'a.user-mention' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const ball = await waitForBall(page);

    // 译文看不出占位符有没有起作用 —— 记下送去引擎的文本（#766：记在替身层）
    const requests = await mockRequests();

    await ball.click();
    const mention = page.locator('p', { hasText: '@alice' });
    await expect(mention).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });

    // 送去引擎的是占位符，用户名不在其中；回填后译文里是原文
    const sent = (await requests()).queries;
    expect(sent.join('\n')).toMatch(/⟦PT\d+⟧/);
    expect(sent.join('\n')).not.toContain('@alice');
    expect(sent.join('\n')).toContain('useful resource');
    await expect(mention.locator('.pt-trans')).toContainText('@alice');
  });

  test('@core TC-E2E-63: 设置页保存无效选择器 → 标红并提示行号 → 改正后保存（#372）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'localhost');
    await page.click('#pt-site-rules-add-btn');
    const card = page.locator('.pt-site-rules-card', { hasText: 'localhost' });
    const exclude = card.locator('textarea[data-field="exclude"]');
    const error = card.locator('textarea[data-field="exclude"] + .pt-site-rules-error');

    // 第 3 行无效（空行也计行号）：拒绝保存，标红并指出行号与选择器
    await exclude.fill('ul\n\n.promo,\n  p  ');
    await card.locator('.pt-site-rules-save').click();
    await expect(exclude).toHaveClass(/pt-error/);
    await expect(error).toBeVisible();
    await expect(error).toContainText('3');
    await expect(error).toContainText('.promo,');
    await expect(page.locator('#pt-toast')).toBeHidden();
    const stored = await serviceWorker.evaluate(() => chrome.storage.local.get('pt-site-rules'));
    expect(JSON.stringify(stored)).not.toContain('promo');

    // 修改后提示消失；改正后保存成功
    await exclude.fill('ul\n\n.promo\n  p  ');
    await expect(error).toBeHidden();
    await expect(exclude).not.toHaveClass(/pt-error/);
    await card.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();
  });

  test('@core TC-E2E-68: 存储里带无效行的站点卡片 → 打开设置页即标红并提示行号 → 改正后保存（#443）', async ({
    page, serviceWorker,
  }) => {
    // 导入等途径不经保存时校验，直接写入 storage.local
    await writeUserSiteRules(serviceWorker, [{ site: 'localhost', scope: ['main,', '.post'], exclude: ['.ad'] }]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const card = page.locator('.pt-site-rules-card', { hasText: 'localhost' });
    const scope = card.locator('textarea[data-field="scope"]');
    const error = card.locator('textarea[data-field="scope"] + .pt-site-rules-error');

    // 与保存时的提示相同：标红，指出行号与选择器；有效的字段不标
    await expect(scope).toHaveValue('main,\n.post');
    await expect(scope).toHaveClass(/pt-error/);
    await expect(error).toBeVisible();
    await expect(error).toContainText('1');
    await expect(error).toContainText('main,');
    await expect(card.locator('textarea[data-field="exclude"]')).not.toHaveClass(/pt-error/);
    await expect(card.locator('textarea[data-field="exclude"] + .pt-site-rules-error')).toBeHidden();

    // 修改后提示消失；改正后保存，重新打开也不再提示
    await scope.fill('main\n.post');
    await expect(error).toBeHidden();
    await card.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();
    await page.reload();
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await expect(scope).toHaveValue('main\n.post');
    await expect(scope).not.toHaveClass(/pt-error/);
    await expect(error).toBeHidden();
  });

  test('@core TC-E2E-65: 设置页删除站点卡片 → 先确认 → 用户规则移除，只剩内置规则（#371）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    await saveLocalhostRules(page, serviceWorker, { exclude: 'ul' });

    const extId = new URL(serviceWorker.url()).host;
    const options = await page.context().newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.click('.pt-nav-btn[data-section="site-rules"]');
    const card = options.locator('.pt-site-rules-card', { hasText: 'localhost' });
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-site-rules'))['pt-site-rules']);

    // 取消确认：卡片与规则都还在
    options.once('dialog', (d) => d.dismiss());
    await card.locator('.pt-site-rules-delete').click();
    await expect(card).toBeVisible();
    expect(JSON.stringify(await stored())).toContain('localhost');

    // 确认删除：卡片消失，storage.local 里不再有该站点
    let message = '';
    options.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await card.locator('.pt-site-rules-delete').click();
    await expect(card).toHaveCount(0);
    expect(message).toContain('localhost');
    expect(JSON.stringify(await stored())).not.toContain('localhost');
    await options.close();

    // 刷新该站点：之前排除的列表项重新可以翻译
    await page.reload({ waitUntil: 'domcontentloaded' });
    const ball = await waitForBall(page);
    await ball.click();
    await expect(page.locator('li').first()).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
  });

  test('@core TC-E2E-66: 有内置规则的站点卡片显示停用开关 → 打开后存入 storage.local → 重新打开仍保持（#375）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    for (const site of ['github.com', 'localhost']) {
      await page.fill('#pt-site-rules-site-input', site);
      await page.click('#pt-site-rules-add-btn');
    }
    const github = page.locator('.pt-site-rules-card', { hasText: 'github.com' });
    const local = page.locator('.pt-site-rules-card', { hasText: 'localhost' });
    const toggle = github.locator('.pt-site-rules-builtin-toggle');

    // 没有内置规则的站点不显示开关
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveClass(/pt-on/);
    await expect(local.locator('.pt-site-rules-builtin-toggle')).toHaveCount(0);

    // 打开开关即保存
    await toggle.click();
    await expect(page.locator('#pt-toast')).toBeVisible();
    await expect(toggle).toHaveClass(/pt-on/);
    const cards = () => readUserSiteRules(serviceWorker);
    expect(await cards()).toContainEqual({ site: 'github.com', disableBuiltin: true });

    // 重新打开设置页仍保持；关闭后存为 false，恢复追加合并
    await page.reload();
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await expect(toggle).toHaveClass(/pt-on/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/pt-on/);
    await expect.poll(cards).toContainEqual({ site: 'github.com', disableBuiltin: false });
  });

  test('@core TC-E2E-69: 设置页导出站点规则 → 下载 JSON 文件，只含用户规则（#376）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    const card = page.locator('.pt-site-rules-card', { hasText: 'github.com' });
    await card.locator('textarea[data-field="exclude"]').fill('.my-sidebar');
    await card.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#pt-site-rules-export-btn'),
    ]);
    expect(download.suggestedFilename()).toBe('parallel-translation-site-rules.json');
    const file = await download.path();
    const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(json).toEqual({
      format: 'parallel-translation-site-rules',
      version: 1,
      sites: {
        'github.com': { scope: [], exclude: ['.my-sidebar'], preserve: [], disableBuiltin: false },
      },
    });
  });

  test('@core TC-E2E-87: 保存站点卡片遇到存储空间不足 → 提示可以清空缓存后重试，规则不变（#523）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    const card = page.locator('.pt-site-rules-card', { hasText: 'github.com' });
    await card.locator('textarea[data-field="exclude"]').fill('.a');
    await card.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();

    // 设置页里的存储写入报 Chrome 的配额错误（同 TC-E2E-85）
    await page.evaluate(() => {
      (chrome.storage.local as any).set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    });
    await card.locator('textarea[data-field="exclude"]').fill('.b');
    await card.locator('.pt-site-rules-save').click();
    // 提示文案随浏览器界面语言（CI 是英文）：与领域分区同一句存储空间不足的原因
    const expected = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesSaveFailed', [chrome.i18n.getMessage('domainStorageFull')]),
    );
    await expect(page.locator('#pt-toast')).toHaveText(expected);
    const cards = await readUserSiteRules(serviceWorker);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.exclude).toEqual(['.a']);
  });

  test('@core TC-E2E-76: 设置页导入站点规则 JSON → 与已有卡片逐字段合并去重，新站点新增卡片（#377）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    const github = page.locator('.pt-site-rules-card', { hasText: 'github.com' });
    await github.locator('textarea[data-field="exclude"]').fill('.a');
    await github.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();
    // 未保存的改动在导入后丢弃，卡片显示合并后的规则 —— 否则再点保存会
    // 用旧文本覆盖刚导入的选择器
    await github.locator('textarea[data-field="exclude"]').fill('.unsaved');

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.a', '.b'], preserve: [], disableBuiltin: false },
      'example.com': { scope: ['main'], exclude: [], preserve: [], disableBuiltin: false },
    }));

    await expect(github.locator('textarea[data-field="exclude"]')).toHaveValue('.a\n.b');
    const example = page.locator('.pt-site-rules-card', { hasText: 'example.com' });
    await expect(example.locator('textarea[data-field="scope"]')).toHaveValue('main');
    const cards = await readUserSiteRules(serviceWorker);
    expect(cards).toEqual([
      { site: 'github.com', scope: [], exclude: ['.a', '.b'], preserve: [] },
      { site: 'example.com', scope: ['main'] },
    ]);
  });

  test('@core TC-E2E-82: 设置页导入站点规则 JSON 含格式错误的条目 → 只跳过这些条目并逐条列出原因；文件不是合法 JSON 时提示且规则不变（#378）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'example.com': { scope: [], exclude: ['.ad'], preserve: [], disableBuiltin: false },
      'example.org': { scope: [], exclude: '.ad', preserve: [], disableBuiltin: false },
      'http://example.net': { scope: [], exclude: [], preserve: [], disableBuiltin: false },
    }));
    const toast = page.locator('#pt-toast');
    // 导入 1 个站点、跳过 2 条：先出现的是导入数
    await expect(toast).toHaveText(/1\D+2/);
    const report = page.locator('#pt-site-rules-import-report');
    await expect(report).toBeVisible();
    await expect(report).toContainText('example.org');
    await expect(report).toContainText('http://example.net');
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(1);
    await expect(
      page.locator('.pt-site-rules-card', { hasText: 'example.com' }).locator('textarea[data-field="exclude"]'),
    ).toHaveValue('.ad');

    await page.setInputFiles('#pt-site-rules-import-file', {
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":'),
    });
    await expect(toast).toContainText('JSON');
    await expect(report).toBeHidden();
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(1);
    const cards = await readUserSiteRules(serviceWorker);
    expect(cards).toEqual([{ site: 'example.com', exclude: ['.ad'] }]);
  });

  test('@core TC-E2E-86: 设置页读取站点规则失败 → 导出提示原因且不下载，刷新列表提示原因且卡片不变（#526）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    const card = page.locator('.pt-site-rules-card', { hasText: 'github.com' });
    const exclude = card.locator('textarea[data-field="exclude"]');
    await exclude.fill('.a');
    await card.locator('.pt-site-rules-save').click();
    await expect(page.locator('#pt-toast')).toBeVisible();
    await exclude.fill('.unsaved');

    // 设置页里的存储读取失败
    await page.evaluate(() => {
      (chrome.storage.local as any).get = () => Promise.reject(new Error('boom'));
    });
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await page.click('#pt-site-rules-export-btn');
    const toast = page.locator('#pt-toast');
    // 提示文案与原因都随浏览器界面语言（CI 是英文，#588）
    const msg = (key: string) =>
      page.evaluate((k) => chrome.i18n.getMessage(k, [chrome.i18n.getMessage('domainStorageReadFailed')]), key);
    await expect(toast).toHaveText(await msg('siteRulesExportFailed'));
    expect(downloaded).toBe(false);

    // 其他标签页保存后本页刷新列表：读取失败，提示列表没有刷新（#549），
    // 已显示的卡片与未保存的编辑都还在
    await writeUserSiteRules(serviceWorker, [{ site: 'github.com', exclude: ['.b'] }]);
    await expect(toast).toHaveText(await msg('siteRulesListNotRefreshed'));
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(1);
    await expect(exclude).toHaveValue('.unsaved');
  });

  test('@core TC-E2E-94: 首次打开设置页就读取站点规则失败 → 提示站点卡片列表没有载入，不显示卡片（#549）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [{ site: 'github.com', exclude: ['.a'] }]);
    // 读取站点规则失败，直到 __ptFailGet 被清掉；每次写入之后又失败
    await page.addInitScript(() => {
      const local = chrome.storage.local as any;
      const w = window as any;
      const { get, set } = local;
      w.__ptFailGet = true;
      local.get = (...a: unknown[]) =>
        a[0] === 'pt-site-rules' && w.__ptFailGet ? Promise.reject(new Error('boom')) : get.apply(local, a);
      local.set = async (...a: unknown[]) => {
        await set.apply(local, a);
        w.__ptFailGet = true;
      };
    });
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const reason = await page.evaluate(() => chrome.i18n.getMessage('domainStorageReadFailed'));
    const notLoaded = await page.evaluate(
      (r) => chrome.i18n.getMessage('siteRulesListNotLoaded', [r]),
      reason,
    );
    const toast = page.locator('#pt-toast');
    await expect(toast).toHaveText(notLoaded);
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(0);

    // 新增站点写入成功、列表仍读取失败：合成提示也说列表没有载入
    await page.evaluate(() => {
      (window as any).__ptFailGet = false;
    });
    await page.fill('#pt-site-rules-site-input', 'example.com');
    await page.click('#pt-site-rules-add-btn');
    const stale = await page.evaluate(
      (r) =>
        chrome.i18n.getMessage('siteRulesListStaleNotLoaded', [
          chrome.i18n.getMessage('siteRulesAdded', ['example.com']),
          r,
        ]),
      reason,
    );
    await expect(toast).toHaveText(stale);
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(0);
    // 新增没有覆盖准备的规则：存储里同时有 github.com 与 example.com，不看顺序
    const sites = (await readUserSiteRules(serviceWorker)).map((u) => u.site);
    expect(sites).toHaveLength(2);
    expect(sites).toEqual(expect.arrayContaining(['github.com', 'example.com']));
  });

  test('@core TC-E2E-89: 导入写入成功、刷新站点卡片列表失败 → 提示同时说明导入了几个站点与列表没有刷新（#536）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await failGetAfterWrite(page);

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.a'], preserve: [], disableBuiltin: false },
      'example.com': { scope: ['main'], exclude: [], preserve: [], disableBuiltin: false },
    }));

    const imported = await page.evaluate(() => chrome.i18n.getMessage('siteRulesImported', ['2']));
    await expect(page.locator('#pt-toast')).toHaveText(await listStale(page, imported));
    await expect(page.locator('.pt-site-rules-card')).toHaveCount(0);
    expect(await readUserSiteRules(serviceWorker)).toHaveLength(2);
  });

  test('@core TC-E2E-90: 删除或新增站点写入成功、刷新站点卡片列表失败 → 提示写入已成功，新增时站点输入框不清空（#536）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(1);
    await failGetAfterWrite(page);
    const toast = page.locator('#pt-toast');

    // 删除：写入成功，提示说明已删除、列表没有刷新
    page.once('dialog', (d) => d.accept());
    await cards.locator('.pt-site-rules-delete').click();
    const deleted = await page.evaluate(() => chrome.i18n.getMessage('siteRulesDeletedSite', ['github.com']));
    await expect(toast).toHaveText(await listStale(page, deleted));
    // 删除已成功：被删站点的卡片立即移除（#548）
    await expect(cards).toHaveCount(0);

    // 新增：写入成功，提示说明站点已加上；输入框里的站点名还在
    await page.evaluate(() => {
      (window as any).__ptFailGet = false;
    });
    await page.fill('#pt-site-rules-site-input', 'example.com');
    await page.click('#pt-site-rules-add-btn');
    // 列表还没按删除刷新过：提示同时说明删除与新增都已成功（#550）
    const added = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesWrittenJoin', [
        chrome.i18n.getMessage('siteRulesDeletedSite', ['github.com']),
        chrome.i18n.getMessage('siteRulesAdded', ['example.com']),
      ]),
    );
    await expect(toast).toHaveText(await listStale(page, added));
    await expect(page.locator('#pt-site-rules-site-input')).toHaveValue('example.com');
    await expect(page.locator('#pt-site-rules-site-input')).not.toHaveClass(/pt-error/);
    expect((await readUserSiteRules(serviceWorker)).map((u) => u.site)).toEqual(['example.com']);
  });

  test('@core TC-E2E-91: 删除站点写入成功、刷新站点卡片列表失败 → 被删站点的卡片立即移除，其他卡片与未保存的编辑不变，再新增同名站点从空白开始（#548）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.old'] },
      { site: 'example.com', exclude: ['.a'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' });
    const example = cards.filter({ hasText: 'example.com' });
    await example.locator('textarea[data-field="exclude"]').fill('.unsaved');
    await failGetAfterWrite(page);

    page.once('dialog', (d) => d.accept());
    await github.locator('.pt-site-rules-delete').click();
    const deleted = await page.evaluate(() => chrome.i18n.getMessage('siteRulesDeletedSite', ['github.com']));
    await expect(page.locator('#pt-toast')).toHaveText(await listStale(page, deleted));
    // 被删站点的卡片不在了，其他卡片与未保存的编辑还在
    await expect(github).toHaveCount(0);
    await expect(cards).toHaveCount(1);
    await expect(example.locator('textarea[data-field="exclude"]')).toHaveValue('.unsaved');
    expect((await readUserSiteRules(serviceWorker)).map((u) => u.site)).toEqual(['example.com']);

    // 恢复读取后新增同名站点：新卡片从空白开始，不复用被删卡片的旧内容
    await page.evaluate(() => {
      const local = chrome.storage.local as any;
      const w = window as any;
      w.__ptFailGet = false;
      local.set = w.__ptSet;
    });
    await page.fill('#pt-site-rules-site-input', 'github.com');
    await page.click('#pt-site-rules-add-btn');
    await expect(github).toHaveCount(1);
    await expect(github.locator('textarea[data-field="exclude"]')).toHaveValue('');
  });

  test('@core TC-E2E-92: 导入写入成功、刷新站点卡片列表失败，之后在导入没改动的卡片上编辑 → 下次刷新保留这个编辑，导入改动过的字段显示导入后的内容（#550）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.old'] },
      { site: 'example.com', exclude: ['.a'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' });
    const example = cards.filter({ hasText: 'example.com' });
    await failGetAfterWrite(page);

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.new'], preserve: [], disableBuiltin: false },
    }));
    const imported = await page.evaluate(() => chrome.i18n.getMessage('siteRulesImported', ['1']));
    await expect(page.locator('#pt-toast')).toHaveText(await listStale(page, imported));

    // 导入没有改动 example.com：在它上面的编辑不该被之后的刷新清掉
    await example.locator('textarea[data-field="exclude"]').fill('.unsaved');
    await page.evaluate(() => {
      const local = chrome.storage.local as any;
      const w = window as any;
      w.__ptFailGet = false;
      local.set = w.__ptSet;
    });
    // 新增一个站点，触发一次成功的刷新
    await page.fill('#pt-site-rules-site-input', 'third.com');
    await page.click('#pt-site-rules-add-btn');
    await expect(cards).toHaveCount(3);
    await expect(example.locator('textarea[data-field="exclude"]')).toHaveValue('.unsaved');
    await expect(github.locator('textarea[data-field="exclude"]')).toHaveValue('.old\n.new');
  });

  test('@core TC-E2E-93: 导入后又删除站点，两次刷新站点卡片列表都失败 → 提示同时说明导入与删除都已成功（#550）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [{ site: 'example.com', exclude: ['.a'] }]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(1);
    await failGetAfterWrite(page);
    const toast = page.locator('#pt-toast');

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.new'], preserve: [], disableBuiltin: false },
    }));
    const imported = await page.evaluate(() => chrome.i18n.getMessage('siteRulesImported', ['1']));
    await expect(toast).toHaveText(await listStale(page, imported));

    // 删除前读取恢复（删除要先读再写），写入后刷新列表又读取失败
    await page.evaluate(() => {
      (window as any).__ptFailGet = false;
    });
    page.once('dialog', (d) => d.accept());
    await cards.locator('.pt-site-rules-delete').click();
    const both = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesWrittenJoin', [
        chrome.i18n.getMessage('siteRulesImported', ['1']),
        chrome.i18n.getMessage('siteRulesDeletedSite', ['example.com']),
      ]),
    );
    await expect(toast).toHaveText(await listStale(page, both));
  });

  test('@core TC-E2E-95: 连续两次导入写入成功、刷新站点卡片列表都失败，之后另一个标签页改了本页有未保存编辑的字段 → 下次刷新保留这个编辑，两次导入改动过的字段都显示导入后的内容（#557）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.old'] },
      { site: 'example.com', exclude: ['.a'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' });
    const example = cards.filter({ hasText: 'example.com' });
    await failGetAfterWrite(page);

    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.new'], preserve: [], disableBuiltin: false },
    }));
    const imported = await page.evaluate(() => chrome.i18n.getMessage('siteRulesImported', ['1']));
    const toast = page.locator('#pt-toast');
    await expect(toast).toHaveText(await listStale(page, imported));

    // 在第一次导入改动过的字段上编辑，再导入一次改动另一个字段（导入要先读再写）
    const githubExclude = github.locator('textarea[data-field="exclude"]');
    await githubExclude.fill('.stale');
    await page.evaluate(() => {
      (window as any).__ptFailGet = false;
    });
    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: ['main'], exclude: [], preserve: [], disableBuiltin: false },
    }));
    await expect(toast).toHaveText(await listStale(page, imported));

    // 本页在 example.com 上编辑，另一个标签页保存了同一个字段：不是导入改动的，
    // 编辑不该被之后的刷新清掉
    await example.locator('textarea[data-field="exclude"]').fill('.unsaved');
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.old', '.new'], scope: ['main'] },
      { site: 'example.com', exclude: ['.b'] },
    ]);
    await page.evaluate(() => {
      const local = chrome.storage.local as any;
      const w = window as any;
      w.__ptFailGet = false;
      local.set = w.__ptSet;
    });
    // 新增一个站点，触发一次成功的刷新
    await page.fill('#pt-site-rules-site-input', 'third.com');
    await page.click('#pt-site-rules-add-btn');
    await expect(cards).toHaveCount(3);
    await expect(example.locator('textarea[data-field="exclude"]')).toHaveValue('.unsaved');
    await expect(githubExclude).toHaveValue('.old\n.new');
    await expect(github.locator('textarea[data-field="scope"]')).toHaveValue('main');
  });

  test('@core TC-E2E-96: 渲染站点卡片列表时出错 → 提示列表没有刷新，已显示的卡片与未保存的编辑都保持刷新前的样子；之后刷新成功显示最新内容（#558）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a'] },
      { site: 'example.com', exclude: ['.b'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' }).locator('textarea[data-field="exclude"]');
    const example = cards.filter({ hasText: 'example.com' }).locator('textarea[data-field="exclude"]');
    await example.fill('.unsaved');
    await failCardRender(page);

    // 另一个标签页改了 github.com、新增了站点：渲染新站点的卡片时出错
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a2'] },
      { site: 'example.com', exclude: ['.b'] },
      { site: 'new.com', exclude: ['.n'] },
    ]);
    const notRefreshed = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesListNotRefreshed', ['渲染出错']),
    );
    await expect(page.locator('#pt-toast')).toHaveText(notRefreshed);
    await expect(cards).toHaveCount(2);
    await expect(github).toHaveValue('.a');
    await expect(example).toHaveValue('.unsaved');

    // 渲染恢复正常后再刷新：列表显示最新内容，未保存的编辑还在
    await page.evaluate(() => {
      (window as any).__ptFailRender = false;
    });
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a2'] },
      { site: 'example.com', exclude: ['.b'] },
      { site: 'new.com', exclude: ['.n2'] },
    ]);
    await expect(cards).toHaveCount(3);
    await expect(github).toHaveValue('.a2');
    await expect(example).toHaveValue('.unsaved');
    await expect(
      cards.filter({ hasText: 'new.com' }).locator('textarea[data-field="exclude"]'),
    ).toHaveValue('.n2');
  });

  test('@core TC-E2E-97: 连续删除两个站点，两次刷新站点卡片列表都失败 → 提示逐条列出两个被删的站点（#556）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a'] },
      { site: 'example.com', exclude: ['.b'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    await failGetAfterWrite(page);
    const toast = page.locator('#pt-toast');

    page.once('dialog', (d) => d.accept());
    await cards.filter({ hasText: 'github.com' }).locator('.pt-site-rules-delete').click();
    const first = await page.evaluate(() => chrome.i18n.getMessage('siteRulesDeletedSite', ['github.com']));
    await expect(toast).toHaveText(await listStale(page, first));

    // 删除前读取恢复（删除要先读再写），写入后刷新列表又读取失败
    await page.evaluate(() => {
      (window as any).__ptFailGet = false;
    });
    page.once('dialog', (d) => d.accept());
    await cards.filter({ hasText: 'example.com' }).locator('.pt-site-rules-delete').click();
    const both = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesWrittenJoin', [
        chrome.i18n.getMessage('siteRulesDeletedSite', ['github.com']),
        chrome.i18n.getMessage('siteRulesDeletedSite', ['example.com']),
      ]),
    );
    await expect(toast).toHaveText(await listStale(page, both));
    await expect(cards).toHaveCount(0);
  });

  test('@core TC-E2E-98: 渲染站点卡片列表时格式化无效选择器的提示出错 → 提示列表没有刷新，排在前面的卡片也保持刷新前的样子；之后刷新成功照常标出无效选择器（#564）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a'] },
      { site: 'example.com', scope: ['a['], exclude: ['.b'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' }).locator('textarea[data-field="exclude"]');
    const exampleCard = cards.filter({ hasText: 'example.com' });
    const example = exampleCard.locator('textarea[data-field="exclude"]');
    const scope = exampleCard.locator('textarea[data-field="scope"]');
    const error = exampleCard.locator('textarea[data-field="scope"] + .pt-site-rules-error');
    await expect(scope).toHaveClass(/pt-error/);
    await example.fill('.unsaved');
    // __ptFailFmt 为 true 时，“无效选择器”的文案转成文本时抛错。
    // 前提：扩展取文案的函数原样返回读到的结果。如果它改成先转成字符串再返回，
    // 错误会在函数内部被接住、换成默认文案，这里就模拟不出错误 —— 本用例会卡在
    // 等“列表没有刷新”的提示那一步，那时先检查这个前提，不是产品出了问题
    await page.evaluate(() => {
      const i18n = chrome.i18n as any;
      const getMessage = i18n.getMessage.bind(i18n);
      i18n.getMessage = (key: string, subs?: string | string[]) => {
        if ((window as any).__ptFailFmt && key === 'siteRulesInvalidSelector') {
          return {
            toString() {
              throw new Error('[PT] 格式化出错');
            },
          };
        }
        return getMessage(key, subs);
      };
      (window as any).__ptFailFmt = true;
    });

    // 另一个标签页改了排在前面的 github.com：渲染到 example.com 的无效选择器时出错
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a2'] },
      { site: 'example.com', scope: ['a['], exclude: ['.b'] },
    ]);
    const notRefreshed = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesListNotRefreshed', ['格式化出错']),
    );
    await expect(page.locator('#pt-toast')).toHaveText(notRefreshed);
    await expect(cards).toHaveCount(2);
    await expect(github).toHaveValue('.a');
    await expect(example).toHaveValue('.unsaved');

    // 格式化恢复正常后再刷新：列表显示最新内容，无效选择器照常标出，未保存的编辑还在
    await page.evaluate(() => {
      (window as any).__ptFailFmt = false;
    });
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.a3'] },
      { site: 'example.com', scope: ['a['], exclude: ['.b'] },
    ]);
    await expect(github).toHaveValue('.a3');
    await expect(example).toHaveValue('.unsaved');
    await expect(scope).toHaveValue('a[');
    await expect(scope).toHaveClass(/pt-error/);
    await expect(error).toBeVisible();
    await expect(error).toContainText('a[');
  });

  test('@core TC-E2E-99: 导入写入成功、刷新站点卡片列表时渲染出错，之后在导入改动过的字段与另一张卡片上编辑 → 下次刷新成功时导入改动过的字段显示导入后的内容，另一张卡片的编辑还在（#566）', async ({
    page, serviceWorker,
  }) => {
    await writeUserSiteRules(serviceWorker, [
      { site: 'github.com', exclude: ['.old'] },
      { site: 'example.com', exclude: ['.a'] },
    ]);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="site-rules"]');
    const cards = page.locator('.pt-site-rules-card');
    await expect(cards).toHaveCount(2);
    const github = cards.filter({ hasText: 'github.com' }).locator('textarea[data-field="exclude"]');
    const example = cards.filter({ hasText: 'example.com' }).locator('textarea[data-field="exclude"]');
    await failCardRender(page);

    // 导入改动 github.com 并新增 new.com：渲染新站点的卡片时出错
    await page.setInputFiles('#pt-site-rules-import-file', siteRulesFile({
      'github.com': { scope: [], exclude: ['.new'], preserve: [], disableBuiltin: false },
      'new.com': { scope: [], exclude: ['.n'], preserve: [], disableBuiltin: false },
    }));
    const stale = await page.evaluate(() =>
      chrome.i18n.getMessage('siteRulesListStale', [
        chrome.i18n.getMessage('siteRulesImported', ['2']),
        '渲染出错',
      ]),
    );
    await expect(page.locator('#pt-toast')).toHaveText(stale);
    await expect(cards).toHaveCount(2);
    await expect(github).toHaveValue('.old');

    // 导入改动过的字段上的编辑会被导入后的内容覆盖；导入没改动的卡片上的编辑要保留
    await github.fill('.edited');
    await example.fill('.unsaved');
    await page.evaluate(() => {
      (window as any).__ptFailRender = false;
    });
    // 新增一个站点，触发一次成功的刷新
    await page.fill('#pt-site-rules-site-input', 'third.com');
    await page.click('#pt-site-rules-add-btn');
    await expect(cards).toHaveCount(4);
    await expect(github).toHaveValue('.old\n.new');
    await expect(example).toHaveValue('.unsaved');
    await expect(
      cards.filter({ hasText: 'new.com' }).locator('textarea[data-field="exclude"]'),
    ).toHaveValue('.n');
  });
});

// ================================================================
// 自带 key 引擎：DeepSeek（#609）
// ================================================================

/**
 * 把目标语言定成 to，在设置页里存下的其余设置不动（#792）。
 *
 * 自带 key 引擎的两条用例走设置页配置，不写设置种子，目标语言是首装时按
 * 界面语言推导的：CI 的界面是 en-US，推导成 en，而 basic 夹具声明
 * lang="en"，页面级闸门会判定本页已经是目标语言、一个请求都不发。
 */
async function setTargetLang(sw: import('@playwright/test').Worker, to: string) {
  await sw.evaluate(async (to: string) => {
    const r = await chrome.storage.sync.get('pt-settings');
    await chrome.storage.sync.set({
      'pt-settings': { ...((r['pt-settings'] as object | undefined) ?? {}), to },
    });
  }, to);
}

const DEEPSEEK_CHAT = 'https://api.deepseek.com/chat/completions';

test.describe('自带 key 引擎：DeepSeek', () => {
  test('@core TC-E2E-103: 设置页填 DeepSeek key 并保存、拖到优先级首位 → 整页翻译用 DeepSeek（#609）', async ({
    page, serviceWorker, mockChat, gotoFixture,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    // e2e 环境自动同意权限申请；测试连接的探测请求在设置页发出
    await page.addInitScript(() => {
      chrome.permissions.request = (async () => true) as typeof chrome.permissions.request;
    });
    await page.context().route('https://api.deepseek.com/models', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );

    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="engines"]');
    const label = await page.evaluate(() => chrome.i18n.getMessage('descDeepseek'));
    await expect(page.locator('#pt-byok-keys')).toContainText('DeepSeek (BYOK)');
    await expect(page.locator('#pt-byok-keys')).toContainText(label);

    // 填 key、保存（测试连接成功即保存）
    await page.fill('#pt-key-deepseek', 'sk-deepseek-test');
    await page.click('#pt-test-deepseek');
    await expect(page.locator('#pt-key-result-deepseek')).toHaveClass(/pt-success/);
    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => {
          const r = await chrome.storage.local.get('pt-keys');
          return (r['pt-keys'] as Record<string, string> | undefined)?.deepseek;
        }),
      )
      .toBe('sk-deepseek-test');

    // 启用后拖到优先级列表首位
    await page.click('#pt-engine-disabled .pt-engine-enable[data-engine="deepseek"]');
    const enabled = page.locator('#pt-engine-list .pt-engine-item[data-engine="deepseek"]');
    // 先把优先级列表滚进视口：拖拽途中再滚动页面，HTML5 拖放事件不会触发
    await page.locator('#pt-engine-list').scrollIntoViewIfNeeded();
    await enabled.dragTo(page.locator('#pt-engine-list .pt-engine-item').first());
    await expect(page.locator('#pt-engine-list .pt-engine-item').first()).toHaveAttribute(
      'data-engine',
      'deepseek',
    );

    // popup 的引擎下拉框里也有 DeepSeek，并且选中它
    const popup = await page.context().newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await expect(popup.locator('#pt-engine-select option:checked')).toHaveText('DeepSeek (BYOK)');
    await popup.close();

    // 设置页那次授权只是 stub，SW 里的权限查询同样按已授权处理（#610）
    await serviceWorker.evaluate(() => {
      chrome.permissions.contains = (async () => true) as typeof chrome.permissions.contains;
    });
    await mockChat(DEEPSEEK_CHAT, { prefix: '[DS] ' });
    await setTargetLang(serviceWorker, 'zh-CN');
    await gotoFixture('basic');
    await translateAndWait(page);
    await expect(page.locator('.pt-trans').first()).toContainText('[DS] ');
  });

  test('@core TC-E2E-104: 设置页保存 DeepSeek key（测试连接）时拒绝授权 → 不发探测、key 不保存，提示缺权限（#610/#611）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.addInitScript(() => {
      chrome.permissions.request = (async (p: chrome.permissions.Permissions) => {
        (window as any).__ptPermissionRequests = [
          ...((window as any).__ptPermissionRequests ?? []),
          p.origins,
        ];
        return false;
      }) as typeof chrome.permissions.request;
    });
    let probes = 0;
    await page.context().route('https://api.deepseek.com/**', (route) => {
      probes++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
    });

    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="engines"]');
    await page.fill('#pt-key-deepseek', 'sk-deepseek-test');
    await page.click('#pt-test-deepseek');

    const expected = await page.evaluate(() =>
      chrome.i18n.getMessage('keyPermissionDenied', ['api.deepseek.com']),
    );
    const result = page.locator('#pt-key-result-deepseek');
    await expect(result).toHaveText(expected);
    await expect(result).toHaveClass(/pt-fail/);
    expect(probes).toBe(0);
    // #611: 权限在“测试连接”的这次点击里申请
    expect(await page.evaluate(() => (window as any).__ptPermissionRequests)).toEqual([
      ['https://api.deepseek.com/*'],
    ]);
    const saved = await serviceWorker.evaluate(async () => {
      const r = await chrome.storage.local.get('pt-keys');
      return (r['pt-keys'] as Record<string, string> | undefined)?.deepseek ?? null;
    });
    expect(saved).toBeNull();
  });

  test('@core TC-E2E-105: DeepSeek 的访问权限被撤销 → 整页翻译不发请求，提示缺权限的真实原因（#610）', async ({
    page, serviceWorker, mockChat, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['deepseek'] });
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({ 'pt-keys': { deepseek: 'sk-deepseek-test' } });
      // 在浏览器扩展管理里撤销了访问权限
      chrome.permissions.contains = (async () => false) as typeof chrome.permissions.contains;
    });
    await mockChat(DEEPSEEK_CHAT, { prefix: '[DS] ' });
    const requests = await mockRequests();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    const expected = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('enginePermissionMissing', ['api.deepseek.com']),
    );
    const toast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    await expect(toast).toHaveText(expected, { timeout: 30_000 });
    expect((await requests()).chat[DEEPSEEK_CHAT] ?? 0).toBe(0);
  });
});

// ================================================================
// 自带 key 引擎：Grok（#613）
// ================================================================

test.describe('自带 key 引擎：Grok', () => {
  test('@core TC-E2E-107: 设置页填 Grok key 并保存、拖到优先级首位 → 整页翻译用 Grok（#613）', async ({
    page, serviceWorker, mockChat, gotoFixture,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    // e2e 环境自动同意权限申请；测试连接发的最小 chat 请求在设置页发出
    await page.addInitScript(() => {
      chrome.permissions.request = (async () => true) as typeof chrome.permissions.request;
    });
    let probeBody: { model?: string; max_tokens?: number } = {};
    await page.context().route('https://api.x.ai/v1/chat/completions', (route) => {
      probeBody = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: 'p' } }] }),
      });
    });

    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="engines"]');
    const label = await page.evaluate(() => chrome.i18n.getMessage('descGrok'));
    await expect(page.locator('#pt-byok-keys')).toContainText('Grok (BYOK)');
    await expect(page.locator('#pt-byok-keys')).toContainText(label);

    // 填 key、保存（测试连接成功即保存）；探测是最小的 chat 请求
    await page.fill('#pt-key-grok', 'xai-test');
    await page.click('#pt-test-grok');
    await expect(page.locator('#pt-key-result-grok')).toHaveClass(/pt-success/);
    expect(probeBody.max_tokens).toBe(1);
    expect(probeBody.model).toBe('grok-4.20-0309-non-reasoning');
    await expect
      .poll(() =>
        serviceWorker.evaluate(async () => {
          const r = await chrome.storage.local.get('pt-keys');
          return (r['pt-keys'] as Record<string, string> | undefined)?.grok;
        }),
      )
      .toBe('xai-test');

    // 启用后拖到优先级列表首位
    await page.click('#pt-engine-disabled .pt-engine-enable[data-engine="grok"]');
    const enabled = page.locator('#pt-engine-list .pt-engine-item[data-engine="grok"]');
    // 先把优先级列表滚进视口：拖拽途中再滚动页面，HTML5 拖放事件不会触发
    await page.locator('#pt-engine-list').scrollIntoViewIfNeeded();
    await enabled.dragTo(page.locator('#pt-engine-list .pt-engine-item').first());
    await expect(page.locator('#pt-engine-list .pt-engine-item').first()).toHaveAttribute(
      'data-engine',
      'grok',
    );

    // popup 的引擎下拉框里也有 Grok，并且选中它
    const popup = await page.context().newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await expect(popup.locator('#pt-engine-select option:checked')).toHaveText('Grok (BYOK)');
    await popup.close();

    // 设置页那次授权只是 stub，SW 里的权限查询同样按已授权处理
    await serviceWorker.evaluate(() => {
      chrome.permissions.contains = (async () => true) as typeof chrome.permissions.contains;
    });
    await mockChat('https://api.x.ai/v1/chat/completions', { prefix: '[GK] ' });
    await setTargetLang(serviceWorker, 'zh-CN');
    await gotoFixture('basic');
    await translateAndWait(page);
    await expect(page.locator('.pt-trans').first()).toContainText('[GK] ');
  });
});

// ================================================================
// 输入翻译（#633）
// ================================================================

test.describe('输入翻译：圆点', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';

  /** 在 SW 里改一项设置（读-改-写 pt-settings），内容脚本经存储变更即时响应。 */
  async function patchStored(
    sw: import('@playwright/test').Worker,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await sw.evaluate(async (p) => {
      const r = await chrome.storage.sync.get('pt-settings');
      await chrome.storage.sync.set({ 'pt-settings': { ...(r['pt-settings'] as object), ...p } });
    }, patch);
  }

  test('@core TC-E2E-111: 多行文本框里打到 2 个字符浮出圆点，失焦消失，开关即时启停（#636；#665 起位置贴文字末尾）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('input');
    await waitForBall(page);

    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 空框、1 个字符：不出现
    await box.click();
    await expect(dot).toBeHidden();
    await page.keyboard.type('a');
    await expect(dot).toBeHidden();

    // 第 2 个字符：出现在框内（#665 起贴文字末尾，位置的真值见 TC-E2E-134）
    await page.keyboard.type('b');
    await expect(dot).toBeVisible();
    const b = (await box.boundingBox())!;
    const d = (await dot.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(b.x);
    expect(d.x + d.width).toBeLessThanOrEqual(b.x + b.width);
    expect(d.y).toBeGreaterThanOrEqual(b.y);
    expect(d.y + d.height).toBeLessThanOrEqual(b.y + b.height);

    // 点圆点不夺走输入框的焦点
    await dot.click();
    await expect(box).toBeFocused();

    // 失焦即消失，回到框里又出现
    await page.locator('#intro').click();
    await expect(dot).toBeHidden();
    await box.click();
    await expect(dot).toBeVisible();

    // 开关关掉：即刻消失；打开：焦点还在框里就即刻出现
    await patchStored(serviceWorker, { inputTranslate: false });
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(0);
    await patchStored(serviceWorker, { inputTranslate: true });
    await expect(dot).toBeVisible();
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(1);
  });

  test('@core TC-E2E-134: 多行文本框里圆点贴在最后一个字符之后 —— 换行、空行、末尾空格都对（#665）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 位置的真值：框的内容区起点、行高，加上按同一字体量出的文字宽度。字宽用
    // 框旁边的 span 量，不用画布：画布不带页面的语言区域，通用字体族会解析成
    // 另一款字体，长一点的文字就差出几像素（#666 发现）
    const geom = await box.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
        top: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
        lineHeight: parseFloat(cs.lineHeight),
      };
    });
    const textWidth = (text: string) =>
      box.evaluate((el, t) => {
        const cs = getComputedStyle(el);
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = t;
        el.parentElement!.append(sp);
        const w = sp.getBoundingClientRect().width;
        sp.remove();
        return w;
      }, text);
    /** 圆点应在第 line 行（从 0 数）、这一行文字 lineText 的末尾：左边缘在末尾右侧 4px（#667），竖直居中于这一行。 */
    const expectAtEnd = async (line: number, lineText: string) => {
      const x = geom.left + (await textWidth(lineText)) + 4;
      const cy = geom.top + geom.lineHeight * (line + 0.5);
      await expect(async () => {
        const d = (await dot.boundingBox())!;
        expect(Math.abs(d.x - x), `横向：第 ${line} 行“${lineText}”的末尾`).toBeLessThanOrEqual(2);
        expect(Math.abs(d.y + d.height / 2 - cy), `竖向：第 ${line} 行`).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 5_000 });
    };

    await box.click();
    await page.keyboard.type('hello');
    await expectAtEnd(0, 'hello');

    // 换行：贴到第二行的末尾
    await page.keyboard.press('Enter');
    await page.keyboard.type('wor');
    await expectAtEnd(1, 'wor');

    // 空行：末尾是空的第四行，贴在行首
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expectAtEnd(3, '');

    // 末尾空格：算进宽度
    await page.keyboard.type('ab   ');
    await expectAtEnd(3, 'ab   ');
  });

  test('@core TC-E2E-135: 连续打字期间不做镜像测量，停手约 140ms 后对齐一次到新的末尾（#670）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('input');
    await waitForBall(page);
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(1);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 在页面里记下：每次镜像测量（镜像元素进出圆点的 shadow root）与每次 input 的时刻
    await page.evaluate(() => {
      const w = window as unknown as { __mirrors: number[]; __lastInput: number };
      w.__mirrors = [];
      w.__lastInput = 0;
      const root = document.getElementById('pt-host-input-dot')!.shadowRoot!;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) if ((n as Element).tagName === 'DIV') w.__mirrors.push(performance.now());
        }
      }).observe(root, { childList: true });
      document.getElementById('reply')!.addEventListener('input', () => {
        w.__lastInput = performance.now();
      });
    });
    const log = () =>
      page.evaluate(() => {
        const w = window as unknown as { __mirrors: number[]; __lastInput: number };
        return { mirrors: [...w.__mirrors], lastInput: w.__lastInput };
      });

    await box.click();
    const typed = 'the quick brown fox';
    await page.keyboard.type(typed);
    await expect(dot).toBeVisible();

    // 停手后对齐恰好一次，发生在最后一次输入之后约 140ms
    await expect.poll(async () => (await log()).mirrors.length).toBe(1);
    const { mirrors, lastInput } = await log();
    // 打字期间（最后一次输入之前）没有任何测量
    expect(mirrors.filter((t) => t <= lastInput)).toEqual([]);
    expect(mirrors[0]! - lastInput).toBeGreaterThanOrEqual(130);

    // 对齐到了新的末尾（末尾右侧 4px，#667）
    const end = await box.evaluate((el, text) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const width = (t: string) => {
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = t;
        el.parentElement!.append(sp);
        const w = sp.getBoundingClientRect().width;
        sp.remove();
        return w;
      };
      return {
        x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + width(text) + 4,
        cy: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight) / 2,
      };
    }, typed);
    const d = (await dot.boundingBox())!;
    expect(Math.abs(d.x - end.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(d.y + d.height / 2 - end.cy)).toBeLessThanOrEqual(2);
  });

  test('@core TC-E2E-136: 多行文本框滚到看不见末尾时圆点钳在框的可见边缘内，不消失、不换样式；滚回来重新贴末尾（#669）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 打到超出框高：框自己滚到底，末尾在可见区里
    await box.click();
    await page.keyboard.type(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
    expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
    await expect(dot).toBeVisible();
    // 等停手对齐（#670）落定：之前圆点还在回落位置，滚动不会触发重算
    await page.waitForTimeout(400);
    const style = () =>
      dot.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, background: cs.backgroundColor, size: `${cs.width}x${cs.height}` };
      });
    const normal = await style();

    /** 框的可见区域：边框以内、滚动条以外。 */
    const visible = () =>
      box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left + el.clientLeft,
          top: r.top + el.clientTop,
          right: r.left + el.clientLeft + el.clientWidth,
          bottom: r.top + el.clientTop + el.clientHeight,
        };
      });
    const expectInside = async () => {
      const v = await visible();
      await expect(async () => {
        const d = (await dot.boundingBox())!;
        expect(d.x, '左').toBeGreaterThanOrEqual(v.left - 0.5);
        expect(d.x + d.width, '右').toBeLessThanOrEqual(v.right + 0.5);
        expect(d.y, '上').toBeGreaterThanOrEqual(v.top - 0.5);
        expect(d.y + d.height, '下').toBeLessThanOrEqual(v.bottom + 0.5);
      }).toPass({ timeout: 5_000 });
    };

    // 滚到顶：末尾落在框下方，圆点钳在可见区里，仍然显示、样式不变
    await box.evaluate((el) => (el.scrollTop = 0));
    await expectInside();
    await expect(dot).toBeVisible();
    expect(await style()).toEqual(normal);
    await expect(box).toBeFocused();

    // 滚到中间：末尾仍在下方，同样钳住
    await box.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
    await expectInside();

    // 滚回底：重新贴末尾（第 12 行“line 12”之后 4px；真值按当前滚动位置与同一字体量的字宽算）
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const end = await box.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const width = (t: string) => {
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = t;
        el.parentElement!.append(sp);
        const w = sp.getBoundingClientRect().width;
        sp.remove();
        return w;
      };
      const lh = parseFloat(cs.lineHeight);
      return {
        x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + width('line 12') + 4,
        cy: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) - el.scrollTop + lh * 11.5,
      };
    });
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      expect(Math.abs(d.x - end.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(d.y + d.height / 2 - end.cy)).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 5_000 });
  });

  test('@core TC-E2E-137: 圆点与光标并排不重叠 —— 与末尾字符之间留 4px 间隙；窄框里末尾顶到右内边缘时圆点也不压住光标（#667）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    /** 第一行文字 text 的末尾（光标所在）与这一行的上下沿；字宽按同一字体量。 */
    const lineEnd = (text: string) =>
      box.evaluate((el, t) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const width = (t: string) => {
          const sp = document.createElement('span');
          sp.style.font = cs.font;
          sp.style.whiteSpace = 'pre';
          sp.textContent = t;
          el.parentElement!.append(sp);
          const w = sp.getBoundingClientRect().width;
          sp.remove();
          return w;
        };
        const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
        return {
          x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + width(t),
          top,
          bottom: top + parseFloat(cs.lineHeight),
          boxRight: r.left + el.clientLeft + el.clientWidth,
          boxBottom: r.top + el.clientTop + el.clientHeight,
        };
      }, text);

    // 宽框：圆点在末尾字符右侧，中间留出 4px 间隙，竖直居中于这一行
    await box.click();
    await page.keyboard.type('hello');
    const e = await lineEnd('hello');
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      expect(d.x - e.x, '圆点左边缘与末尾字符之间的间隙').toBeGreaterThanOrEqual(3);
      expect(d.x - e.x).toBeLessThanOrEqual(5);
      expect(Math.abs(d.y + d.height / 2 - (e.top + e.bottom) / 2)).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 5_000 });

    // 窄框：把框收窄到第一行刚好装下这串字，末尾顶到右内边缘，右侧放不下圆点
    const text = 'mmmmmmmm';
    await box.evaluate((el, t) => {
      const cs = getComputedStyle(el);
      const width = (t: string) => {
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = t;
        el.parentElement!.append(sp);
        const w = sp.getBoundingClientRect().width;
        sp.remove();
        return w;
      };
      (el as HTMLTextAreaElement).value = '';
      el.style.boxSizing = 'content-box';
      el.style.width = `${Math.ceil(width(t)) + 1}px`;
    }, text);
    await page.keyboard.type(text);
    const n = await lineEnd(text);
    expect(n.x + 4 + 14, '右侧确实放不下圆点').toBeGreaterThan(n.boxRight);
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      // 光标是末尾处、这一行高的一条竖线：圆点要么整个在这一行之外，要么横向离开光标至少 3px
      const clearOfCaret =
        d.y >= n.bottom - 0.5 ||
        d.y + d.height <= n.top + 0.5 ||
        d.x >= n.x + 3 ||
        d.x + d.width <= n.x - 3;
      expect(clearOfCaret, `圆点 ${JSON.stringify(d)} 压住了光标 x=${n.x} 行 ${n.top}–${n.bottom}`).toBe(true);
      // 仍在框的可见区域里（#669）
      expect(d.x + d.width).toBeLessThanOrEqual(n.boxRight + 0.5);
      expect(d.y + d.height).toBeLessThanOrEqual(n.boxBottom + 0.5);
    }).toPass({ timeout: 5_000 });
    await expect(dot).toBeVisible();
  });

  test('@core TC-E2E-138: 单行文本框里圆点贴文字末尾 —— 短文本在末尾右侧；长文本横向滚动后位置随之更新、钳在框内；RTL 贴在左侧（#666）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#title');
    const dot = page.locator(DOT);
    // 右内边距放大到 10px：贴末尾、钳在边缘、回落右下角三种位置横向彼此相差至少 6px，能区分
    await box.evaluate((el) => (el.style.paddingRight = '10px'));

    /**
     * 框的几何与文字 text 的宽度，以及框内的横向滚动。字宽用框旁边同一字体的
     * span 量：画布不带页面的语言区域，通用字体族会解析成另一款字体，长文本差出
     * 几十像素。
     */
    const geom = (text: string) =>
      box.evaluate((el, t) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const span = document.createElement('span');
        span.style.font = cs.font;
        span.style.whiteSpace = 'pre';
        span.textContent = t;
        el.parentElement!.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        const top = r.top + el.clientTop;
        const bottom = top + el.clientHeight;
        return {
          contentLeft: r.left + el.clientLeft + parseFloat(cs.paddingLeft),
          contentRight: r.left + el.clientLeft + el.clientWidth - parseFloat(cs.paddingRight),
          left: r.left + el.clientLeft,
          right: r.left + el.clientLeft + el.clientWidth,
          top,
          bottom,
          cy: (top + parseFloat(cs.paddingTop) + bottom - parseFloat(cs.paddingBottom)) / 2,
          width,
          scrollLeft: el.scrollLeft,
        };
      }, text);
    const expectDot = async (x: number, cy: number, what: string) => {
      await expect(async () => {
        const d = (await dot.boundingBox())!;
        expect(Math.abs(d.x - x), `${what}：横向`).toBeLessThanOrEqual(2);
        expect(Math.abs(d.y + d.height / 2 - cy), `${what}：竖向`).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 5_000 });
    };

    // 短文本：末尾右侧 4px（#667），竖直居中于框的内容区
    await box.click();
    await page.keyboard.type('hello');
    let g = await geom('hello');
    await expectDot(g.contentLeft + g.width + 4, g.cy, '短文本贴末尾');

    // 长文本：框横向滚到末尾，右侧放不下圆点 → 圆点在光标左侧 4px，不压住光标
    const long = ' the quick brown fox jumps over the lazy dog again and again';
    await page.keyboard.type(long);
    g = await geom(`hello${long}`);
    expect(g.scrollLeft, '框确实横向滚动了').toBeGreaterThan(50);
    const caret = g.contentLeft + g.width - g.scrollLeft;
    await expectDot(caret - 4 - 14, g.cy, '长文本光标左侧');

    // 光标回到行首：框滚回开头，末尾在框外右侧 → 圆点钳在右边缘（#669），不消失
    await page.keyboard.press('Home');
    expect((await geom('')).scrollLeft).toBe(0);
    await expectDot(g.right - 14, g.cy, '末尾滚出框外');
    await expect(dot).toBeVisible();

    // 回到行尾：重新贴到光标旁
    await page.keyboard.press('End');
    await expectDot(caret - 4 - 14, g.cy, '回到行尾');

    // RTL：末尾在左侧，圆点贴在文字左边、留 4px
    await box.evaluate((el) => {
      (el as HTMLInputElement).value = '';
      el.style.paddingRight = '';
      (el as HTMLInputElement).dir = 'rtl';
    });
    const hebrew = 'שלום עולם';
    await page.keyboard.type(hebrew);
    g = await geom(hebrew);
    await expectDot(g.contentRight - g.width - 4 - 14, g.cy, 'RTL 贴左侧');
  });

  test('@core TC-E2E-139: 祖先带 transform 缩放时测不准 → 圆点回落到框内侧右下角，照常显示、点下去照常翻译（#668）', async ({
    page, seedSettings, gotoFixture, mockGoogle,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 站点把整块评论区缩小到一半显示
    await box.evaluate((el) => {
      const wrap = document.createElement('div');
      wrap.style.transform = 'scale(0.5)';
      wrap.style.transformOrigin = '0 0';
      el.before(wrap);
      wrap.append(el);
    });
    await box.click();
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();

    // 回落位置：屏幕上框的内侧右下角，离内边缘 6px（框按 0.5 缩放，圆点本身不缩放）
    const inner = await box.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = r.width / (el as HTMLElement).offsetWidth;
      return {
        right: r.left + (el.clientLeft + el.clientWidth) * s,
        bottom: r.top + (el.clientTop + el.clientHeight) * s,
      };
    });
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      expect(Math.abs(d.x + d.width - (inner.right - 6)), '横向').toBeLessThanOrEqual(1);
      expect(Math.abs(d.y + d.height - (inner.bottom - 6)), '竖向').toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5_000 });

    // 可用：圆点在最上层，点下去照常翻译写回
    const d = (await dot.boundingBox())!;
    expect(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.id,
        [d.x + d.width / 2, d.y + d.height / 2] as const,
      ),
    ).toBe('pt-host-input-dot');
    await dot.click();
    await expect(box).toHaveValue('【译】你好世界 [tl=en]', { timeout: 10_000 });
  });

  test('@core TC-E2E-140: 停手之后字体才加载完、或站点改了框的样式与尺寸 → 圆点重新对齐到新的末尾（#668）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 网页字体：每个字形 1em 宽的测试字体，由用例决定它什么时候下载完
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    await page.route('**/pt-wide.ttf', async (route) => {
      await released;
      await route.fulfill({
        contentType: 'font/ttf',
        body: fs.readFileSync('docs/testing/e2e/fixtures/fonts/pt-wide.ttf'),
      });
    });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent =
        '@font-face { font-family: PTWide; src: url(/fonts/pt-wide.ttf); font-display: swap; }' +
        '#reply { font-family: PTWide, sans-serif; }';
      document.head.append(s);
    });

    /** 第一行文字 text 的末尾右侧 4px 与这一行的竖直中线；字宽用框旁边同一字体的 span 量。 */
    const endOf = (text: string) =>
      box.evaluate((el, t) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = t;
        el.parentElement!.append(sp);
        const w = sp.getBoundingClientRect().width;
        sp.remove();
        return {
          x: r.left + el.clientLeft + parseFloat(cs.paddingLeft) + w + 4,
          cy: r.top + el.clientTop + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight) / 2,
        };
      }, text);
    const expectAt = async (text: string, what: string) => {
      await expect(async () => {
        const e = await endOf(text);
        const d = (await dot.boundingBox())!;
        expect(Math.abs(d.x - e.x), `${what}：横向`).toBeLessThanOrEqual(2);
        expect(Math.abs(d.y + d.height / 2 - e.cy), `${what}：竖向`).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 5_000 });
    };

    // 字体还在下载：先按后备字体排版，圆点贴在后备字体的末尾
    await box.click();
    await page.keyboard.type('hello');
    await expectAt('hello', '后备字体');
    const before = (await dot.boundingBox())!;

    // 停手之后字体才下载完：没有输入、没有滚动、框也没变大，圆点照样重新对齐
    release();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px PTWide'))).toBe(true);
    await expectAt('hello', '字体加载完成');
    expect((await dot.boundingBox())!.x - before.x, '换成 1em 宽的字形后末尾右移').toBeGreaterThan(20);

    // 站点改了框的样式（行内样式）：重新对齐
    await box.evaluate((el) => (el.style.fontSize = '24px'));
    await expectAt('hello', '站点改了字号');

    // 站点经样式表把框改窄（不碰框的属性）：换行变了，重新对齐到第二行
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = '#reply { width: 100px; }';
      document.head.append(s);
    });
    await expect(async () => {
      const e = await endOf('');
      const lh = await box.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      const d = (await dot.boundingBox())!;
      // 100px 宽装不下 5 个 24px 的方块：末尾落到下面某一行，竖直方向离开第一行
      expect(d.y + d.height / 2 - e.cy).toBeGreaterThan(lh / 2);
    }).toPass({ timeout: 5_000 });
    await expect(dot).toBeVisible();
  });

  test('@core TC-E2E-141: contenteditable 里圆点贴文字末尾 —— 多行、行内混排（链接、加粗）都对；末尾滚出可见区钳在框内、滚回来重新贴末尾（#671）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('rich-input');
    await waitForBall(page);
    const box = page.locator('#rich');
    const dot = page.locator(DOT);

    /** 文字末尾的真值：光标放到最后一个文本节点末尾时的位置（折叠选区的矩形）。 */
    const caretAtEnd = () =>
      box.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        while (walker.nextNode()) if ((walker.currentNode as Text).length > 0) last = walker.currentNode as Text;
        const r = document.createRange();
        r.setStart(last!, last!.length);
        r.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        const c = r.getClientRects()[0]!;
        return { x: c.left, cy: c.top + c.height / 2 };
      });
    /** 圆点在末尾右侧 4px（#667），竖直居中于末尾那一行。 */
    const expectAtEnd = async (what: string) => {
      await expect(async () => {
        const e = await caretAtEnd();
        const d = (await dot.boundingBox())!;
        expect(Math.abs(d.x - (e.x + 4)), `${what}：横向`).toBeLessThanOrEqual(2);
        expect(Math.abs(d.y + d.height / 2 - e.cy), `${what}：竖向`).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 5_000 });
    };
    /** 站点（或编辑器）直接改写编辑区的内容；改完等停手对齐。 */
    const setHtml = (html: string) => box.evaluate((el, h) => (el.innerHTML = h), html);

    // 单行
    await box.click();
    await page.keyboard.type('hello');
    await expectAtEnd('单行');

    // 多行：换行后末尾在第二行
    await page.keyboard.press('Enter');
    await page.keyboard.type('world');
    await expectAtEnd('多行');

    // 行内混排：末尾是加粗
    await setHtml('see <a href="#x">the docs</a> and <b>bold text</b>');
    await expectAtEnd('末尾是加粗');
    // 末尾是链接
    await setHtml('read <b>this</b> first, then <a href="#y">the link</a>');
    await expectAtEnd('末尾是链接');
    // 多行加行内混排
    await setHtml('<div>first <i>line</i></div><div>second <b>bold</b> and <a href="#z">a link</a></div>');
    await expectAtEnd('多行混排');

    // 钳边（#669）：框限高可滚动，滚到顶时末尾在框下方，圆点钳在可见区里，不消失
    await box.evaluate((el) => {
      el.style.height = '60px';
      el.style.minHeight = '0';
      el.style.overflowY = 'auto';
    });
    await setHtml(Array.from({ length: 10 }, (_, i) => `<div>line ${i + 1}</div>`).join(''));
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expectAtEnd('滚到底');
    await box.evaluate((el) => (el.scrollTop = 0));
    const v = await box.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left + el.clientLeft,
        top: r.top + el.clientTop,
        right: r.left + el.clientLeft + el.clientWidth,
        bottom: r.top + el.clientTop + el.clientHeight,
      };
    });
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      expect(d.x).toBeGreaterThanOrEqual(v.left - 0.5);
      expect(d.x + d.width).toBeLessThanOrEqual(v.right + 0.5);
      expect(d.y).toBeGreaterThanOrEqual(v.top - 0.5);
      expect(d.y + d.height).toBeLessThanOrEqual(v.bottom + 0.5);
    }).toPass({ timeout: 5_000 });
    await expect(dot).toBeVisible();

    // 滚回底：重新贴末尾
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expectAtEnd('滚回底');
  });

  test('@core TC-E2E-128: contenteditable 富文本框获得焦点且有文字时浮出圆点，在框内（#671 起贴文字末尾）；非编辑态元素与可编辑区里的 contenteditable=false 子块不出现（#655）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('rich-input');
    await waitForBall(page);

    const box = page.locator('#rich');
    const dot = page.locator(DOT);

    // 获得焦点、还没有字：不出现；打到第 2 个字符才出现
    await box.click();
    await expect(dot).toBeHidden();
    await page.keyboard.type('a');
    await expect(dot).toBeHidden();
    await page.keyboard.type('b');
    await expect(dot).toBeVisible();

    // 换行后的文字同样算数，整颗圆点在框里（#671 起贴文字末尾，位置的真值见 TC-E2E-141）
    await page.keyboard.press('Enter');
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();
    const b = (await box.boundingBox())!;
    const d = (await dot.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(b.x);
    expect(d.x + d.width).toBeLessThanOrEqual(b.x + b.width);
    expect(d.y).toBeGreaterThanOrEqual(b.y);
    expect(d.y + d.height).toBeLessThanOrEqual(b.y + b.height);

    // 点圆点不夺走焦点
    await dot.click();
    await expect(box).toBeFocused();

    // 非编辑态的普通元素获得焦点：不出现
    await page.locator('#static').focus();
    await expect(dot).toBeHidden();

    // 可编辑区里插入一个不可编辑、可聚焦的提及块；焦点落在它上面时不出现
    await box.evaluate((el) => {
      const chip = document.createElement('span');
      chip.id = 'chip';
      chip.className = 'chip';
      chip.contentEditable = 'false';
      chip.tabIndex = 0;
      chip.textContent = '@alice';
      el.append(' ', chip);
    });
    await box.focus();
    await expect(dot).toBeVisible();
    await page.locator('#chip').focus();
    await expect(page.locator('#chip')).toBeFocused();
    await expect(dot).toBeHidden();

    // 回到编辑宿主又出现
    await box.focus();
    await expect(dot).toBeVisible();
  });
});

test.describe('输入翻译：点圆点翻译', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';
  const TOAST = '#pt-host-toast .pt-toast';

  /**
   * 记录发给 Google 的原文（#766）：记在替身层，SW 中途换了实例时以“不可信”
   * 报错，不在清零后的记录上断言“零请求”。
   */
  async function recordGoogleQueries(mockRequests: () => Promise<() => Promise<MockRequests>>) {
    const requests = await mockRequests();
    return async () => (await requests()).queries;
  }

  test('@core TC-E2E-112: 点圆点 → 译成源语言，术语照常生效（#639；#644 起译文写回输入框）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // ADR-0005：目标语言取源语言。当前领域按目标语言解析，所以领域是 en 方向的
    await seedSettings({ from: 'en', to: 'zh-CN' });
    await mockGoogle({ echoTargetLang: true });
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e-input',
            name: 'E2E input',
            targetLang: 'en',
            sites: ['localhost'],
            origin: 'user',
            terms: [{ source: 'GitHub', noTranslate: true }],
          }],
          builtin: {},
        },
      }),
    );
    const queries = await recordGoogleQueries(mockRequests);

    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    await box.click();
    await page.keyboard.type('我在 GitHub 上写回复');
    await page.locator(DOT).click();

    // #644：译文写回输入框，不再弹提示条
    await expect(box).toHaveValue('【译】我在 GitHub 上写回复 [tl=en]', { timeout: 10_000 });
    // “不翻译”术语以占位符发出，回来换回原词
    expect(await queries()).toEqual(['我在 ⟦TM0⟧ 上写回复']);
    await expect(page.locator(TOAST)).toHaveCount(0);
    await expect(box).toBeFocused();
  });

  test('@core TC-E2E-114: 译文整段替换框里全部文字 —— 有没有选区都一样，走原生插入，焦点还在（#644）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);

    // 页面自己的监听：写回必须是一次真实的原生文本插入，而不是脚本赋值
    await page.evaluate(() => {
      (window as any).__ptInputTypes = [] as string[];
      document.getElementById('reply')!.addEventListener('input', (e) => {
        (window as any).__ptInputTypes.push((e as InputEvent).inputType);
      });
    });
    const inputTypes = () => page.evaluate(() => [...(window as any).__ptInputTypes] as string[]);
    const box = page.locator('#reply');

    // 没有选区：光标停在末尾
    await box.click();
    await page.keyboard.type('第一段');
    await page.keyboard.press('Enter');
    await page.keyboard.type('第二段');
    await page.locator(DOT).click();
    await expect(box).toHaveValue('【译】第一段\n第二段', { timeout: 10_000 });
    await expect(box).toBeFocused();
    expect((await inputTypes()).at(-1)).toBe('insertText');

    // 有选区：只选中末尾 2 个字，替换的仍是全部文字
    await box.fill('');
    await page.keyboard.type('你好世界');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.locator(DOT).click();
    await expect(box).toHaveValue('【译】你好世界', { timeout: 10_000 });
    await expect(box).toBeFocused();
    expect((await inputTypes()).at(-1)).toBe('insertText');
  });

  test('@core TC-E2E-115: 替换后按撤销键回到原文，再按重做回到译文 —— 真实按键（#645）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);

    const box = page.locator('#reply');
    await box.click();
    await page.keyboard.type('这是我自己写的话');
    await page.locator(DOT).click();
    await expect(box).toHaveValue('【译】这是我自己写的话', { timeout: 10_000 });

    // 撤销：Ctrl+Z（macOS 上是 Cmd+Z），框里回到原文
    await page.keyboard.press('ControlOrMeta+z');
    await expect(box).toHaveValue('这是我自己写的话');

    // 重做：Ctrl+Shift+Z（macOS 上是 Cmd+Shift+Z），回到译文
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(box).toHaveValue('【译】这是我自己写的话');
  });

  test('@core TC-E2E-117: 翻译进行中连点圆点只发一次请求，框里文字一个字不动；完成后恢复可点（#647）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    // 译文晚 1.5 秒回来，连点都落在翻译进行中
    await mockGoogle({ delayMs: 1_500 });
    const queries = await recordGoogleQueries(mockRequests);

    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);
    await box.click();
    await page.keyboard.type('你好世界');

    // 双击再补一下：三次点击都落在第一次翻译回来之前。#648 起进行中的
    // 圆点在转圈，Playwright 会等元素静止才点 —— force 跳过这条等待，
    // 让点击真的落在进行中
    await dot.dblclick({ force: true });
    await dot.click({ force: true });
    // 进行中框里不插入任何占位或提示文字
    await expect(box).toHaveValue('你好世界');
    expect(await queries()).toEqual(['你好世界']);

    await expect(box).toHaveValue('【译】你好世界', { timeout: 10_000 });
    expect(await queries()).toEqual(['你好世界']);

    // 完成后恢复可点：再点一次照常发请求
    await dot.click();
    await expect(box).toHaveValue('【译】【译】你好世界', { timeout: 10_000 });
    expect(await queries()).toEqual(['你好世界', '【译】你好世界']);
  });

  test('@core TC-E2E-118: 源语言是 auto（默认）且页面没有语言声明时点圆点 → 不发请求，提示去设置里指定源语言，框里文字不动（#640；#658 起有声明时按声明翻译）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    const queries = await recordGoogleQueries(mockRequests);
    const hint = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('toastInputSourceLangNeeded'),
    );
    expect(hint).not.toBe('');

    await gotoFixture('input');
    await waitForBall(page);
    // 夹具声明了 lang="en"；去掉它，模拟没有语言声明的页面
    await page.evaluate(() => document.documentElement.removeAttribute('lang'));
    const box = page.locator('#reply');
    await box.click();
    await page.keyboard.type('你好世界');
    await page.locator(DOT).click();

    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(hint);
    await expect(box).toHaveValue('你好世界');
    expect(await queries()).toEqual([]);
  });

  test('@core TC-E2E-125: 源语言是 auto（默认）时按页面的语言声明翻译，取语言码主段；声明畸形时仍提示去指定源语言（#658）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    const queries = await recordGoogleQueries(mockRequests);
    const hint = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('toastInputSourceLangNeeded'),
    );

    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 夹具声明 lang="en"：译成英文
    await box.click();
    await page.keyboard.type('你好世界');
    await dot.click();
    await expect(box).toHaveValue('【译】你好世界 [tl=en]', { timeout: 10_000 });

    // 声明带地区后缀：取主段
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'ja-JP'));
    await box.fill('');
    await page.keyboard.type('早上好');
    await dot.click();
    await expect(box).toHaveValue('【译】早上好 [tl=ja]', { timeout: 10_000 });

    // 声明畸形：不猜，提示去指定源语言，零请求
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'english'));
    await box.fill('');
    await page.keyboard.type('晚安');
    await dot.click();
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(hint);
    await expect(box).toHaveValue('晚安');
    expect(await queries()).toEqual(['你好世界', '早上好']);
  });

  test('@core TC-E2E-127: 写的已经是对方的语言 → 不替换、不发请求并提示；zh-CN 与 zh-TW 不算同语言（#661）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    const queries = await recordGoogleQueries(mockRequests);
    const hint = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('toastInputSameLanguage'),
    );

    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);
    const toast = page.locator(TOAST);
    /** 清空输入框、在本页声明下写一段字、点圆点。 */
    const write = async (lang: string, text: string) => {
      await page.evaluate((l) => document.documentElement.setAttribute('lang', l), lang);
      await box.fill('');
      await page.keyboard.type(text);
      await dot.click();
    };
    await box.click();

    // 简体页面上写简体：不替换、零请求，提示（不是报错）
    await write('zh-CN', '这个问题我们明天再讨论');
    await expect(toast).toHaveText(hint);
    await expect(toast).toHaveAttribute('data-kind', 'info');
    await expect(box).toHaveValue('这个问题我们明天再讨论');

    // 繁体页面上写繁体：同上
    await write('zh-TW', '這個問題我們明天再討論');
    await expect(toast).toHaveText(hint);
    await expect(box).toHaveValue('這個問題我們明天再討論');

    // 英文页面上写一句英文：浏览器检测器给出可靠结果，同样不替换
    await write('en', 'I think we should discuss this issue tomorrow morning.');
    await expect(toast).toHaveText(hint);
    await expect(box).toHaveValue('I think we should discuss this issue tomorrow morning.');
    expect(await queries()).toEqual([]);

    // 繁体页面上写简体：不算同语言，照常译成繁体
    await write('zh-Hant', '这个问题我们明天再讨论');
    await expect(box).toHaveValue('【译】这个问题我们明天再讨论 [tl=zh-TW]', { timeout: 10_000 });
    expect(await queries()).toEqual(['这个问题我们明天再讨论']);
  });

  test('@core TC-E2E-129: contenteditable 里点圆点整段替换 —— 受控编辑器收到 insertText 输入事件，内部模型与界面一致、光标在末尾；普通 contenteditable 走原生插入（#656）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle({});
    await gotoFixture('rich-input');
    await waitForBall(page);
    const dot = page.locator(DOT);
    /** 受控编辑器夹具的状态：模型、收到的输入事件、绕过编辑器的 DOM 变动、界面文字。 */
    const editorState = () =>
      page.evaluate(() => {
        const s = (window as unknown as { __editor: {
          model: string;
          sel: { start: number; end: number };
          inputs: Array<{ inputType: string; data: string | null }>;
          foreignMutations: number;
        } }).__editor;
        return {
          model: s.model,
          sel: s.sel,
          last: s.inputs.at(-1),
          foreign: s.foreignMutations,
          text: document.getElementById('editor')!.innerText,
        };
      });

    // 受控编辑器：自己拦下 beforeinput、改模型、重新渲染，不发 input 事件
    const editor = page.locator('#editor');
    await editor.click();
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();
    // 有选区也整段替换
    await page.keyboard.press('Shift+ArrowLeft');
    await dot.click();
    await expect(editor).toHaveText('【译】你好世界', { timeout: 10_000 });
    const after = await editorState();
    expect(after.model).toBe('【译】你好世界');
    expect(after.text).toBe(after.model);
    expect(after.last).toEqual({ inputType: 'insertText', data: '【译】你好世界' });
    expect(after.foreign).toBe(0);
    expect(after.sel).toEqual({ start: after.model.length, end: after.model.length });
    await expect(editor).toBeFocused();
    // 接着打字落在末尾，模型照常跟着走
    await page.keyboard.type('!');
    expect((await editorState()).model).toBe('【译】你好世界!');

    // 普通 contenteditable：没人拦 beforeinput，走浏览器原生插入，页面收到真实的 input
    const rich = page.locator('#rich');
    await rich.click();
    await page.keyboard.type('早上好');
    await rich.evaluate((el) => {
      const log: Array<{ inputType: string; data: string | null }> = [];
      el.addEventListener('input', (e) => log.push({ inputType: (e as InputEvent).inputType, data: (e as InputEvent).data }));
      (window as unknown as { __richInputs: typeof log }).__richInputs = log;
    });
    await dot.click();
    await expect(rich).toHaveText('【译】早上好', { timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __richInputs: unknown }).__richInputs)).toEqual([
      { inputType: 'insertText', data: '【译】早上好' },
    ]);
    await expect(rich).toBeFocused();
  });

  test('@core TC-E2E-130: 受控编辑器里同样有原文快照、在飞标记与转圈 —— 进行中再点不发第二次请求，送翻后又打了字就不覆盖、译文进提示条（#656）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle({ delayMs: 1_500 });
    const queries = await recordGoogleQueries(mockRequests);
    await gotoFixture('rich-input');
    await waitForBall(page);
    const dot = page.locator(DOT);
    const editor = page.locator('#editor');
    const model = () => page.evaluate(() => (window as unknown as { __editor: { model: string } }).__editor.model);

    await editor.click();
    await page.keyboard.type('你好世界');
    await dot.click();
    // #648：进行中变灰转圈
    await expect(dot).toHaveAttribute('data-state', 'busy');
    // #647：进行中再点不发第二次请求，编辑器里一个字不动（转圈中的元素不等它静止）
    await dot.click({ force: true });
    expect(await model()).toBe('你好世界');

    // #646：送翻后又打了字 → 不覆盖，译文出现在提示条里
    await page.keyboard.type('!');
    await expect(page.locator(TOAST)).toHaveText('【译】你好世界', { timeout: 10_000 });
    expect(await model()).toBe('你好世界!');
    await expect(editor).toHaveText('你好世界!');
    await expect(dot).not.toHaveAttribute('data-state', 'busy');
    expect(await queries()).toEqual(['你好世界']);
  });

  test('@core TC-E2E-131: contenteditable 替换后按撤销键回到原文、重做回到译文 —— 普通 contenteditable 走原生撤销栈，受控编辑器走它自己的撤销栈，都用真实按键（#657）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('rich-input');
    await waitForBall(page);
    const dot = page.locator(DOT);

    // 普通 contenteditable：替换进了浏览器的原生撤销栈
    const rich = page.locator('#rich');
    await rich.click();
    await page.keyboard.type('这是我自己写的话');
    await dot.click();
    await expect(rich).toHaveText('【译】这是我自己写的话', { timeout: 10_000 });
    // 撤销：Ctrl+Z（macOS 上是 Cmd+Z），一步回到原文
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rich).toHaveText('这是我自己写的话');
    // 重做：Ctrl+Shift+Z（macOS 上是 Cmd+Shift+Z），回到译文
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(rich).toHaveText('【译】这是我自己写的话');

    // 受控编辑器：撤销栈由编辑器自己管，替换是它模型里的一步
    const editor = page.locator('#editor');
    const model = () => page.evaluate(() => (window as unknown as { __editor: { model: string } }).__editor.model);
    await editor.click();
    await page.keyboard.type('早上好');
    await dot.click();
    await expect(editor).toHaveText('【译】早上好', { timeout: 10_000 });
    expect(await model()).toBe('【译】早上好');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveText('早上好');
    expect(await model()).toBe('早上好');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor).toHaveText('【译】早上好');
    expect(await model()).toBe('【译】早上好');
  });

  test('@core TC-E2E-132: 译文比框的长度上限长时不写回 —— 框里还是原文，译文出现在提示条里；刚好装得下照常替换（#654）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);
    const dot = page.locator(DOT);
    const toast = page.locator(TOAST);
    // 原文 4 个字符，译文“【译】你好世界”7 个字符
    const original = '你好世界';
    const translated = '【译】你好世界';

    for (const sel of ['#reply', '#title']) {
      const box = page.locator(sel);

      // 上限比译文短一个字符：不写回，不截断
      await box.evaluate((el, n) => el.setAttribute('maxlength', String(n)), translated.length - 1);
      await box.fill('');
      await box.click();
      await page.keyboard.type(original);
      await dot.click();
      await expect(toast).toHaveText(translated, { timeout: 10_000 });
      await expect(box).toHaveValue(original);

      // 上限刚好等于译文长度：照常替换
      await box.evaluate((el, n) => el.setAttribute('maxlength', String(n)), translated.length);
      await dot.click();
      await expect(box).toHaveValue(translated, { timeout: 10_000 });
    }
  });

  test('@core TC-E2E-133: 输入超过阅读侧单元上限（3072 字符）→ 不发请求、不分段，提示删减；刚好等于上限照常翻译（#643）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    const queries = await recordGoogleQueries(mockRequests);
    const hint = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('toastInputTooLong', ['3072']),
    );
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 上限加一：不发请求，框里不动，提示删减
    const tooLong = '字'.repeat(3073);
    await box.click();
    await box.fill(tooLong);
    await dot.click();
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(hint);
    await expect(box).toHaveValue(tooLong);
    expect(await queries()).toEqual([]);

    // 刚好等于上限：照常翻译，整段一次送出
    const atLimit = '字'.repeat(3072);
    await box.fill(atLimit);
    await dot.click();
    await expect(box).toHaveValue(`【译】${atLimit}`, { timeout: 10_000 });
    expect(await queries()).toEqual([atLimit]);
  });

  test('@core TC-E2E-124: 翻译进行中圆点变灰转圈；完成、失败、放弃写回之后都回到常态（#648）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    // 译文晚 1.5 秒回来；“坏掉的话”这一段请求立即失败
    await mockGoogle({ delayMs: 1_500, failTexts: ['坏掉的话'] });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    /** 圆点此刻的样子：状态属性、动画名与底色。 */
    const look = () =>
      dot.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          state: (el as HTMLElement).dataset.state ?? null,
          animation: cs.animationName,
          background: cs.backgroundColor,
        };
      });

    await box.click();
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();
    const idle = await look();
    expect(idle).toMatchObject({ state: null, animation: 'none' });

    // 完成：进行中变灰转圈，写回后回到常态
    await dot.click();
    const busy = await look();
    expect(busy).toMatchObject({ state: 'busy', animation: 'pt-spin' });
    expect(busy.background).not.toBe(idle.background);
    await expect(box).toHaveValue('【译】你好世界', { timeout: 10_000 });
    await expect.poll(look).toEqual(idle);

    // 放弃写回：进行中继续打字，译文进提示条，圆点回到常态
    await box.fill('');
    await page.keyboard.type('早上好');
    await dot.click();
    await expect.poll(look).toMatchObject({ state: 'busy' });
    await page.keyboard.type('呀');
    await expect(page.locator(`${TOAST}[data-kind="info"]`)).toHaveText('【译】早上好', {
      timeout: 10_000,
    });
    await expect.poll(look).toEqual(idle);

    // 失败：提示条报错，圆点回到常态（mock 的失败响应不走延迟，
    // 进行中的样子在上面两段已经断言过）
    await box.fill('');
    await page.keyboard.type('坏掉的话');
    await dot.click();
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toBeVisible({ timeout: 15_000 });
    await expect.poll(look).toEqual(idle);
    await expect(box).toHaveValue('坏掉的话');
  });

  test('@core TC-E2E-113: 站点被拉黑时圆点不出现，打字、聚焦都零请求（#639；#649 起圆点不注册）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en', siteList: { mode: 'blacklist', list: ['localhost'] } });
    await mockGoogle();
    const queries = await recordGoogleQueries(mockRequests);

    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    await box.click();
    await page.keyboard.type('你好世界');

    // #649：未获准入的站点上圆点根本不注册，而不是浮出来、点下去才提示
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(0);
    expect(await queries()).toEqual([]);
    await expect(box).toHaveValue('你好世界');
  });
});

test.describe('输入翻译：单行文本框与搜索框', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';

  test('@core TC-E2E-121: 普通文本框与搜索框里浮出圆点并能完成翻译；密码框、邮箱框不出现（#650）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);
    const dot = page.locator(DOT);

    // 放行的两种：圆点出现，点下去整段替换，焦点还在框里
    for (const id of ['#title', '#query']) {
      const box = page.locator(id);
      await box.click();
      await page.keyboard.type('你好世界');
      await expect(dot).toBeVisible();
      await dot.click();
      await expect(box).toHaveValue('【译】你好世界', { timeout: 10_000 });
      await expect(box).toBeFocused();
    }

    // 白名单以外的类型：打字也不出现
    for (const [id, text] of [['#secret', 'hunter22'], ['#mail', 'me@example.com']] as const) {
      await page.locator(id).click();
      await page.keyboard.type(text);
      await page.waitForTimeout(300);
      await expect(dot).toBeHidden();
    }

    // 多行文本框的行为不变
    await page.locator('#reply').click();
    await page.keyboard.type('你好');
    await expect(dot).toBeVisible();
  });

  test('@core TC-E2E-122: 单行文本框与搜索框里圆点的位置 —— 整颗在框里，不出框（#650，实地再看；#666 起贴文字末尾）', async ({
    page, seedSettings, gotoFixture,
  }, testInfo) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input');
    await waitForBall(page);
    const dot = page.locator(DOT);

    for (const id of ['#title', '#query']) {
      const box = page.locator(id);
      await box.click();
      await page.keyboard.type('hello world');
      await expect(dot).toBeVisible();
      const b = (await box.boundingBox())!;
      const d = (await dot.boundingBox())!;
      // 整颗圆点在框里（#666 起贴文字末尾，位置的真值见 TC-E2E-138）
      expect(d.x).toBeGreaterThanOrEqual(b.x);
      expect(d.x + d.width).toBeLessThanOrEqual(b.x + b.width);
      expect(d.y).toBeGreaterThanOrEqual(b.y);
      expect(d.y + d.height).toBeLessThanOrEqual(b.y + b.height);
      // 搜索框那一角常被站点自己的按钮占着，留截图供实地比对
      await testInfo.attach(`dot-in-${id.slice(1)}`, {
        body: await page.screenshot({
          clip: { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 },
        }),
        contentType: 'image/png',
      });
    }
  });
});

test.describe('输入翻译：对方语言的判定链', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';

  test('@core TC-E2E-126: 源语言是 auto 时，本页翻译过、引擎报告了检测语言 → 优先于页面的语言声明（#660）', async ({
    page, mockDeepl, seedSettings, gotoFixture,
  }) => {
    // 只用 DeepL：它在响应里报告检测语言（默认引擎 google-web 不报告）
    await seedSettings({ enginePriority: ['deepl'] });
    // DeepL 替身：译文带上目标语言，检测语言恒报日文（页面声明的是 en）。
    // #723：走夹具的描述符，扛得住 SW 重启
    await mockDeepl({ detectedSourceLanguage: 'JA' });
    // #723：先认替身的译文前缀，没经过替身时报错直接指向替身或种子设置，
    // 而不是“译文不符”
    const viaStub = /^\[DL:/;
    const stubLost = '没有经过 DeepL 替身：替身失效，或种子设置被改写';

    await gotoFixture('input');
    // 整页翻译一次，引擎报告检测语言 JA
    await translateAndWait(page);
    await expect(page.locator('.pt-trans').first(), `整页翻译${stubLost}`).toHaveText(viaStub);

    // 夹具声明 lang="en"，但检测语言优先：译成日文
    const box = page.locator('#reply');
    await box.click();
    await page.keyboard.type('你好世界');
    await page.locator(DOT).click();
    await expect(box, `输入翻译${stubLost}`).toHaveValue(viaStub, { timeout: 10_000 });
    await expect(box).toHaveValue('[DL:JA] 你好世界');
  });
});

test.describe('输入翻译：站点名单与总开关', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';

  /** 在 SW 里改设置（读-改-写 pt-settings），页面不刷新。 */
  async function patchStored(
    sw: import('@playwright/test').Worker,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await sw.evaluate(async (p) => {
      const r = await chrome.storage.sync.get('pt-settings');
      await chrome.storage.sync.set({ 'pt-settings': { ...(r['pt-settings'] as object), ...p } });
    }, patch);
  }

  /** 在输入框里打字，断言圆点没注册。 */
  async function expectNoDot(page: import('@playwright/test').Page) {
    await page.locator('#reply').click();
    await page.keyboard.type('你好世界');
    // 留出内容脚本响应 focusin / input 的时间
    await page.waitForTimeout(300);
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(0);
  }

  test('@core TC-E2E-119: 站点在黑名单里、或白名单模式下不在名单里时，输入框里不出现圆点；白名单命中照常出现（#649）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    // 名单的种子写法同 TC-E2E-108
    await seedSettings({ from: 'en', siteList: { mode: 'blacklist', list: ['localhost'] } });
    await gotoFixture('input');
    await waitForBall(page);
    await expectNoDot(page);

    await seedSettings({ from: 'en', siteList: { mode: 'whitelist', list: ['example.com'] } });
    await gotoFixture('input');
    await waitForBall(page);
    await expectNoDot(page);

    await seedSettings({ from: 'en', siteList: { mode: 'whitelist', list: ['localhost'] } });
    await gotoFixture('input');
    await waitForBall(page);
    await page.locator('#reply').click();
    await page.keyboard.type('你好世界');
    await expect(page.locator(DOT)).toBeVisible();
  });

  test('@core TC-E2E-120: 改名单、开关总开关都不必刷新页面 —— 拉黑即消失，移出即出现并能翻译；总开关关掉同样消失（#649）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en', siteList: { mode: 'blacklist', list: ['localhost'] } });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);
    await expectNoDot(page);

    // 把站点移出黑名单：焦点还在框里，圆点即刻出现，点下去照常翻译
    const box = page.locator('#reply');
    await patchStored(serviceWorker, { siteList: { mode: 'blacklist', list: [] } });
    await expect(page.locator(DOT)).toBeVisible();
    await page.locator(DOT).click();
    await expect(box).toHaveValue('【译】你好世界', { timeout: 10_000 });

    // 再拉黑：即刻消失
    await patchStored(serviceWorker, { siteList: { mode: 'blacklist', list: ['localhost'] } });
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(0);
    await patchStored(serviceWorker, { siteList: { mode: 'blacklist', list: [] } });
    await expect(page.locator(DOT)).toBeVisible();

    // 总开关关掉：即刻消失；打开：焦点还在框里就即刻出现
    await patchStored(serviceWorker, { enabled: false });
    await expect(page.locator('#pt-host-input-dot')).toHaveCount(0);
    await patchStored(serviceWorker, { enabled: true });
    await expect(page.locator(DOT)).toBeVisible();
  });
});

test.describe('输入翻译：送翻后内容变动不写回', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';
  const TOAST = '#pt-host-toast .pt-toast';

  test('@core TC-E2E-116: 译文回来前又打了字、或焦点换到另一个框 → 不覆盖框里内容，译文出现在提示条里（#646）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    // 译文晚 1.5 秒回来，留出继续打字的时间
    await mockGoogle({ delayMs: 1_500 });
    await gotoFixture('input');
    await waitForBall(page);

    const box = page.locator('#reply');
    const note = page.locator('#note');

    // 点圆点后接着打字：刚打的字不被吞掉，译文进提示条
    await box.click();
    await page.keyboard.type('你好世界');
    await page.locator(DOT).click();
    await page.keyboard.type('，再见');
    await expect(page.locator(`${TOAST}[data-kind="info"]`)).toHaveText('【译】你好世界', {
      timeout: 10_000,
    });
    await expect(box).toHaveValue('你好世界，再见');
    await expect(box).toBeFocused();

    // 点圆点后焦点换到另一个框：两个框都不动，译文进提示条
    await box.fill('');
    await page.keyboard.type('早上好');
    await page.locator(DOT).click();
    await note.click();
    await page.keyboard.type('另一段');
    await expect(page.locator(`${TOAST}[data-kind="info"]`)).toHaveText('【译】早上好', {
      timeout: 10_000,
    });
    await expect(box).toHaveValue('早上好');
    await expect(note).toHaveValue('另一段');
    await expect(note).toBeFocused();

    // 内容与焦点都没动：照常写回
    await box.click();
    await page.locator(DOT).click();
    await expect(box).toHaveValue('【译】早上好', { timeout: 10_000 });
  });
});

// ================================================================
// SVG 里嵌的 HTML（#629）
// ================================================================

test.describe('逐段翻译：SVG 图表标签', () => {
  test('@core TC-E2E-110: 鼠标停在 foreignObject 里的图表标签上不浮出按钮，同页普通段落照常浮出（#630）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('svg-chart');
    await waitForBall(page);

    const paraBtn = page.locator('.pt-para-btn');

    // 图表标签（div 与块级 p 两种形态）：停够悬停意图延迟也不浮出
    for (const id of ['#label', '#label2']) {
      await page.locator(id).hover();
      await page.waitForTimeout(600);
      await expect(paraBtn).toBeHidden();
    }

    // 同页的普通段落照常浮出
    await page.locator('#body').hover();
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ================================================================
// 站点名单门控逐段翻译按钮（#629）
// ================================================================

test.describe('逐段翻译：站点名单', () => {
  /** 停够悬停意图延迟后断言按钮没浮出。 */
  async function expectNoParaBtn(page: import('@playwright/test').Page) {
    await page.locator('p').first().hover();
    await page.waitForTimeout(600);
    await expect(page.locator('.pt-para-btn')).toBeHidden();
  }

  test('@core TC-E2E-108: 站点在黑名单里、或白名单模式下不在名单里时，悬停正文不浮出按钮；白名单命中照常浮出（#632）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    // 名单的种子写法同 security.spec.ts 的 SEC-04 / SEC-05 / SEC-06
    await seedSettings({ showParagraphBtn: true, siteList: { mode: 'blacklist', list: ['localhost'] } });
    await gotoFixture('basic');
    await waitForBall(page);
    await expectNoParaBtn(page);

    await seedSettings({ showParagraphBtn: true, siteList: { mode: 'whitelist', list: ['example.com'] } });
    await gotoFixture('basic');
    await waitForBall(page);
    await expectNoParaBtn(page);

    await seedSettings({ showParagraphBtn: true, siteList: { mode: 'whitelist', list: ['localhost'] } });
    await gotoFixture('basic');
    await waitForBall(page);
    await page.locator('p').first().hover();
    await expect(page.locator('.pt-para-btn')).toBeVisible({ timeout: 5_000 });
  });

  test('@core TC-E2E-109: 把站点从黑名单移除后，不刷新页面即可浮出按钮并翻译（#632）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true, siteList: { mode: 'blacklist', list: ['localhost'] } });
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    await expectNoParaBtn(page);

    // 在设置里把站点移出黑名单（读-改-写 pt-settings），页面不刷新
    await serviceWorker.evaluate(async () => {
      const r = await chrome.storage.sync.get('pt-settings');
      const cur = r['pt-settings'] as Record<string, unknown>;
      await chrome.storage.sync.set({
        'pt-settings': { ...cur, siteList: { mode: 'blacklist', list: [] } },
      });
    });

    // 指针先移开再回到段落，触发新的悬停
    await page.mouse.move(0, 0);
    const firstP = page.locator('p').first();
    await firstP.hover();
    const paraBtn = page.locator('.pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();
    await expect(firstP).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
  });

  test('@core TC-E2E-123: 扩展总开关关闭时悬停正文不注册按钮；不刷新页面打开总开关后照常浮出并能翻译（#686）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true, enabled: false });
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);

    // 总开关关着：停够悬停意图延迟，按钮的宿主根本不存在 —— 不是浮出来点了没反应
    await page.locator('p').first().hover();
    await page.waitForTimeout(600);
    await expect(page.locator('#pt-host-para-btn')).toHaveCount(0);

    // 在设置里打开总开关（读-改-写 pt-settings），页面不刷新
    await serviceWorker.evaluate(async () => {
      const r = await chrome.storage.sync.get('pt-settings');
      const cur = r['pt-settings'] as Record<string, unknown>;
      await chrome.storage.sync.set({ 'pt-settings': { ...cur, enabled: true } });
    });

    // 指针先移开再回到段落，触发新的悬停
    await page.mouse.move(0, 0);
    const firstP = page.locator('p').first();
    await firstP.hover();
    const paraBtn = page.locator('.pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();
    await expect(firstP).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
  });
});

// ================================================================
// 超长段落按 br 切行（#694）
// ================================================================

test.describe('超长段落按 br 切行', () => {
  /** 翻译前读正文的原文行：按 br 切开、去掉空行。 */
  async function readLines(post: import('@playwright/test').Locator): Promise<string[]> {
    return post.evaluate((el) =>
      el.innerHTML
        .split(/<br\s*\/?>/i)
        .map((h) => {
          const d = document.createElement('div');
          d.innerHTML = h;
          return (d.textContent ?? '').trim();
        })
        .filter(Boolean),
    );
  }

  test('@core TC-E2E-142: 以 br 分行的超长正文整页翻译后逐行出译文 —— 每行原文下面紧跟它自己的译文，不串行、不漏行（#707）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('br-post');
    const post = page.locator('#post');
    const lines = await readLines(post);
    expect(lines).toHaveLength(48);
    expect(lines.join('\n').length, '正文超过长度上限，修复前整段不翻').toBeGreaterThan(3072);

    await translateAndWait(page);

    // 每一行都出了译文，一行一个切块
    await expect(post.locator(':scope > .pt-chunk[data-pt="done"]')).toHaveCount(48, { timeout: 30_000 });

    // 行与行对应：第 i 个切块的原文是第 i 行，译文是这一行自己的译文
    const pairs = await post.evaluate((el) =>
      [...el.querySelectorAll(':scope > .pt-chunk')].map((c) => ({
        origin: (c.querySelector(':scope > .pt-origin')?.textContent ?? '').trim(),
        trans: (c.querySelector(':scope > .pt-trans')?.textContent ?? '').trim(),
      })),
    );
    expect(pairs.map((p) => p.origin)).toEqual(lines);
    expect(pairs.map((p) => p.trans)).toEqual(lines.map((l) => `【译】${l}`));

    // 排版：译文另起一行、紧跟在它那行原文下面；下一行原文紧跟在上一行译文下面，
    // 中间不多出空行
    const boxes = await post.evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const left = el.getBoundingClientRect().left;
      const rows = [...el.querySelectorAll(':scope > .pt-chunk')].map((c) => {
        const o = [...c.querySelector(':scope > .pt-origin')!.getClientRects()];
        const t = [...c.querySelector(':scope > .pt-trans')!.getClientRects()].filter((r) => r.width > 0);
        return {
          originTop: Math.min(...o.map((r) => r.top)),
          originBottom: Math.max(...o.map((r) => r.bottom)),
          transTop: Math.min(...t.map((r) => r.top)),
          transBottom: Math.max(...t.map((r) => r.bottom)),
          transLeft: Math.min(...t.map((r) => r.left)),
        };
      });
      return { lh, left, rows };
    });
    boxes.rows.forEach((r, i) => {
      expect(r.transTop, `第 ${i} 行：译文在原文下面`).toBeGreaterThanOrEqual(r.originBottom - 1);
      expect(r.transTop - r.originBottom, `第 ${i} 行：译文紧跟原文，中间没有空行`).toBeLessThan(boxes.lh / 2);
      expect(Math.abs(r.transLeft - boxes.left), `第 ${i} 行：译文另起一行，从行首开始`).toBeLessThanOrEqual(1);
      const next = boxes.rows[i + 1];
      if (next) {
        expect(next.originTop - r.transBottom, `第 ${i + 1} 行原文紧跟上一行译文，中间没有空行`).toBeLessThan(boxes.lh / 2);
      }
    });

    // 正文前后的普通段落照常整段翻译
    await expect(page.locator('#meta[data-pt="done"]')).toHaveCount(1);
    await expect(page.locator('#after[data-pt="done"]')).toHaveCount(1);
  });

  test('@core TC-E2E-143: 还原后超长正文的 HTML 与翻译前逐字节一致、行内节点还是原来那些；再翻一次结果与第一次相同（#708）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('br-post');
    const post = page.locator('#post');
    const ball = await waitForBall(page);

    // 翻译前：正文的 HTML，并给每个行内元素打上记号（还原后要还是同一批节点）
    const before = await post.evaluate((el) => {
      [...el.querySelectorAll('*')].forEach((n, i) => ((n as unknown as { __ptMark: number }).__ptMark = i));
      return el.outerHTML;
    });
    const inlineCount = await post.evaluate((el) => el.querySelectorAll('a, em').length);
    expect(inlineCount).toBeGreaterThan(0);

    /** 整页翻译一轮，读出每个切块的原文与译文。 */
    const translateRound = async () => {
      await ball.click();
      await expect(post.locator(':scope > .pt-chunk[data-pt="done"]')).toHaveCount(48, { timeout: 30_000 });
      await expect(ball).toHaveAttribute('data-state', 'done');
      return post.evaluate((el) =>
        [...el.querySelectorAll(':scope > .pt-chunk')].map((c) => [
          (c.querySelector(':scope > .pt-origin')?.textContent ?? '').trim(),
          (c.querySelector(':scope > .pt-trans')?.textContent ?? '').trim(),
        ]),
      );
    };
    /** 还原一轮，断言正文回到翻译前的样子。 */
    const restoreRound = async (what: string) => {
      await ball.click();
      await expect(page.locator('[data-pt="done"]')).toHaveCount(0, { timeout: 10_000 });
      await expect(ball).toHaveAttribute('data-state', 'idle');
      const after = await post.evaluate((el) => ({
        html: el.outerHTML,
        chunks: el.querySelectorAll('.pt-chunk, .pt-origin, .pt-trans').length,
        split: el.hasAttribute('data-pt-split'),
        // 记号按原顺序都还在：行内节点没有被换成新建的副本
        marks: [...el.querySelectorAll('*')].map((n) => (n as unknown as { __ptMark?: number }).__ptMark),
      }));
      expect(after.chunks, `${what}：切块与译文包装都移除`).toBe(0);
      expect(after.split, `${what}：切分标记移除`).toBe(false);
      expect(after.html, `${what}：HTML 与翻译前逐字节一致`).toBe(before);
      expect(after.marks, `${what}：行内节点与 br 还是原来那些`).toEqual(after.marks.map((_, i) => i));
    };

    const first = await translateRound();
    expect(first).toHaveLength(48);
    await restoreRound('第一次还原');

    // 再翻一次：切分与译文与第一次完全相同
    const second = await translateRound();
    expect(second).toEqual(first);
    await restoreRound('第二次还原');
  });
});

test.describe('标记密集的段落（#724）', () => {
  test('@core TC-E2E-144: 仿维基的正文段落（大量条目链接与引用角标）整页翻译后有译文；文字真正超长的段落仍然不翻（#731）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('markup-dense');
    const dense = page.locator('#dense');
    // 前提：文字远低于上限，序列化后的 HTML 远超旧的 HTML 上限（4096）
    const size = await dense.evaluate((el) => ({
      text: (el.textContent ?? '').trim().length,
      html: el.outerHTML.length,
    }));
    expect(size.text).toBeLessThan(3072);
    expect(size.html).toBeGreaterThan(4096);

    await translateAndWait(page);
    await expect(page.locator('#after')).toHaveAttribute('data-pt', 'done');
    await expect(dense).toHaveAttribute('data-pt', 'done');
    await expect(dense.locator('.pt-trans')).toHaveText(/^【译】In this period she worked with/);
    // 链接与引用角标都还在原文里
    await expect(dense.locator('.pt-origin a[rel="mw:WikiLink"]')).toHaveCount(26);
    await expect(dense.locator('.pt-origin sup.reference')).toHaveCount(8);

    await expect(page.locator('#long')).not.toHaveAttribute('data-pt', /./);
    await expect(page.locator('#long .pt-trans')).toHaveCount(0);
  });

  test('@core TC-E2E-145: 鼠标停在标记密集的段落上逐段翻译按钮浮出，点击只翻这一段；文字真正超长的段落上不浮出（#732）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('markup-dense');
    await waitForBall(page);
    const paraBtn = page.locator('.pt-para-btn');

    // 文字真正超长的段落：停够悬停意图延迟也不浮出
    await page.locator('#long').hover();
    await page.waitForTimeout(600);
    await expect(paraBtn).toBeHidden();

    // 标记密集的段落：停在一个条目链接上，按钮浮出
    const dense = page.locator('#dense');
    await dense.locator('a[rel="mw:WikiLink"]').nth(3).hover();
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();
    await expect(dense).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
    await expect(dense.locator('.pt-trans')).toHaveText(/^【译】In this period she worked with/);

    // 只翻这一段
    for (const id of ['#title', '#intro', '#long', '#after']) {
      await expect(page.locator(id)).not.toHaveAttribute('data-pt', /./);
    }
  });
});

test.describe('划词翻译的提示（#726）', () => {
  const TOAST = '#pt-host-toast .pt-toast';

  /** 按住修饰键在元素第一行上从左拖到右，松开即划词翻译（同 TC-E2E-70）。 */
  async function dragSelect(page: import('@playwright/test').Page, selector: string) {
    const box = (await page.locator(selector).boundingBox())!;
    const y = box.y + 8;
    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
  }

  /** 走右键菜单同一条消息发起划词翻译（同 TC-E2E-67），可以送任意长度的文字。 */
  async function translateSelectionText(sw: import('@playwright/test').Worker, text: string) {
    await sw.evaluate(async (t: string) => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:translate-selection', text: t });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    }, text);
  }

  /** 提示的实际尺寸、行高与视口宽度。等弹出动画（pt-pop 从 0.8 倍缩放起）放完再量。 */
  async function measureToast(page: import('@playwright/test').Page) {
    return page.evaluate(async () => {
      const el = document.getElementById('pt-host-toast')!.shadowRoot!.querySelector('.pt-toast')!;
      await Promise.all(el.getAnimations().map((a) => a.finished));
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return {
        left: r.left, right: r.right, width: r.width, height: r.height,
        lines: Math.round((r.height - padY) / lineHeight),
        viewport: document.documentElement.clientWidth,
      };
    });
  }

  test('@core TC-E2E-146: 划词译文过了三秒仍在 —— 内容类按长度停留，不再与状态提示一样三秒就走（#739）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);

    await dragSelect(page, 'p:nth-of-type(2)');
    const toast = page.locator(TOAST);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    const text = await toast.textContent();

    // 改动前固定 3 秒就消失；现在一句话的译文停留得更久
    await page.waitForTimeout(3_500);
    await expect(toast).toHaveText(text!);
    await expect(toast).toHaveCount(1);
  });

  test('@core TC-E2E-147: 划词翻译点下去立即出现“翻译中”并转圈，引擎慢也不自己消失；页面与选区里不多出任何文字（#746）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    // 引擎比状态提示的 3 秒还慢
    await mockGoogle({ delayMs: 5_000 });
    const translating = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastTranslating'));
    await gotoFixture('basic');
    await waitForBall(page);
    const bodyBefore = await page.evaluate(() => document.body.innerText);

    await dragSelect(page, 'p:nth-of-type(2)');
    const toast = page.locator(TOAST);
    await expect(toast).toHaveText(translating, { timeout: 2_000 });
    await expect(toast.locator('.pt-toast-spinner')).toBeVisible();

    // 等待态的文字在隔离的提示里，不进页面正文，也不混进用户的选区
    expect(await page.evaluate(() => document.body.innerText)).toBe(bodyBefore);
    expect(await page.evaluate(() => getSelection()!.toString())).not.toContain(translating);

    // 过了状态提示的 3 秒仍在等
    await page.waitForTimeout(3_500);
    await expect(toast).toHaveText(translating);

    // 译文到达后它不再挂着
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    await expect(toast.locator('.pt-toast-spinner')).toHaveCount(0);
  });

  test('@core TC-E2E-148: 划词翻译先出现“翻译中”，随后它就地变成译文 —— 整个过程页面上只有一条提示，始终是同一条（#747）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ delayMs: 1_500 });
    const translating = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastTranslating'));
    await gotoFixture('basic');
    await waitForBall(page);

    // 每 10ms 采样一次提示：条数、是不是最先出现的那一条、有没有转圈、文字；
    // 只记变化，得到一条按时间排列的序列
    await page.evaluate(() => {
      const w = window as unknown as { __ptSeq: string[] };
      w.__ptSeq = [];
      let first: Element | null = null;
      setInterval(() => {
        const root = document.getElementById('pt-host-toast')?.shadowRoot;
        const els = root ? Array.from(root.querySelectorAll('.pt-toast')) : [];
        const el = els[0];
        if (el && !first) first = el;
        const entry = [
          els.length,
          el ? (el === first ? 'same' : 'other') : '-',
          el?.querySelector('.pt-toast-spinner') ? 'spin' : '',
          el?.textContent ?? '',
        ].join('|');
        if (w.__ptSeq[w.__ptSeq.length - 1] !== entry) w.__ptSeq.push(entry);
      }, 10);
    });

    await dragSelect(page, 'p:nth-of-type(2)');
    const toast = page.locator(TOAST);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });

    const seq = (await page.evaluate(() => (window as unknown as { __ptSeq: string[] }).__ptSeq))
      .map((e) => e.split('|'))
      .filter(([count]) => count !== '0');
    // 同一时刻至多一条，而且自始至终是同一条提示
    expect(seq.every(([count, which]) => count === '1' && which === 'same')).toBe(true);
    // 先是“翻译中”带转圈，随后变成译文、转圈没了
    expect(seq[0]).toEqual(['1', 'same', 'spin', translating]);
    const last = seq[seq.length - 1]!;
    expect(last[2]).toBe('');
    expect(last[3]).toContain('【译】Another paragraph');
    // 中间没有别的状态：只有等待态与译文两种
    expect(seq.every(([, , spin, text]) => (spin === 'spin' && text === translating) || text === last[3])).toBe(true);
  });

  test('@core TC-E2E-149: 长译文在宽度上限内换行，不横着铺满屏幕底部；窄窗口下也不溢出视口；状态提示仍是原来的单行（#744）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    const long = 'The quick brown fox jumps over the lazy dog while the translation keeps going. '.repeat(6);
    const toast = page.locator(TOAST);

    await translateSelectionText(serviceWorker, long);
    await expect(toast).toContainText('【译】The quick brown fox', { timeout: 20_000 });
    const wide = await measureToast(page);
    // 不横着铺开：宽度不到视口的一半，文字折成多行
    expect(wide.width).toBeLessThan(wide.viewport / 2);
    expect(wide.lines).toBeGreaterThan(2);
    expect(wide.left).toBeGreaterThanOrEqual(0);
    expect(wide.right).toBeLessThanOrEqual(wide.viewport);

    // 窄窗口：左右都不出视口
    await page.setViewportSize({ width: 320, height: 640 });
    await translateSelectionText(serviceWorker, long);
    await expect(toast).toContainText('【译】The quick brown fox', { timeout: 20_000 });
    const narrow = await measureToast(page);
    expect(narrow.left).toBeGreaterThanOrEqual(0);
    expect(narrow.right).toBeLessThanOrEqual(narrow.viewport);

    // 状态类不受影响：失败提示仍是一行，宽度跟着文字走，不套宽度上限
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockGoogle({ fail: true });
    await translateSelectionText(serviceWorker, 'Hello world');
    const failText = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastTranslateFail'));
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(failText, { timeout: 20_000 });
    const status = await measureToast(page);
    expect(status.lines).toBe(1);
    expect(
      await toast.evaluate((el) => getComputedStyle(el).maxWidth),
    ).toBe('none');
  });

  test('@core TC-E2E-150: 内容类提示点关闭立即消失，不必等它自己走；状态提示没有关闭按钮（#742）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    const toast = page.locator(TOAST);
    const closeLabel = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastClose'));

    await dragSelect(page, 'p:nth-of-type(2)');
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    const close = toast.getByRole('button', { name: closeLabel });
    await expect(close).toBeVisible();
    // 内容类最短也要停 5 秒；点了之后 1 秒内就没了
    await close.click();
    await expect(toast).toHaveCount(0, { timeout: 1_000 });

    // 状态类不受影响：失败提示没有关闭按钮
    await mockGoogle({ fail: true });
    await dragSelect(page, 'p:nth-of-type(1)');
    const failText = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastTranslateFail'));
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(failText, { timeout: 20_000 });
    await expect(toast.getByRole('button')).toHaveCount(0);
  });

  test('@core TC-E2E-151: 鼠标停在译文上它就不走，移开后重新停满一整轮再走（#740/#741）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    test.setTimeout(60_000);
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    const toast = page.locator(TOAST);

    // 一句话的译文，按内容类的下限停留（短于 6 秒）
    await translateSelectionText(serviceWorker, 'Hello world');
    await expect(toast).toContainText('【译】Hello world', { timeout: 20_000 });
    await toast.hover();
    // 悬停期间过了它本应消失的时刻仍在
    await page.waitForTimeout(6_500);
    await expect(toast).toBeVisible();

    // 移开：重新开始完整计时，不是接着剩余时间立刻消失
    await page.mouse.move(5, 5);
    await page.waitForTimeout(3_000);
    await expect(toast).toBeVisible();
    // 一整轮过完自己走
    await expect(toast).toHaveCount(0, { timeout: 10_000 });

    // 状态类不受影响：悬停在失败提示上，它照样按时消失
    await mockGoogle({ fail: true });
    await translateSelectionText(serviceWorker, 'Hello world');
    const fail = page.locator(`${TOAST}[data-kind="error"]`);
    await expect(fail).toBeVisible({ timeout: 20_000 });
    await fail.hover();
    await expect(fail).toHaveCount(0, { timeout: 5_000 });
  });

  test('@core TC-E2E-152: 特别长的译文有高度上限，在提示内部纵向滚动，关闭按钮不随之滚走；没超过上限时没有滚动条；状态提示不变（#745）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    const toast = page.locator(TOAST);
    const body = toast.locator('.pt-toast-body');
    const box = () => body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    }));

    // 特别长的译文：提示不从屏幕下方长到上方
    const long = 'The quick brown fox jumps over the lazy dog while the translation keeps going. '.repeat(40);
    await translateSelectionText(serviceWorker, long);
    await expect(toast).toContainText('【译】The quick brown fox', { timeout: 20_000 });
    // 等弹出动画（pt-pop 从 0.8 倍缩放起）放完再量，否则量到的是缩放中的尺寸
    await toast.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const size = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, viewport: document.documentElement.clientHeight };
    });
    expect(size.top).toBeGreaterThanOrEqual(0);
    expect(size.height).toBeLessThan(size.viewport * 0.6);
    const before = await box();
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    // 鼠标在提示上滚轮：内部滚动，关闭按钮仍在原处、看得见
    const closeLabel = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastClose'));
    const close = toast.getByRole('button', { name: closeLabel });
    const closeBefore = (await close.boundingBox())!;
    await body.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await box()).scrollTop).toBeGreaterThan(0);
    await expect(close).toBeVisible();
    expect((await close.boundingBox())!.y).toBeCloseTo(closeBefore.y, 0);
    await expect(toast).toBeVisible();

    // 没超过上限：没有滚动条
    await page.mouse.move(5, 5);
    await translateSelectionText(serviceWorker, 'Hello world');
    await expect(toast).toContainText('【译】Hello world', { timeout: 20_000 });
    const short = await box();
    expect(short.scrollHeight).toBeLessThanOrEqual(short.clientHeight);

    // 状态类不受影响：没有内层、没有高度上限
    await mockGoogle({ fail: true });
    await translateSelectionText(serviceWorker, 'Hello world');
    const fail = page.locator(`${TOAST}[data-kind="error"]`);
    await expect(fail).toBeVisible({ timeout: 20_000 });
    await expect(fail.locator('.pt-toast-body')).toHaveCount(0);
    expect(await fail.evaluate((el) => getComputedStyle(el).maxHeight)).toBe('none');
  });
});


test.describe('页面级闸门（#777）', () => {
  const TOAST = '#pt-host-toast .pt-toast';

  test('@core TC-E2E-153: 本来就是目标语言的页面上点整页翻译 —— 零请求、页面逐字节不变、弹出说明、悬浮球是未翻译态；同页划词照常能翻（#795）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 夹具声明 lang="zh-CN"，目标语言 zh-CN
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle();
    await gotoFixture('same-language');
    const ball = await waitForBall(page);
    await expect(ball).toHaveAttribute('data-state', 'idle');

    const content = () => page.locator('#content').evaluate((el) => el.outerHTML);
    const before = await content();
    // 计数记在替身层，读之前先认 SW 存活标记：实例中途被换就以“不可信”报错（#766）
    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));

    await ball.click();

    // 说明已经是目标语言：状态类，同一时刻只有这一条
    const toast = page.locator(TOAST);
    await expect(toast).toHaveText(message, { timeout: 10_000 });
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute('data-purpose', 'status');
    // 悬浮球是未翻译态，不是完成态
    await expect(ball).toHaveAttribute('data-state', 'idle');
    // 页面逐字节不变：没有译文、没有已翻译标记，超长段落也没被切成切块
    expect(await content()).toBe(before);
    await expect(page.locator('[data-pt], .pt-chunk, [data-pt-split]')).toHaveCount(0);
    // 一个翻译请求都没发
    expect((await requests()).google).toBe(0);

    // 再点一次：页面上没有译文可还原，仍是同一条说明，页面仍逐字节不变，仍零请求
    await ball.click();
    await expect(toast).toHaveText(message, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await content()).toBe(before);
    expect((await requests()).google).toBe(0);

    // 同一页面上划中那段英文引文：闸门只管整页，划词照常送翻（#794）。
    // 计数随之变成 1，也证明上面的“零”不是计数器失灵
    const quote = (await page.locator('#quote').textContent())!.trim();
    await serviceWorker.evaluate(async (t: string) => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:translate-selection', text: t });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    }, quote);
    await expect(page.locator(`${TOAST}[data-purpose="content"]`)).toContainText(`【译】${quote}`, {
      timeout: 20_000,
    });
    expect((await requests()).google).toBe(1);
    expect(await content()).toBe(before);
  });

  test('@core TC-E2E-154: 中英混排的页面 —— 外文段落照常出译文，中文段落不插译文也不标记，被拦下的段数进汇总，还原后整页逐字节回到原样（#796）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 夹具不写语言声明，闸门放行（#789）；引擎把中文段落原样还回来，外文加前缀
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle({ keepCjk: true });
    await gotoFixture('mixed-language');
    const ball = await waitForBall(page);

    const content = () => page.locator('#content').evaluate((el) => el.outerHTML);
    const before = await content();
    const zhBefore = await page.locator('#content .zh, #title').evaluateAll((els) =>
      els.map((el) => el.outerHTML),
    );

    await ball.click();

    // 外文段落照常出现译文
    for (const id of ['#en1', '#en2', '#en3']) {
      const el = page.locator(id);
      await expect(el).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      const source = await el.locator('.pt-origin').textContent();
      await expect(el.locator('.pt-trans')).toHaveText(`【译】${source!.trim()}`);
    }
    await expect(ball).toHaveAttribute('data-state', 'done');
    // 中文段落不插译文、不被标记为已翻译，一个字不动
    expect(
      await page.locator('#content .zh, #title').evaluateAll((els) => els.map((el) => el.outerHTML)),
    ).toEqual(zhBefore);
    await expect(page.locator('#content .zh .pt-trans, #title .pt-trans')).toHaveCount(0);
    // 被拦下的段数出现在汇总提示里（#785）：标题、两段中文、标签区共 4 个单元
    const summary = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastSameAsSource', ['4']));
    const toast = page.locator('#pt-host-toast .pt-toast');
    await expect(toast).toHaveText(summary, { timeout: 10_000 });
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute('data-purpose', 'status');

    // 还原：整页逐字节回到原样
    await ball.click();
    await expect(page.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await content()).toBe(before);
  });
});
