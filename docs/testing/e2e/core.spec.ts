/**
 * E2E 核心套件 —— 每次 push 必跑
 *
 * 覆盖：入口（悬浮球/快捷键/段落按钮）× 模式（对照/仅译文）×
 *       DOM 特征 fixture（shadow/nested/spa/preserve/pre-blocks 等）
 *
 * 翻译端点由 mockGoogle 拦截，完全确定性，不依赖外网。
 */
import fs from 'fs';
import {
  test,
  expect,
  waitForBall,
  fixtureUrl,
  expectNoToastFor,
  type MockRequests,
} from './fixtures';
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

    // 等所有在飞批次结算，确认无“所有引擎均失败”错误 toast（持续采样：提示
    // 3 秒后自己消失，会重试的 toHaveCount(0) 等得到 0，#832）
    await waitDrained(page, served);
    await expectNoToastFor(errorToast, '还原后不弹“所有引擎均失败”');

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
    await expectNoToastFor(errorToast, '增量补翻在飞时还原，不误报“所有引擎均失败”');

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
  test('@core TC-E2E-30: about:blank 写出的 iframe 注入内容脚本 —— 悬浮球只翻主文档，iframe 里的段落不动；popup 整页翻译广播到全部 frame，iframe 段落跟着翻译、跟着还原（#838）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('iframe');
    const frame = page.frameLocator('#frame1');
    const inner = frame.locator('#inner');
    // 页面在 iframe 加载之后用 document.write 写出文档；内容脚本注入了（#838 之前没有）
    await expect(inner).toBeVisible({ timeout: 10_000 });
    await expect(frame.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    const innerBefore = await inner.evaluate((el) => el.outerHTML);

    // 悬浮球只翻主文档（与有网址的 iframe 相同）：主文档出译文，iframe 里的段落一个字不动
    await translateAndWait(page);
    const ball = await waitForBall(page);
    await expect(ball).toHaveAttribute('data-state', 'done');
    expect(await inner.evaluate((el) => el.outerHTML)).toBe(innerBefore);
    await ball.click();
    await expect(page.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });

    // popup 的整页翻译：不带 frameId 广播到全部 frame，iframe 里的段落同样出译文
    const toggleAll = () =>
      serviceWorker.evaluate(async () => {
        for (const tab of await chrome.tabs.query({})) {
          try {
            const r = await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
            if (r) return (r as { status?: string }).status;
          } catch {
            // 没有 content script 的标签页
          }
        }
        return null;
      });
    expect(await toggleAll()).toBe('translated');
    await expect(inner).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    const source = (await inner.locator('.pt-origin').textContent())!.trim();
    await expect(inner.locator('.pt-trans')).toHaveText(`【译】${source}`);
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible();

    // 再点一次还原：iframe 里的段落逐字节回到原样
    expect(await toggleAll()).toBe('restored');
    await expect(frame.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    expect(await inner.evaluate((el) => el.outerHTML)).toBe(innerBefore);
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
    // 不弹“已保存”：设置页的提示 2 秒后自己隐藏，持续采样（#832）
    await expectNoToastFor(page.locator('#pt-toast'), '无效选择器不弹保存提示');
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

  test('@core TC-E2E-137: 圆点与光标并排不重叠 —— 与末尾字符之间留 4px 间隙；窄框里末尾顶到右内边缘时圆点也不压住光标（#667；#638 起可点区 24px，扩出的一圈不盖文字末尾、不出框）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    /**
     * 圆点的可点区（#638）：逐像素问圆点所在的 shadow root 这一点落在谁身上，
     * 落在圆点上的点围成的范围。可见圆点仍是 14px，扩出的一圈是透明的。
     */
    const hitArea = () =>
      page.evaluate(() => {
        const root = document.getElementById('pt-host-input-dot')!.shadowRoot!;
        const el = root.querySelector('.pt-input-dot')!;
        const r = el.getBoundingClientRect();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let x = Math.floor(r.left) - 16; x <= Math.ceil(r.right) + 16; x++) {
          for (let y = Math.floor(r.top) - 16; y <= Math.ceil(r.bottom) + 16; y++) {
            if (root.elementFromPoint(x + 0.5, y + 0.5) !== el) continue;
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
        return { left, right, top, bottom, width: right - left, height: bottom - top };
      });
    /** 这一点上用户点下去落在谁身上：输入框自己，还是圆点所在的宿主。 */
    const hitId = (x: number, y: number) =>
      page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? null, [x, y] as const);

    /**
     * 第一行文字 text 的末尾（光标所在）、这一行的上下沿，以及光标本身的上下沿；
     * 字宽按同一字体量。光标只有文字的行内盒那么高，不是整个行高 —— 行高 1.4
     * 时上下各有约 2px 的行距在光标之外，在真实浏览器里按像素量过。
     */
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
        // 文字的行内盒在这一行里的位置：用同样的字体与行高排一行，量里面那段文字。
        // 行距怎么分到上下由浏览器按取整后的字体度量定，不能按 (行高 - 字高) / 2 算
        const glyph = (() => {
          const line = document.createElement('div');
          line.style.font = cs.font;
          line.style.lineHeight = cs.lineHeight;
          line.style.whiteSpace = 'pre';
          const sp = document.createElement('span');
          sp.textContent = t;
          line.append(sp);
          el.parentElement!.append(line);
          const l = line.getBoundingClientRect();
          const g = sp.getBoundingClientRect();
          line.remove();
          return { offset: g.top - l.top, height: g.height };
        })();
        const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
        const caretTop = top + glyph.offset;
        return {
          x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + width(t),
          top,
          bottom: top + parseFloat(cs.lineHeight),
          caretTop,
          caretBottom: caretTop + glyph.height,
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

    // #638：可见圆点仍是 14px，可点区不小于 24×24
    const d0 = (await dot.boundingBox())!;
    expect(d0.width).toBe(14);
    expect(d0.height).toBe(14);
    const h = await hitArea();
    expect(h.width, `可点区 ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(24);
    expect(h.height, `可点区 ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(24);
    // 扩出的一圈不伸向文字末尾：末尾字符与光标照常点得进输入框
    expect(h.left, '可点区没有盖住末尾字符').toBeGreaterThanOrEqual(e.x);
    expect(await hitId(e.x - 2, (e.top + e.bottom) / 2)).toBe('reply');
    // 也不出框：滚动条、边框、拖拽手柄仍是输入框自己的
    expect(h.right).toBeLessThanOrEqual(e.boxRight + 0.5);
    expect(h.bottom).toBeLessThanOrEqual(e.boxBottom + 0.5);

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
    // 打字时圆点先落在回落位置，停手 140ms 后才对齐到末尾（#670）。等位置不再变了
    // 再量 —— 否则量到的是回落位置，不是贴着末尾的那个位置
    await expect(async () => {
      const a = (await dot.boundingBox())!;
      await page.waitForTimeout(250);
      const z = (await dot.boundingBox())!;
      expect([z.x, z.y]).toEqual([a.x, a.y]);
    }).toPass({ timeout: 5_000 });
    await expect(async () => {
      const d = (await dot.boundingBox())!;
      // 光标是末尾处、字体那么高的一条竖线：圆点要么整个在光标上下沿之外，要么横向离开光标至少 3px
      const clearOfCaret =
        d.y >= n.caretBottom - 0.5 ||
        d.y + d.height <= n.caretTop + 0.5 ||
        d.x >= n.x + 3 ||
        d.x + d.width <= n.x - 3;
      expect(clearOfCaret, `圆点 ${JSON.stringify(d)} 压住了光标 x=${n.x} 上下沿 ${n.caretTop}–${n.caretBottom}`).toBe(true);
      // 仍在框的可见区域里（#669）
      expect(d.x + d.width).toBeLessThanOrEqual(n.boxRight + 0.5);
      expect(d.y + d.height).toBeLessThanOrEqual(n.boxBottom + 0.5);
    }).toPass({ timeout: 5_000 });
    await expect(dot).toBeVisible();

    // #638：换了位置，扩出的一圈同样不压住光标、不出框
    const hn = await hitArea();
    const dn = (await dot.boundingBox())!;
    expect(hn.width).toBeGreaterThanOrEqual(24);
    expect(hn.height).toBeGreaterThanOrEqual(24);
    // 这里圆点换到了末尾那一行的下方：扩出的一圈不往上伸，上沿就是圆点的上沿。
    // 浏览器按整像素判定点中的是谁，圆点自己的上沿也按整像素算
    expect(dn.y, '窄框里圆点在光标下方').toBeGreaterThanOrEqual(n.caretBottom - 0.5);
    expect(hn.top, `可点区 ${JSON.stringify(hn)} 往光标那一侧伸了`).toBeGreaterThanOrEqual(Math.floor(dn.y));
    expect(hn.right).toBeLessThanOrEqual(n.boxRight + 0.5);
    expect(hn.bottom).toBeLessThanOrEqual(n.boxBottom + 0.5);

    // 点在扩出的那一圈上（可见圆点之外）照常翻译
    const ringX = hn.left + 1 < dn.x ? hn.left + 1 : hn.right - 1;
    const ringY = hn.top + 1 < dn.y ? hn.top + 1 : hn.bottom - 1;
    expect(ringX < dn.x || ringX > dn.x + dn.width || ringY < dn.y || ringY > dn.y + dn.height).toBe(true);
    await page.mouse.click(ringX, ringY);
    await expect(box).toHaveValue(`【译】${text}`, { timeout: 10_000 });
    await expect(box).toBeFocused();
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

  test('@core TC-E2E-112: 点圆点 → 译成源语言，术语照常生效（#639；#644 起译文写回输入框；#642 起不进翻译缓存）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // ADR-0005：目标语言取源语言。当前领域按目标语言解析，所以领域是 en 方向的
    // #642：打开翻译缓存，确认输入翻译这条调用链真的不写它
    await seedSettings({ from: 'en', to: 'zh-CN', useCache: true });
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
    const cacheEntries = () =>
      serviceWorker.evaluate(async () =>
        Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('pt-c:')).length,
      );
    const entriesBefore = await cacheEntries();

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
    await expectNoToastFor(page.locator(TOAST), '写回之后不再弹提示条');
    await expect(box).toBeFocused();
    // #642：译文不进翻译缓存
    expect(await cacheEntries()).toBe(entriesBefore);
  });

  test('@core TC-E2E-158: 翻译失败时弹出与另三条入口同一口径的提示，输入框里的文字一个字不变，焦点还在、圆点回到可点；引擎恢复后再点照常替换（#641）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle({ fail: true });
    const requests = await mockRequests();
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator(DOT);

    // 换行、前导与末尾空格、全角标点都要原样留着
    const original = '第一行，原文。\n  第二行带前导空格与末尾空格  ';
    await box.click();
    await page.keyboard.type(original);
    await expect(box).toHaveValue(original);
    // 光标停在中间，确认失败之后它也没被挪动
    await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 3));

    await dot.click();
    // 瞬时故障展示泛化文案，不带引擎原因（#313）；文案在运行时取，不写死
    const failText = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastTranslateFail'));
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(failText, { timeout: 10_000 });
    await expect(page.locator(TOAST)).toHaveCount(1);
    // 框里一个字不变，光标位置也不变，焦点还在框里
    await expect(box).toHaveValue(original);
    expect(await box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([3, 3]);
    await expect(box).toBeFocused();
    // 只发了一次请求，失败不自动重试
    expect((await requests()).google).toBe(1);
    // 圆点回到常态，还能再点（#647、#648）
    await expect(dot).toBeVisible();
    await expect(dot).not.toHaveAttribute('data-state', 'busy');

    // 引擎恢复之后再点一次：照常整段替换 —— 失败没有留下卡住的状态
    await mockGoogle();
    await dot.click();
    await expect(box).toHaveValue(`【译】${original}`, { timeout: 10_000 });
    expect((await requests()).google).toBe(2);
  });

  test('@core TC-E2E-159: 点圆点不夺走输入框的焦点，也不动光标与选区 —— 多行、单行文本框与带工具条的富文本编辑器；工具条不收起（#637）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    // 译文晚一点回来：点下去之后、写回之前的那段时间里看焦点与选区
    await mockGoogle({ delayMs: 1_500 });
    const dot = page.locator(DOT);

    /** 文本框的选区：起点、终点与方向。 */
    const fieldSelection = (id: string) =>
      page.locator(id).evaluate((el: HTMLTextAreaElement | HTMLInputElement) => [
        el.selectionStart,
        el.selectionEnd,
        el.selectionDirection,
      ]);

    await gotoFixture('input');
    await waitForBall(page);
    for (const [id, text] of [['#reply', '第一行\n第二行 hello world'], ['#title', 'hello world 你好']] as const) {
      const box = page.locator(id);
      await box.click();
      await page.keyboard.type(text);
      // 反向选中中间几个字：方向也要原样留着
      await box.evaluate((el: HTMLTextAreaElement | HTMLInputElement) => el.setSelectionRange(2, 7, 'backward'));
      const before = await fieldSelection(id);
      await expect(dot).toBeVisible();
      await dot.click();

      // 焦点：点完之后仍在这个框上
      await expect(box, `${id} 点圆点之后失去了焦点`).toBeFocused();
      // 光标与选区：与点之前逐项相同
      expect(await fieldSelection(id), `${id} 点圆点之后选区变了`).toEqual(before);
      // 这时译文还没回来：圆点在转圈，框里还是原文
      await expect(dot).toHaveAttribute('data-state', 'busy');
      await expect(box).toHaveValue(text);

      await expect(box).toHaveValue(`【译】${text}`, { timeout: 10_000 });
    }

    // 富文本编辑器：编辑区失焦就收起工具条
    await gotoFixture('rich-input');
    await waitForBall(page);
    const compose = page.locator('#compose');
    const toolbar = page.locator('#toolbar');
    await compose.click();
    await expect(toolbar).toBeVisible();
    await page.keyboard.type('hello brave world');
    // 选中中间的 brave：光标先退到它后面（越过“ world”6 个字符），再往回选 5 个
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
    const editorSelection = () =>
      page.evaluate(() => {
        const s = getSelection()!;
        return {
          text: s.toString(),
          anchor: [s.anchorNode?.nodeName, s.anchorOffset],
          focus: [s.focusNode?.nodeName, s.focusOffset],
        };
      });
    const before = await editorSelection();
    expect(before.text).toBe('brave');

    await expect(dot).toBeVisible();
    await dot.click();

    // 工具条还开着，编辑区一次失焦都没有发生，焦点仍在编辑区上
    await expect(toolbar, '点圆点之后工具条收起了').toBeVisible();
    expect(await page.evaluate(() => (window as any).__composerBlurs), '点圆点时编辑区失焦过').toBe(0);
    await expect(compose, '点圆点之后编辑区失去了焦点').toBeFocused();
    // 光标与选区：与点之前逐项相同
    expect(await editorSelection(), '点圆点之后编辑区里的选区变了').toEqual(before);
    await expect(dot).toHaveAttribute('data-state', 'busy');

    await expect(compose).toHaveText('【译】hello brave world', { timeout: 10_000 });
    await expect(toolbar).toBeVisible();
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

  test('@core TC-E2E-157: 密码框静默不响应 —— 键入、点击、全选、按逐段翻译快捷键之后都不出圆点、不发请求、不弹任何提示；同一页的普通文本框照常（#651）', async ({
    page, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await mockGoogle();
    const requests = await mockRequests();
    await gotoFixture('input');
    await waitForBall(page);
    const dot = page.locator(DOT);
    const toasts = page.locator('#pt-host-toast .pt-toast');

    const secret = page.locator('#secret');
    await secret.click();
    await page.keyboard.type('hunter22 我的密码');
    // 停手对齐（140ms）与提示的出现都早已过去
    await page.waitForTimeout(500);
    await expect(dot).toBeHidden();

    // 再点一次、双击、全选、按逐段翻译快捷键，都不该有任何反应
    await secret.click();
    await secret.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Shift+d');
    // 圆点若在，就在框的右侧；在那儿点一下也不该触发什么
    const b = (await secret.boundingBox())!;
    await page.mouse.click(b.x + b.width - 12, b.y + b.height / 2);
    await page.waitForTimeout(500);

    await expect(dot).toBeHidden();
    expect((await requests()).google, '密码框不发任何翻译请求').toBe(0);
    await expectNoToastFor(toasts, '密码框不弹任何提示');
    await expect(secret).toHaveValue('hunter22 我的密码');

    // 对照：同一页的普通文本框照常浮出圆点、点下去发一次请求 —— 上面的“没有”不是因为功能没起来
    const title = page.locator('#title');
    await title.click();
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();
    await dot.click();
    await expect(title).toHaveValue('【译】你好世界', { timeout: 10_000 });
    expect((await requests()).google).toBe(1);
  });

  test('@core TC-E2E-160: 登录页按“显示密码”把密码框切成明文之后，键入与点击都不出圆点、不发请求、不弹任何提示；同一页的普通文本框照常（#826）', async ({
    page, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    // 前半段让引擎失败：圆点一旦被触发就会发出请求并弹出失败提示，下面
    // “不发请求”“不弹提示”两条断言因此都抓得住，不只靠“不出圆点”那一条
    await mockGoogle({ fail: true });
    const requests = await mockRequests();
    await gotoFixture('input');
    await waitForBall(page);
    const dot = page.locator(DOT);
    const toasts = page.locator('#pt-host-toast .pt-toast');
    const pass = page.locator('#login-pass');

    await pass.click();
    await page.keyboard.type('hunter22 我的密码');

    // 点眼睛按钮：同一个框切成明文，焦点跟着到了按钮上
    await page.locator('#show-pass').click();
    await expect(pass, '“显示密码”确实把框切成了明文').toHaveAttribute('type', 'text');

    // 回到框里接着打字、点击、全选、按逐段翻译快捷键，都不该有任何反应
    await pass.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 再加几个字');
    await pass.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Shift+d');
    // 圆点若在，就贴在文字末尾或框的右侧；在那儿点一下也不该触发什么
    const b = (await pass.boundingBox())!;
    await page.mouse.click(b.x + b.width - 12, b.y + b.height / 2);
    await page.waitForTimeout(500);
    await expect.soft(dot, '点眼睛按钮切成明文之后不出圆点').toBeHidden();

    // 另一种眼睛按钮：按下时不夺焦点，焦点一直在框里时切换 type。先切回密码再切成明文
    await page.locator('#show-pass').click();
    await expect(pass).toHaveAttribute('type', 'password');
    await pass.click();
    await page.keyboard.press('End');
    await page.evaluate(() => document.getElementById('show-pass')!.click());
    await expect(pass).toHaveAttribute('type', 'text');
    await expect(pass).toBeFocused();
    await page.keyboard.type('!!');
    // 停手对齐（140ms）早已过去；圆点若浮出，就像用户那样点它一下
    await page.waitForTimeout(500);
    const leaked = await dot.isVisible();
    if (leaked) {
      await dot.click();
      // 等这次翻译走完（失败），失败提示该出就已经出了
      await expect(dot).not.toHaveAttribute('data-state', 'busy', { timeout: 10_000 });
    }
    await page.waitForTimeout(500);

    // 三条各自断言，任何一条漏了都单独报出来
    expect.soft(leaked, '切成明文的密码框不出圆点').toBe(false);
    expect.soft((await requests()).google, '切成明文的密码框不发任何翻译请求').toBe(0);
    // 取当下的条数，不用会重试的 toHaveCount(0)：状态提示 3 秒后自己消失，重试等得到 0
    expect.soft(await toasts.count(), '切成明文的密码框不弹任何提示').toBe(0);
    await expect(pass).toHaveValue('hunter22 我的密码 再加几个字!!');

    // 对照：引擎恢复，同一页的普通文本框照常浮出圆点、点下去发一次请求 —— 上面的“没有”不是因为功能没起来
    await mockGoogle();
    const title = page.locator('#title');
    await title.click();
    await page.keyboard.type('你好世界');
    await expect(dot).toBeVisible();
    await dot.click();
    await expect(title).toHaveValue('【译】你好世界', { timeout: 10_000 });
    expect((await requests()).google).toBe(1);
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

  test('@core TC-E2E-161: popup 里临时选这一次的对方语言 → 主文档、已有的 iframe、之后才加载的 iframe 都按它翻译；选回“跟随设置”回到自动判定（#663）', async ({
    page, context, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 源语言 auto：自动判定按各自 frame 的页面声明（夹具都是 lang="en"）
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-frames');
    await waitForBall(page);
    const same = page.frameLocator('#same');
    await expect(same.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });

    /** 在 frame 里的框写一段话、点圆点，断言框里换成了译成 lang 的译文。 */
    const translateIn = async (
      frame: { locator: (s: string) => import('@playwright/test').Locator },
      boxSel: string,
      text: string,
      lang: string,
    ) => {
      const box = frame.locator(boxSel);
      await box.click();
      await box.fill('');
      await page.keyboard.type(text);
      await frame.locator(DOT).click();
      await expect(box, `${boxSel} 译成 ${lang}`).toHaveValue(`【译】${text} [tl=${lang}]`, { timeout: 10_000 });
    };

    // 选之前：自动判定，译成页面声明的英文
    await translateIn(page, '#reply', '你好世界', 'en');

    // popup 开在后台标签页里：它操作的“当前标签页”是前台的测试页
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const select = popup.locator('#pt-input-lang-select');
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await select.selectOption('ja');
    await expect(select).toHaveValue('ja');

    // 主文档与已有的同域 iframe 都按日文翻译
    await translateIn(page, '#reply', '早上好', 'ja');
    await translateIn(same, '#child', '谢谢你', 'ja');

    // 选完之后才加载的 iframe：启动时问主文档，同样按日文翻译
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.id = 'late';
      iframe.src = 'input-frame-child.html';
      document.body.append(iframe);
    });
    const late = page.frameLocator('#late');
    await expect(late.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    await translateIn(late, '#child', '明天见', 'ja');

    // 选回“跟随设置”：三处都回到自动判定链，按页面声明译成英文
    await select.selectOption('auto');
    await expect(select).toHaveValue('auto');
    await translateIn(page, '#reply', '晚安', 'en');
    await translateIn(same, '#child', '再见', 'en');
    await translateIn(late, '#child', '回头见', 'en');
  });

  test('@core TC-E2E-162: 这一次的对方语言只管当前标签页当前打开的页面 —— 刷新、同标签页跳到别的页面、关闭标签页后都回到自动判定；别的标签页不受影响（#664）', async ({
    page, context, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 源语言 auto：自动判定按页面声明（夹具都是 lang="en"）
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    const select = popup.locator('#pt-input-lang-select');

    /** 在页面的框里写一段话、点圆点，返回框里换成的值。 */
    const translateIn = async (p: import('@playwright/test').Page, boxSel: string, text: string) => {
      const box = p.locator(boxSel);
      await box.click();
      await box.fill('');
      await p.keyboard.type(text);
      await p.locator(DOT).click();
      await expect(box).not.toHaveValue(text, { timeout: 10_000 });
      return box.inputValue();
    };
    /** popup 当前操作的是哪个标签页：把它放到前台再打开 popup。 */
    const openPopupFor = async (p: import('@playwright/test').Page) => {
      await p.bringToFront();
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      await expect(select).toBeEnabled({ timeout: 10_000 });
    };
    const chooseJa = async (p: import('@playwright/test').Page) => {
      await openPopupFor(p);
      await select.selectOption('ja');
      await expect(select).toHaveValue('ja');
      // 选择确实生效了：之后几条“回到自动判定”才有意义
      expect(await translateIn(p, '#reply', '早上好')).toBe('【译】早上好 [tl=ja]');
    };

    // 另一个标签页先开着
    const other = await context.newPage();
    await other.goto(fixtureUrl('input'), { waitUntil: 'domcontentloaded' });
    await waitForBall(other);

    await gotoFixture('input');
    await waitForBall(page);
    await chooseJa(page);

    // 1. 别的标签页不受影响：仍按自动判定译成英文，它的 popup 显示“跟随设置”
    expect.soft(await translateIn(other, '#reply', '你好'), '别的标签页').toBe('【译】你好 [tl=en]');
    await openPopupFor(other);
    await expect.soft(select, '别的标签页的 popup').toHaveValue('auto');
    // 选完之后才新开的标签页同样不受影响
    const fresh = await context.newPage();
    await fresh.goto(fixtureUrl('input'), { waitUntil: 'domcontentloaded' });
    await waitForBall(fresh);
    expect.soft(await translateIn(fresh, '#reply', '你好'), '之后新开的标签页').toBe('【译】你好 [tl=en]');
    await fresh.close();
    // 本标签页的选择还在：别的标签页没有把它冲掉
    expect(await translateIn(page, '#reply', '早上好')).toBe('【译】早上好 [tl=ja]');

    // 2. 刷新：回到自动判定
    await page.reload();
    await waitForBall(page);
    expect.soft(await translateIn(page, '#reply', '晚安'), '刷新之后').toBe('【译】晚安 [tl=en]');
    await openPopupFor(page);
    await expect.soft(select, '刷新之后的 popup').toHaveValue('auto');

    // 3. 同标签页跳到别的页面：回到自动判定
    await chooseJa(page);
    await page.goto(fixtureUrl('input-frames'), { waitUntil: 'domcontentloaded' });
    await waitForBall(page);
    expect.soft(await translateIn(page, '#reply', '谢谢'), '跳到别的页面之后').toBe('【译】谢谢 [tl=en]');
    await openPopupFor(page);
    await expect.soft(select, '跳到别的页面之后的 popup').toHaveValue('auto');

    // 4. 关闭标签页：重新打开同一个网址，回到自动判定
    await chooseJa(page);
    const url = page.url();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForBall(reopened);
    expect.soft(await translateIn(reopened, '#reply', '再见'), '关闭标签页再打开之后').toBe('【译】再见 [tl=en]');
    await openPopupFor(reopened);
    await expect.soft(select, '关闭标签页再打开之后的 popup').toHaveValue('auto');

    // 别的标签页从头到尾没被动过
    expect(await translateIn(other, '#reply', '回头见')).toBe('【译】回头见 [tl=en]');
  });

  test('@core TC-E2E-166: 单页应用用 pushState 换到别的路径，这一次的对方语言回到自动判定，主文档与 iframe 都是；同一路径上只换查询参数或 hash 不算（#836）', async ({
    page, context, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 源语言 auto：自动判定按页面声明（夹具都是 lang="en"）
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-frames');
    await waitForBall(page);
    const same = page.frameLocator('#same');
    await expect(same.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    const select = popup.locator('#pt-input-lang-select');

    /** 在 frame 里的框写一段话、点圆点，返回框里换成的值。 */
    const translateIn = async (
      frame: { locator: (s: string) => import('@playwright/test').Locator },
      boxSel: string,
      text: string,
    ) => {
      const box = frame.locator(boxSel);
      await box.click();
      await box.fill('');
      await page.keyboard.type(text);
      await frame.locator(DOT).click();
      await expect(box).not.toHaveValue(text, { timeout: 10_000 });
      return box.inputValue();
    };
    const openPopup = async () => {
      await page.bringToFront();
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      await expect(select).toBeEnabled({ timeout: 10_000 });
    };
    /** 单页应用换路由：页面自己调 history，不重新加载 */
    const pushState = (url: string) => page.evaluate((u) => history.pushState({}, '', u), url);

    await openPopup();
    await select.selectOption('ja');
    await expect(select).toHaveValue('ja');
    expect(await translateIn(page, '#reply', '早上好')).toBe('【译】早上好 [tl=ja]');
    expect(await translateIn(same, '#child', '谢谢你')).toBe('【译】谢谢你 [tl=ja]');

    // 1. 反向：同一路径上只换查询参数、只换 hash —— 还是这一页，选择不重置
    const path = new URL(page.url()).pathname;
    await pushState(`${path}?sort=new`);
    await pushState(`${path}?sort=new#comment-5`);
    await page.evaluate(() => history.replaceState({}, '', `${location.pathname}?sort=top`));
    expect.soft(await translateIn(page, '#reply', '你好'), '只换查询参数与 hash：主文档').toBe('【译】你好 [tl=ja]');
    expect.soft(await translateIn(same, '#child', '你好'), '只换查询参数与 hash：iframe').toBe('【译】你好 [tl=ja]');

    // 2. pushState 换到别的路径：主文档与 iframe 都回到自动判定，按页面声明译成英文
    await pushState('/some/other/route');
    expect(new URL(page.url()).pathname).toBe('/some/other/route');
    expect.soft(await translateIn(page, '#reply', '晚安'), '换路径之后：主文档').toBe('【译】晚安 [tl=en]');
    expect.soft(await translateIn(same, '#child', '再见'), '换路径之后：iframe').toBe('【译】再见 [tl=en]');
    // popup 也显示“跟随设置”
    await openPopup();
    await expect.soft(select, '换路径之后：popup').toHaveValue('auto');

    // 3. 换路径之后再选一次照常生效：重置的是这一次的选择，不是把功能关掉
    await select.selectOption('ja');
    await expect(select).toHaveValue('ja');
    expect(await translateIn(same, '#child', '明天见')).toBe('【译】明天见 [tl=ja]');
    // 后退回原来的路径（popstate）同样算换路径
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    expect.soft(await translateIn(page, '#reply', '回头见'), '后退之后：主文档').toBe('【译】回头见 [tl=en]');
    expect.soft(await translateIn(same, '#child', '回头见'), '后退之后：iframe').toBe('【译】回头见 [tl=en]');
  });
});

test.describe('领域的临时选择：单页应用换路径（#847）', () => {
  test('@core TC-E2E-184: 单页应用用 pushState 换到别的路径，领域的临时选择回到按网址判定，主文档与 iframe 都是；同一路径上只换查询参数或 hash 不算（#847）', async ({
    page, context, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    test.setTimeout(90_000);
    await seedSettings({});
    await mockGoogle();
    // “手选”不命中任何网址，只能手动切换；它把 paragraph 标成不翻译，请求原文
    // 里换成占位符，看得出这一段带没带它（同 TC-E2E-77）
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [
            {
              id: 'user:e2e-manual', name: '手选', targetLang: 'zh-CN', sites: [],
              origin: 'user', terms: [{ source: 'paragraph', noTranslate: true }],
            },
          ],
          builtin: {},
        },
      }),
    );
    /** 这一轮整页翻译发给 Google 的原文里，主文档与跨域 iframe 那一段各是什么样。 */
    const MAIN_TERM = 'This ⟦TM0⟧ is in the main document';
    const MAIN_PLAIN = 'This paragraph is in the main document';
    const FRAME_TERM = 'Every item in this frame ⟦TM0⟧ is translated';
    const FRAME_PLAIN = 'Every item in this frame paragraph is translated';

    await gotoFixture('iframe-cross');
    await waitForBall(page);
    const frame = page.frameLocator('#frame1');
    await expect(frame.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    const select = popup.locator('#pt-domain-select');
    const openPopup = async () => {
      await page.bringToFront();
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      await expect(select).toBeEnabled({ timeout: 10_000 });
    };
    /** popup 整页翻译一轮再还原，返回这一轮发出的原文。 */
    const translateRound = async (): Promise<string[]> => {
      // 增量从取读取器的这一刻算起：每一轮各取一个
      const requests = await mockRequests();
      await popup.locator('#pt-translate-page-btn').click();
      await expect(page.locator('p').first()).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      await expect(frame.locator('#full')).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      const { queries } = await requests();
      await popup.locator('#pt-translate-page-btn').click();
      await expect(page.locator('p').first()).not.toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      await expect(frame.locator('#full')).not.toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      return queries;
    };
    const has = (queries: string[], text: string) => queries.some((q) => q.includes(text));
    /** 单页应用换路由：页面自己调 history，不重新加载 */
    const pushState = (url: string) => page.evaluate((u) => history.pushState({}, '', u), url);

    await openPopup();
    await expect(select).toHaveValue('auto');
    await select.selectOption('user:e2e-manual');
    await expect(select).toHaveValue('user:e2e-manual');

    // 1. 反向：同一路径上只换查询参数、只换 hash —— 还是这一页，临时领域不重置
    const path = new URL(page.url()).pathname;
    await pushState(`${path}?sort=new`);
    await pushState(`${path}?sort=new#comment-5`);
    await page.evaluate(() => history.replaceState({}, '', `${location.pathname}?sort=top`));
    await openPopup();
    await expect(select).toHaveValue('user:e2e-manual');
    let queries = await translateRound();
    expect.soft(has(queries, MAIN_TERM), '只换查询参数与 hash：主文档仍带临时领域').toBe(true);
    expect.soft(has(queries, FRAME_TERM), '只换查询参数与 hash：iframe 仍带临时领域').toBe(true);

    // 2. pushState 换到别的路径：主文档与 iframe 都回到按网址判定（没有领域命中 localhost）
    await pushState('/some/other/route');
    expect(new URL(page.url()).pathname).toBe('/some/other/route');
    await openPopup();
    await expect(select).toHaveValue('auto');
    queries = await translateRound();
    expect.soft(has(queries, MAIN_PLAIN), '换路径之后：主文档不再带临时领域').toBe(true);
    expect.soft(has(queries, FRAME_PLAIN), '换路径之后：iframe 不再带临时领域').toBe(true);
    expect.soft(has(queries, '⟦TM0⟧'), '换路径之后：哪一段都不带').toBe(false);

    // 3. 换路径之后再选一次照常生效：重置的是这一次的选择，不是把功能关掉
    await select.selectOption('user:e2e-manual');
    await expect(select).toHaveValue('user:e2e-manual');
    queries = await translateRound();
    expect.soft(has(queries, MAIN_TERM), '再选一次：主文档').toBe(true);
    expect.soft(has(queries, FRAME_TERM), '再选一次：iframe').toBe(true);

    // 后退回原来的路径（popstate）同样算换路径
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await openPopup();
    await expect(select).toHaveValue('auto');
    queries = await translateRound();
    expect.soft(has(queries, MAIN_PLAIN), '后退之后：主文档').toBe(true);
    expect.soft(has(queries, FRAME_PLAIN), '后退之后：iframe').toBe(true);
  });
});

test.describe('输入翻译：与页面级闸门共用识别模块之后（#869）', () => {
  // #852 把浏览器自带的本地语言识别并成一个模块，输入翻译与页面级闸门共用。
  // 两者要的东西不同：闸门判整页内容的各语言占比，输入翻译判用户写的那一段，
  // 对方的语言仍按判定链（ADR-0005）取自设置与本页的声明、检测语言。
  // 夹具声明 en、正文是成段中文：页面内容的识别结果（zh）与声明不同，输入
  // 翻译只要拿错了一处（把页面内容当成对方的语言，或把整页识别当成那段文字
  // 的语言），下面三条就会有一条红
  const DOT = '#pt-host-input-dot .pt-input-dot';
  const TOAST = '#pt-host-toast .pt-toast';

  test.beforeEach(async ({ page, serviceWorker, seedSettings, mockGoogle, gotoFixture }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-content-zh');
    await waitForBall(page);
    // 先验夹具前提：正文在识别器上可靠地判成中文，声明却是 en。不成立时下面
    // 三条什么都没区分开
    const bodyText = await page.evaluate(() =>
      [...document.querySelectorAll('h1, p')].map((el) => el.textContent).join('\n'),
    );
    const content = await serviceWorker.evaluate(
      (t) => new Promise<chrome.i18n.LanguageDetectionResult>((r) => chrome.i18n.detectLanguage(t, r)),
      bodyText,
    );
    expect(content.isReliable, '夹具正文的识别结果不可靠').toBe(true);
    expect(content.languages[0]?.language, '夹具正文没被识别成中文').toBe('zh');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    // 源语言跟随设置（auto），目标语言 zh-CN
    const settings = await serviceWorker.evaluate(async () =>
      (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as { from: string; to: string },
    );
    expect([settings.from, settings.to]).toEqual(['auto', 'zh-CN']);
  });

  /** 清空输入框、写一段字、点圆点。 */
  async function write(page: import('@playwright/test').Page, text: string) {
    const box = page.locator('#reply');
    await box.click();
    await box.fill('');
    await page.keyboard.type(text);
    await page.locator(DOT).click();
  }

  test('@core TC-E2E-172: 对方的语言仍取自声明而不是页面内容的识别结果 —— 声明 en、正文中文的页面上写中文，译成英文；声明换成 ja 就译成日文（#869）', async ({
    page, mockRequests,
  }) => {
    const requests = await mockRequests();
    const box = page.locator('#reply');

    // 页面内容是中文。若把它当成对方的语言，对方就是 zh，写中文会被判成同语言
    await write(page, '这个问题我们明天再讨论');
    await expect(box).toHaveValue('【译】这个问题我们明天再讨论 [tl=en]', { timeout: 10_000 });

    // 判定链跟着声明走
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'ja'));
    await write(page, '早上好');
    await expect(box).toHaveValue('【译】早上好 [tl=ja]', { timeout: 10_000 });
    expect((await requests()).queries).toEqual(['这个问题我们明天再讨论', '早上好']);
  });

  test('@core TC-E2E-173: 写的已经是对方的语言 → 按写的那段文字判，不按页面内容：正文中文、声明 en 的页面上写英文，不替换、零请求并提示（#869）', async ({
    page, serviceWorker, mockRequests,
  }) => {
    const requests = await mockRequests();
    const hint = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastInputSameLanguage'));
    const box = page.locator('#reply');
    const toast = page.locator(TOAST);
    const text = 'I think we should discuss this issue tomorrow morning.';

    // 若拿整页内容的识别结果（zh）当这段文字的语言，就不算同语言、照常送翻
    await write(page, text);
    await expect(toast).toHaveText(hint);
    await expect(toast).toHaveAttribute('data-kind', 'info');
    await expect(box).toHaveValue(text);
    expect((await requests()).queries).toEqual([]);
  });

  test('@core TC-E2E-174: 判不出对方的语言时不猜 —— 去掉声明后，正文明明是中文也不拿它当对方的语言，提示去设置里指定源语言、零请求、框里不变（#869，ADR-0005）', async ({
    page, serviceWorker, mockRequests,
  }) => {
    const requests = await mockRequests();
    const hint = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastInputSourceLangNeeded'));
    const box = page.locator('#reply');
    const text = 'Could we move the release to Thursday evening instead?';

    // 源语言 auto、本页没翻译过（没有检测语言）、没有声明：判定链判不出。
    // 若拿页面内容的识别结果顶上，对方就成了 zh，这段英文会被送翻
    await page.evaluate(() => document.documentElement.removeAttribute('lang'));
    await write(page, text);
    await expect(page.locator(`${TOAST}[data-kind="error"]`)).toHaveText(hint);
    await expect(box).toHaveValue(text);
    expect((await requests()).queries).toEqual([]);
  });
});

test.describe('输入翻译：iframe 里的输入框（#672）', () => {
  const DOT = '#pt-host-input-dot .pt-input-dot';

  test('@core TC-E2E-163: 同域与跨域 iframe 里的输入框都浮出圆点并完成翻译，跨域 iframe 也用得上这一次的对方语言；焦点在哪个 frame 只有那里的圆点可见，同一时刻页面上只有一个（#672）', async ({
    page, context, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 源语言 auto：自动判定按各自 frame 的页面声明（夹具都是 lang="en"）
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    const requests = await mockRequests();
    await gotoFixture('input-frames');
    await waitForBall(page);
    const same = page.frameLocator('#same');
    const cross = page.frameLocator('#cross');
    await expect(same.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    await expect(cross.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    // 跨域确实是跨域：子 frame 的主机名与顶层不同
    expect(await page.frame({ url: /127\.0\.0\.1/ })!.evaluate(() => location.hostname)).toBe('127.0.0.1');

    const frames = { main: page, same, cross } as const;
    const dots = {
      main: page.locator(DOT),
      same: same.locator(DOT),
      cross: cross.locator(DOT),
    };
    /** 当下哪些 frame 的圆点可见 —— 取当下，不重试。 */
    const visibleDots = async () => {
      const shown: string[] = [];
      for (const [name, dot] of Object.entries(dots)) if (await dot.isVisible()) shown.push(name);
      return shown;
    };
    /** 焦点放进某个 frame 的框里打字：那里的圆点浮出，而且此刻只有它一个。 */
    const typeIn = async (name: keyof typeof frames, boxSel: string, text: string) => {
      await frames[name].locator(boxSel).click();
      await page.keyboard.type(text);
      await expect(dots[name], `${name} 的圆点浮出`).toBeVisible();
      expect(await visibleDots(), `焦点在 ${name}：同一时刻只有一个圆点`).toEqual([name]);
    };
    const translateIn = async (name: keyof typeof frames, boxSel: string, text: string, lang: string) => {
      const box = frames[name].locator(boxSel);
      await box.fill('');
      await typeIn(name, boxSel, text);
      await dots[name].click();
      await expect(box, `${name} 译成 ${lang}`).toHaveValue(`【译】${text} [tl=${lang}]`, { timeout: 10_000 });
      // 点完焦点还在这个框里，别的 frame 的圆点仍不可见
      await expect(box).toBeFocused();
      expect(await visibleDots(), `${name} 翻译之后`).toEqual([name]);
    };

    // 主文档先写半句，圆点浮出
    await typeIn('main', '#reply', '主文档里写了一半');
    // 焦点换到同域 iframe：主文档的圆点不再显示；翻译完成
    await translateIn('same', '#child', '你好世界', 'en');
    // 焦点换到跨域 iframe：同域 iframe 与主文档的圆点都不显示；翻译完成
    await translateIn('cross', '#child', '谢谢你', 'en');
    // 回到主文档：只有主文档的圆点，主文档那半句没被动过
    await page.locator('#reply').click();
    await expect(dots.main).toBeVisible();
    expect(await visibleDots(), '回到主文档').toEqual(['main']);
    await expect(page.locator('#reply')).toHaveValue('主文档里写了一半');
    // 焦点离开所有输入框：一个圆点都没有
    await page.locator('h1').click();
    await expect(dots.main).toBeHidden();
    expect(await visibleDots(), '焦点不在任何输入框').toEqual([]);
    expect((await requests()).google).toBe(2);

    // popup 里选这一次译成日文：广播到跨域 iframe，那里的输入翻译也用上
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const select = popup.locator('#pt-input-lang-select');
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await select.selectOption('ja');
    await expect(select).toHaveValue('ja');
    await translateIn('cross', '#child', '明天见', 'ja');
    await translateIn('same', '#child', '早上好', 'ja');
  });

  test('@core TC-E2E-167: 没有网址的 iframe 里也有圆点 —— about:blank 写出的 <body contenteditable> 编辑区（TinyMCE 的形状）圆点贴文字末尾、点下去完成翻译，扩展的节点不进编辑内容；srcdoc 里的文本框同样可用；整页翻译不动编辑区（#838）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 源语言 auto：自动判定按各自 frame 的页面声明（都是 lang="en"）
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-blank-frames');
    await waitForBall(page);

    // ── about:blank 加 document.write，<body contenteditable> 是编辑区 ──
    const blank = page.frameLocator('#blank');
    const editor = blank.locator('body');
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 10_000 });
    await expect(blank.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('你好世界');
    const dot = blank.locator(DOT);
    await expect(dot).toBeVisible();

    // 圆点贴文字末尾（ADR-0006）：末尾右侧 4px（#667），竖直居中于末尾那一行。
    // 末尾的真值是 frame 里折叠在最后一个字之后的选区矩形，加上 iframe 内容区在页面上的起点
    const origin = await page.locator('#blank').evaluate((f) => {
      const r = f.getBoundingClientRect();
      return { x: r.left + f.clientLeft, y: r.top + f.clientTop };
    });
    await expect(async () => {
      const end = await editor.evaluate((body) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        while (walker.nextNode()) if ((walker.currentNode as Text).length > 0) last = walker.currentNode as Text;
        const r = document.createRange();
        r.setStart(last!, last!.length);
        r.collapse(true);
        const c = r.getClientRects()[0]!;
        return { x: c.left, cy: c.top + c.height / 2 };
      });
      const d = (await dot.boundingBox())!;
      expect(Math.abs(d.x - (origin.x + end.x + 4)), '横向：文字末尾右侧 4px').toBeLessThanOrEqual(2);
      expect(Math.abs(d.y + d.height / 2 - (origin.y + end.cy)), '竖向：末尾那一行').toBeLessThanOrEqual(2);
    }).toPass({ timeout: 5_000 });

    // 扩展的节点挂在 <html> 下、body 之外：编辑器按 body 取稿，取到的只有用户的文字
    const editorHtml = () => editor.evaluate((b) => b.innerHTML);
    expect(await editorHtml()).not.toMatch(/pt-host|data-pt/);
    expect(await editor.evaluate((b) => b.textContent)).toBe('你好世界');

    await dot.click();
    await expect(editor).toHaveText('【译】你好世界 [tl=en]', { timeout: 10_000 });
    expect(await editorHtml()).not.toMatch(/pt-host|data-pt/);

    // ── srcdoc 的 iframe 里的文本框 ──
    const srcdoc = page.frameLocator('#srcdoc');
    await expect(srcdoc.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    const box = srcdoc.locator('#child');
    await box.click();
    await page.keyboard.type('谢谢你');
    await srcdoc.locator(DOT).click();
    await expect(box).toHaveValue('【译】谢谢你 [tl=en]', { timeout: 10_000 });

    // ── 整页翻译（popup 广播到全部 frame）：srcdoc 里的段落出译文，编辑区一个字不动 ──
    const draft = await editorHtml();
    const toggleAll = () =>
      serviceWorker.evaluate(async () => {
        for (const tab of await chrome.tabs.query({})) {
          try {
            const r = await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
            if (r) return (r as { status?: string }).status;
          } catch {
            // 没有 content script 的标签页
          }
        }
        return null;
      });
    expect(await toggleAll()).toBe('translated');
    await expect(srcdoc.locator('#note')).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    await expect(page.locator('#intro')).toHaveAttribute('data-pt', 'done');
    expect(await editorHtml()).toBe(draft);
    expect(await toggleAll()).toBe('restored');
    await expect(srcdoc.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    expect(await editorHtml()).toBe(draft);
  });

  /**
   * #849：只开 matchAboutBlank 时仍不注入的三种 frame，打开 matchOriginAsFallback
   * 之后按父页面的网址匹配。每种各一条：注入了、popup 的整页翻译翻到 frame 里的
   * 正文并能逐字节还原、文本框里有圆点且点下去完成翻译。
   */
  async function checkOpaqueFrame(
    page: import('@playwright/test').Page,
    serviceWorker: import('@playwright/test').Worker,
    id: string,
  ) {
    const frame = page.frameLocator(`#${id}`);
    const para = frame.locator('#para');
    await expect(para).toBeVisible({ timeout: 10_000 });
    // 注入了：内容脚本给 frame 的 html 挂上样式类
    await expect(frame.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    const before = await para.evaluate((el) => el.outerHTML);

    // popup 的整页翻译不带 frameId 广播到全部 frame：这个 frame 里的正文跟着翻译、跟着还原
    const toggleAll = () =>
      serviceWorker.evaluate(async () => {
        for (const tab of await chrome.tabs.query({})) {
          try {
            const r = await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
            if (r) return (r as { status?: string }).status;
          } catch {
            // 没有 content script 的标签页
          }
        }
        return null;
      });
    expect(await toggleAll()).toBe('translated');
    await expect(para).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    const source = (await para.locator('.pt-origin').textContent())!.trim();
    // 替身回显目标语言：整页翻译译成设置里的目标语言
    await expect(para.locator('.pt-trans')).toHaveText(`【译】${source} [tl=zh-CN]`);
    expect(await toggleAll()).toBe('restored');
    await expect(frame.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    expect(await para.evaluate((el) => el.outerHTML)).toBe(before);

    // 输入翻译：文本框里有圆点，点下去框里换成译文（对方语言按 frame 的声明 en）
    const box = frame.locator('#child');
    await box.click();
    await page.keyboard.type('谢谢你');
    await frame.locator(DOT).click();
    await expect(box).toHaveValue('【译】谢谢你 [tl=en]', { timeout: 10_000 });
  }

  test('@core TC-E2E-185: sandbox 的 srcdoc iframe（不同源）也注入 —— 整页翻译翻到里面的正文并能还原，文本框有圆点（#849）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-opaque-frames');
    await waitForBall(page);
    await checkOpaqueFrame(page, serviceWorker, 'sandboxed');
  });

  test('@core TC-E2E-186: data: 网址的 iframe 也注入 —— 整页翻译翻到里面的正文并能还原，文本框有圆点（#849）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-opaque-frames');
    await waitForBall(page);
    await checkOpaqueFrame(page, serviceWorker, 'data');
  });

  test('@core TC-E2E-187: blob: 网址的 iframe 也注入 —— 整页翻译翻到里面的正文并能还原，文本框有圆点（#849）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ echoTargetLang: true });
    await gotoFixture('input-opaque-frames');
    await waitForBall(page);
    await checkOpaqueFrame(page, serviceWorker, 'blob');
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

  test('@core TC-E2E-165: 整段一个单元的 br 段落，送翻时 br 作为换行带出去，译文在同样的位置换行 —— 4 行短诗与 #768 那种链接多的 30 行段落；还原后逐字节回到原样（#840）', async ({
    page, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    const requests = await mockRequests();
    await gotoFixture('br-lines');
    const ball = await waitForBall(page);
    const poem = page.locator('#poem');
    const threads = page.locator('#threads');
    // 源码换行在页面上就是空格，期望的行按同样的口径折叠
    const fold = (lines: string[]) => lines.map((l) => l.replace(/\s+/g, ' '));
    const poemLines = fold(await readLines(poem));
    const threadLines = fold(await readLines(threads));
    expect(poemLines).toHaveLength(4);
    expect(threadLines).toHaveLength(30);
    const before = await page.locator('body').evaluate((el) => el.innerHTML);

    await ball.click();
    await expect(poem).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    await expect(threads).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });

    // 两段都是整段一个单元，没有按行切
    await expect(page.locator('.pt-chunk, [data-pt-split]')).toHaveCount(0);
    // 送出去的原文按 br 换行（引擎替身原样回显，加前缀）
    const queries = (await requests()).queries;
    expect(queries).toContain(poemLines.join('\n'));
    expect(queries).toContain(threadLines.join('\n'));

    /** 译文区按 br 分开的各行，与 br 个数。 */
    const translated = (unit: import('@playwright/test').Locator) =>
      unit.locator(':scope > .pt-trans').evaluate((el) => {
        const lines = [''];
        for (const node of el.childNodes) {
          if (node.nodeName === 'BR') lines.push('');
          else lines[lines.length - 1] += node.textContent ?? '';
        }
        return { lines, brs: el.querySelectorAll('br').length };
      });
    const withPrefix = (lines: string[]) => lines.map((l, i) => (i === 0 ? `【译】${l}` : l));
    expect(await translated(poem)).toEqual({ lines: withPrefix(poemLines), brs: 3 });
    expect(await translated(threads)).toEqual({ lines: withPrefix(threadLines), brs: 29 });

    // 真的分行显示：译文区每一行各占一行
    const rows = await threads.locator(':scope > .pt-trans').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(rows).toBeGreaterThanOrEqual(30);

    // 还原：整页逐字节回到原样
    await ball.click();
    await expect(page.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    expect(await page.locator('body').evaluate((el) => el.innerHTML)).toBe(before);
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

  /** 维基形态夹具（#735）里的段落：标记密集的正常正文、普通段落、文字真正超长的段落 */
  const WIKI_DENSE = ['#dense-career', '#dense-early', '#dense-recognition'];
  const WIKI_PLAIN = ['#lead', '#plain', '#light'];

  /** 段落的形状：文字长度、序列化后的 HTML 长度、子树元素个数 */
  function shapeOf(page: import('@playwright/test').Page, id: string) {
    return page.locator(id).evaluate((el) => ({
      text: (el.textContent ?? '').trim().length,
      html: el.outerHTML.length,
      elements: el.getElementsByTagName('*').length,
    }));
  }

  test('@core TC-E2E-155: 维基形态的条目页整页翻译 —— 标记密集的段落有译文，同页普通段落照常翻译，文字真正超长的段落仍然没有译文（#735）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('wiki-article');

    // 前提：夹具照 #724、#730 的实测造。标记密集的段落文字远低于上限、序列化后
    // 远超旧的 HTML 上限（4096），元素个数落在实测的正常正文范围（37 到 87）
    for (const id of WIKI_DENSE) {
      const s = await shapeOf(page, id);
      expect(s.text, id).toBeLessThan(3072);
      expect(s.html, id).toBeGreaterThan(4096);
      expect(s.elements, id).toBeGreaterThanOrEqual(37);
      expect(s.elements, id).toBeLessThanOrEqual(87);
    }
    for (const id of WIKI_PLAIN) expect((await shapeOf(page, id)).html, id).toBeLessThan(4096);
    // 超长段落只超文字上限，HTML 并不超 —— 拦住它的只能是文字上限
    const long = await shapeOf(page, '#long');
    expect(long.text).toBeGreaterThan(3072);
    expect(long.html).toBeLessThan(4096);

    await translateAndWait(page);

    for (const id of [...WIKI_DENSE, ...WIKI_PLAIN]) {
      await expect(page.locator(id), id).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    }
    // 标记密集的段落：译文是整段正文，链接与引用角标都还在原文里
    const career = page.locator('#dense-career');
    await expect(career.locator('.pt-trans')).toHaveText(/^【译】Valcourt began her career with small parts in French cinema/);
    await expect(career.locator('.pt-origin a[rel="mw:WikiLink"]')).toHaveCount(26);
    await expect(career.locator('.pt-origin sup.reference')).toHaveCount(9);
    await expect(page.locator('#dense-early .pt-trans')).toHaveText(/^【译】Valcourt was born in Lyon/);
    await expect(page.locator('#dense-recognition .pt-trans')).toHaveText(/^【译】By the middle of the decade/);
    await expect(page.locator('#plain .pt-trans')).toHaveText(/^【译】Valcourt has spoken only rarely/);

    // 文字真正超长的段落仍然不翻
    await expect(page.locator('#long')).not.toHaveAttribute('data-pt', /./);
    await expect(page.locator('#long .pt-trans')).toHaveCount(0);
    // 参考文献列表是非正文区域，照旧不翻
    await expect(page.locator('.references .pt-trans')).toHaveCount(0);
  });

  test('@core TC-E2E-156: 维基形态的条目页上，鼠标停在标记密集的段落上逐段翻译按钮浮出、点击后这一段出现译文；文字真正超长的段落上不浮出；按钮浮出的段落与整页翻译翻到的段落是同一批（#736）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await mockGoogle();
    await gotoFixture('wiki-article');
    await waitForBall(page);
    const paraBtn = page.locator('.pt-para-btn');

    /**
     * 停在这一段的第一行上，按钮是否浮出并贴在这一段旁边。按钮离开段落后
     * 要过一段隐藏延迟才消失，所以按位置认它属于哪一段，而不是只看可见。
     * 等待时长同 TC-E2E-145：悬停意图延迟（SHOW_DELAY）之外留足余量
     */
    const showsButtonOn = async (id: string) => {
      const p = page.locator(id);
      await p.hover({ position: { x: 24, y: 8 } });
      await page.waitForTimeout(600);
      if (!(await paraBtn.isVisible())) return false;
      const [b, r] = await Promise.all([paraBtn.boundingBox(), p.boundingBox()]);
      const mid = b!.y + b!.height / 2;
      return mid >= r!.y - b!.height && mid <= r!.y + r!.height;
    };

    // 文字真正超长的段落：停够悬停意图延迟也不浮出
    expect(await showsButtonOn('#long')).toBe(false);
    await expect(paraBtn).toBeHidden();

    // 逐段停一遍，记下哪些段落浮出按钮
    const paragraphs = await page.locator('.mw-parser-output p[id]').evaluateAll((els) => els.map((e) => `#${e.id}`));
    expect(paragraphs).toEqual(['#lead', '#dense-career', '#dense-early', '#plain', '#dense-recognition', '#light', '#long']);
    const withButton: string[] = [];
    for (const id of paragraphs) if (await showsButtonOn(id)) withButton.push(id);
    expect(withButton.sort()).toEqual([...WIKI_DENSE, ...WIKI_PLAIN].sort());

    // 标记密集的段落：停在一个条目链接上，按钮浮出，点击后只翻这一段
    const career = page.locator('#dense-career');
    // 先等上一段的按钮过了隐藏延迟消失，免得点到别的段
    await page.mouse.move(0, 0);
    await expect(paraBtn).toBeHidden({ timeout: 5_000 });
    await career.locator('a[rel="mw:WikiLink"]').nth(12).hover();
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();
    await expect(career).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
    await expect(career.locator('.pt-trans')).toHaveText(/^【译】Valcourt began her career with small parts in French cinema/);
    for (const id of paragraphs.filter((x) => x !== '#dense-career')) {
      await expect(page.locator(id), id).not.toHaveAttribute('data-pt', /./);
    }

    // 两条路口径一致：重新载入后整页翻译，翻到的段落正是上面浮出按钮的那一批
    await page.reload({ waitUntil: 'domcontentloaded' });
    await translateAndWait(page);
    for (const id of withButton) {
      await expect(page.locator(id), id).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    }
    const translated = await page
      .locator('.mw-parser-output p[id][data-pt="done"]')
      .evaluateAll((els) => els.map((e) => `#${e.id}`));
    expect(translated.sort()).toEqual(withButton);
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

  /**
   * 走右键菜单“翻译所选文本”：在 service worker 里派发菜单点击事件，经后台
   * 真实的点击处理（取 selectionText、发给标签页）进入页面 —— 原生右键菜单
   * Playwright 点不到，这是离用户最近的一步。
   */
  async function contextMenuClick(sw: import('@playwright/test').Worker, text: string) {
    await sw.evaluate(async (t: string) => {
      const clicked = chrome.contextMenus.onClicked as unknown as {
        dispatch(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void;
      };
      for (const tab of await chrome.tabs.query({})) {
        clicked.dispatch(
          { menuItemId: 'pt-translate-selection', selectionText: t, editable: false, pageUrl: tab.url ?? '' },
          tab,
        );
      }
    }, text);
  }

  test('@core TC-E2E-181: 右键菜单“翻译所选文本”与拖选划词表现一致 —— 同样先出等待态再就地变成译文，停留时长、悬停不计时、关闭按钮（鼠标与键盘）都一样；状态提示不变（#752）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    test.setTimeout(120_000);
    await seedSettings({});
    await mockGoogle({ delayMs: 1_500 });
    const [translating, closeLabel, failText] = await serviceWorker.evaluate(() => [
      chrome.i18n.getMessage('toastTranslating'),
      chrome.i18n.getMessage('toastClose'),
      chrome.i18n.getMessage('toastTranslateFail'),
    ]);
    await gotoFixture('basic');
    await waitForBall(page);
    const toast = page.locator(TOAST);

    // 每 10ms 采样一次提示：条数、是不是这一轮最先出现的那一条、有没有转圈、
    // 有没有关闭按钮、文字；只记变化，带上时刻
    await page.evaluate(() => {
      const w = window as unknown as { __ptSeq: [number, string][]; __ptFirst: Element | null };
      w.__ptSeq = [];
      w.__ptFirst = null;
      setInterval(() => {
        const root = document.getElementById('pt-host-toast')?.shadowRoot;
        const els = root ? Array.from(root.querySelectorAll('.pt-toast')) : [];
        const el = els[0];
        if (el && !w.__ptFirst) w.__ptFirst = el;
        const entry = [
          els.length,
          el ? (el === w.__ptFirst ? 'same' : 'other') : '-',
          el?.querySelector('.pt-toast-spinner') ? 'spin' : '',
          el?.querySelector('.pt-toast-close') ? 'close' : '',
          el?.textContent ?? '',
        ].join('|');
        const last = w.__ptSeq[w.__ptSeq.length - 1];
        if (!last || last[1] !== entry) w.__ptSeq.push([performance.now(), entry]);
      }, 10);
    });
    const resetSeq = () =>
      page.evaluate(() => {
        const w = window as unknown as { __ptSeq: [number, string][]; __ptFirst: Element | null };
        w.__ptSeq = [];
        w.__ptFirst = null;
      });
    /** 一轮划词从发起到提示消失的经过：状态序列与译文停留了多久。 */
    const summarize = async () => {
      const raw = await page.evaluate(
        () => (window as unknown as { __ptSeq: [number, string][] }).__ptSeq,
      );
      const seq = raw.map(([t, e]) => [t, ...e.split('|')] as [number, string, string, string, string, string]);
      const shownSeq = seq.filter(([, count]) => count !== '0');
      const first = shownSeq[0]!;
      const result = shownSeq[shownSeq.length - 1]!;
      const appeared = shownSeq.find(([, , , spin]) => spin === '')![0];
      const gone = seq.find(([t, count]) => count === '0' && t > appeared)![0];
      return {
        // 同一时刻至多一条，而且自始至终是同一条
        oneAndSame: shownSeq.every(([, count, which]) => count === '1' && which === 'same'),
        // 先是“翻译中”带转圈、没有关闭按钮
        pendingFirst: first[3] === 'spin' && first[4] === '' && first[5] === translating,
        // 中间只有等待态与译文两种状态
        twoStates: shownSeq.every(([, , , spin, , text]) => (spin === 'spin' && text === translating) || text === result[5]),
        close: result[4] === 'close',
        text: result[5],
        lifetime: gone - appeared,
      };
    };

    // 拖选划词
    await dragSelect(page, 'p:nth-of-type(2)');
    const selected = await page.evaluate(() => window.getSelection()!.toString());
    await page.mouse.move(5, 5);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    await expect(toast).toHaveCount(0, { timeout: 70_000 });
    const drag = await summarize();

    // 右键菜单，同一段文字
    await resetSeq();
    await contextMenuClick(serviceWorker, selected);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    await expect(toast).toHaveCount(0, { timeout: 70_000 });
    const ctx = await summarize();

    expect(drag).toMatchObject({ oneAndSame: true, pendingFirst: true, twoStates: true, close: true });
    expect(ctx).toMatchObject({ oneAndSame: true, pendingFirst: true, twoStates: true, close: true });
    expect(ctx.text).toBe(drag.text);
    // 同一段译文停留一样久（采样与调度的误差在半秒内），而且都比状态类的 3 秒久
    expect(drag.lifetime).toBeGreaterThan(3_500);
    expect(Math.abs(ctx.lifetime - drag.lifetime)).toBeLessThan(500);

    // 右键入口的译文：悬停不计时，移开后重新停满一整轮
    await contextMenuClick(serviceWorker, selected);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    await toast.hover();
    await page.waitForTimeout(ctx.lifetime + 1_000);
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(3_000);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: ctx.lifetime + 2_000 });

    // 右键入口的译文：点关闭立即消失
    await contextMenuClick(serviceWorker, selected);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    await toast.getByRole('button', { name: closeLabel }).click();
    await expect(toast).toHaveCount(0, { timeout: 1_000 });

    // 键盘也能关（#743）：Tab 到关闭按钮，回车
    await contextMenuClick(serviceWorker, selected);
    await expect(toast).toContainText('【译】Another paragraph', { timeout: 20_000 });
    const onClose = () =>
      page.evaluate(
        () => document.getElementById('pt-host-toast')?.shadowRoot?.activeElement?.classList.contains('pt-toast-close') === true,
      );
    for (let i = 0; i < 20 && !(await onClose()); i++) await page.keyboard.press('Tab');
    expect(await onClose()).toBe(true);
    await page.keyboard.press('Enter');
    await expect(toast).toHaveCount(0, { timeout: 1_000 });

    // 状态类不受影响：右键入口的失败提示没有关闭按钮，照常 3 秒消失
    await mockGoogle({ fail: true });
    await contextMenuClick(serviceWorker, selected);
    const fail = page.locator(`${TOAST}[data-kind="error"]`);
    await expect(fail).toHaveText(failText, { timeout: 20_000 });
    await expect(toast.getByRole('button')).toHaveCount(0);
    await expect(fail).toHaveCount(0, { timeout: 4_000 });
  });

  test('@core TC-E2E-183: 键盘用户 —— 输入框里打字时弹出译文不抢焦点；Tab 到关闭按钮后提示不再计时，回车关掉后焦点回到那个输入框（#917）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    test.setTimeout(60_000);
    await seedSettings({});
    await mockGoogle();
    await gotoFixture('basic');
    await waitForBall(page);
    const toast = page.locator(TOAST);
    // 页面末尾一个输入框，用户正在里面打字
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'pt-917-input';
      document.body.appendChild(input);
    });
    const input = page.locator('#pt-917-input');
    await input.click();
    await page.keyboard.type('hello');
    const inputFocused = () => page.evaluate(() => document.activeElement?.id === 'pt-917-input');
    const onClose = () =>
      page.evaluate(
        () => document.getElementById('pt-host-toast')?.shadowRoot?.activeElement?.classList.contains('pt-toast-close') === true,
      );

    // 右键菜单入口不动页面焦点：译文弹出时焦点仍在输入框里（#743）
    const text = 'Another paragraph with some words to translate.';
    await contextMenuClick(serviceWorker, text);
    await expect(toast).toContainText('【译】', { timeout: 20_000 });
    await expect.poll(() => toast.evaluate((el) => el.querySelector('.pt-toast-spinner') === null)).toBe(true);
    expect(await inputFocused()).toBe(true);
    expect(await onClose()).toBe(false);

    // 量这条译文自己计时要停多久：焦点不在提示里时它会自己走
    const shownAt = Date.now();
    await expect(toast).toHaveCount(0, { timeout: 70_000 });
    const lifetime = Date.now() - shownAt;
    expect(await inputFocused()).toBe(true);

    // 再来一次，Tab 到关闭按钮：过了本应消失的时刻仍在
    await contextMenuClick(serviceWorker, text);
    await expect(toast).toContainText('【译】', { timeout: 20_000 });
    for (let i = 0; i < 20 && !(await onClose()); i++) await page.keyboard.press('Tab');
    expect(await onClose()).toBe(true);
    await page.waitForTimeout(lifetime + 1_500);
    await expect(toast).toBeVisible();

    // 回车关掉：焦点回到弹出前的输入框，输入框里的字还在
    await page.keyboard.press('Enter');
    await expect(toast).toHaveCount(0, { timeout: 1_000 });
    expect(await inputFocused()).toBe(true);
    await expect(input).toHaveValue('hello');
    await page.keyboard.type(' world');
    await expect(input).toHaveValue('hello world');
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

  test('@core TC-E2E-164: 闸门以本地内容识别为准 —— 声明是中文、内容是英文的页面照常翻译；纯中文页面与声明是 en 的中文页面零请求拦下；文字太少识别拿不准时按声明，与改动前一致（#843）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ to: 'zh-CN' });
    // 引擎把中文原样还回来、外文加前缀：中文界面文字由单元级兜底（#783）拦下
    await mockGoogle({ keepCjk: true });
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));
    const toast = page.locator(TOAST);

    // 1. Steam 的形状：声明 zh-CN，界面文字是中文，介绍是英文。以前闸门只看声明，
    //    弹“本页已经是你的目标语言”一个字不翻；现在照常翻译
    await gotoFixture('content-foreign');
    let ball = await waitForBall(page);
    let requests = await mockRequests();
    const zhBefore = await page.locator('#menu, #crumbs, #title, #review, #about, #buy').evaluateAll(
      (els) => els.map((el) => el.outerHTML),
    );
    await ball.click();
    for (const id of ['#en1', '#en2', '#en3', '#en4']) {
      const el = page.locator(id);
      await expect(el).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      const source = await el.locator('.pt-origin').textContent();
      await expect(el.locator('.pt-trans')).toHaveText(`【译】${source!.trim()}`);
    }
    await expect(ball).toHaveAttribute('data-state', 'done');
    expect((await requests()).google).toBeGreaterThan(0);
    expect(await toast.allTextContents()).not.toContain(message);
    // 中文界面文字不插译文，一个字不动
    expect(
      await page.locator('#menu, #crumbs, #title, #review, #about, #buy').evaluateAll((els) =>
        els.map((el) => el.outerHTML),
      ),
    ).toEqual(zhBefore);

    // 2. 纯中文页面（#777 的模板页形状，夹一段英文引文）：仍然拦下，零请求，
    //    页面一个字不动 —— 内容识别取样是只读的，超长段落没被切成切块
    await gotoFixture('same-language');
    ball = await waitForBall(page);
    requests = await mockRequests();
    const content = () => page.locator('#content').evaluate((el) => el.outerHTML);
    let before = await content();
    await ball.click();
    await expect(toast).toHaveText(message, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await content()).toBe(before);
    await expect(page.locator('[data-pt], .pt-chunk, [data-pt-split]')).toHaveCount(0);
    expect((await requests()).google).toBe(0);

    // 3. 声明是 en、内容其实是中文：以前声明不是目标语言就放行，现在内容识别拦下
    await gotoFixture('content-zh-declared-en');
    ball = await waitForBall(page);
    requests = await mockRequests();
    before = await content();
    await ball.click();
    await expect(toast).toHaveText(message, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await content()).toBe(before);
    expect((await requests()).google).toBe(0);

    // 4. 只有一句很短的英文，识别器给不出可靠结果：回落到声明（zh-CN），与改动前
    //    一样拦下。若内容识别在拿不准时也被采信，这一页会按英文放行
    await gotoFixture('content-short');
    ball = await waitForBall(page);
    requests = await mockRequests();
    before = await content();
    await ball.click();
    await expect(toast).toHaveText(message, { timeout: 10_000 });
    expect(await content()).toBe(before);
    expect((await requests()).google).toBe(0);
  });

  test('@core TC-E2E-171: 带三个 iframe 的纯目标语言页面，popup 整页翻译广播到全部 frame —— 只有主文档弹一条说明，子框架不弹；悬浮球始终是未翻译态，从不点亮完成态；零请求、各 frame 逐字节不变（#870）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 夹具与三个子框架的声明都是 en、内容都是中文：拦下只能来自内容识别
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle();
    await gotoFixture('same-language-frames');
    const ball = await waitForBall(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const frames = ['#f1', '#f2', '#f3'].map((id) => page.frameLocator(id));
    for (const frame of frames) {
      await expect(frame.locator('#content p')).toHaveCount(3, { timeout: 10_000 });
      await expect(frame.locator('html')).toHaveAttribute('lang', 'en');
    }
    // 子框架的 content script 在 document_idle 注入：等各 frame 加载完再留一点余量
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);

    const snapshot = () =>
      Promise.all([
        page.locator('#content').evaluate((el) => el.outerHTML),
        ...frames.map((f) => f.locator('#content').evaluate((el) => el.outerHTML)),
      ]);
    const before = await snapshot();
    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));

    // popup 的整页翻译：不带 frameId，广播到这个标签页的全部 frame，各自判一次闸门
    await serviceWorker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    });

    // 持续采样一段时间（会重试的断言抓不住一闪而过的东西，见 #832）：主文档
    // 任何时刻至多一条提示、采到过那条说明；子框架任何时刻都没有提示；悬浮球
    // 任何时刻都是未翻译态
    const mainToasts = page.locator(TOAST);
    const frameToasts = frames.map((f) => f.locator(TOAST));
    const seen = new Set<string>();
    let maxMain = 0;
    const end = Date.now() + 3_500;
    for (;;) {
      const visible: string[] = [];
      for (const t of await mainToasts.all()) {
        if (await t.isVisible().catch(() => false)) visible.push(((await t.textContent()) ?? '').trim());
      }
      maxMain = Math.max(maxMain, visible.length);
      visible.forEach((v) => seen.add(v));
      for (const [i, toasts] of frameToasts.entries()) {
        expect(await toasts.count(), `子框架 #f${i + 1} 弹了提示`).toBe(0);
      }
      expect(await ball.getAttribute('data-state')).toBe('idle');
      if (Date.now() >= end) break;
      await page.waitForTimeout(150);
    }
    expect([...seen]).toEqual([message]);
    expect(maxMain).toBe(1);

    expect(await snapshot()).toEqual(before);
    await expect(page.locator('[data-pt], .pt-chunk, [data-pt-split]')).toHaveCount(0);
    expect((await requests()).google).toBe(0);
  });

  test('@core TC-E2E-168: 本地化界面形态的页面（声明是目标语言、开头是目标语言的界面文字、正文是成块外文）上整页翻译，外文段落都出译文（#871）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 与 TC-E2E-164 第 1 步同一份夹具。这一条先把夹具的前提验实 —— 声明确实
    // 是目标语言、开头确实是界面文字，只看声明的旧闸门会整页拦下；前提不成立
    // 的话，“外文段落出译文”什么都没验到
    await seedSettings({ to: 'zh-CN' });
    // 引擎把中文原样还回来、外文加前缀，与真实引擎对目标语言文字的行为一致
    await mockGoogle({ keepCjk: true });
    await gotoFixture('content-foreign');
    const ball = await waitForBall(page);

    // 前提一：声明的语言就是目标语言
    const to = await serviceWorker.evaluate(async () => {
      const stored = await chrome.storage.sync.get('pt-settings');
      return (stored['pt-settings'] as { to: string }).to;
    });
    expect(to).toBe('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', to);
    // 前提二：按文档顺序，页面开头的几块文字全是界面文字（中文，没有拉丁字母），
    // 外文介绍排在它们之后
    const blocks = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent!.trim();
        if (t && n.parentElement?.closest('script, style') == null) out.push(t);
      }
      return out;
    });
    const firstForeign = blocks.findIndex((t) => /[A-Za-z]/.test(t));
    expect(firstForeign).toBeGreaterThanOrEqual(5);
    for (const t of blocks.slice(0, firstForeign)) expect(t).toMatch(/[\u4e00-\u9fff]/);

    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));

    await ball.click();

    // 外文段落全部出译文
    for (const id of ['#en1', '#en2', '#en3', '#en4']) {
      const el = page.locator(id);
      await expect(el).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      const source = (await el.locator('.pt-origin').textContent())!.trim();
      expect(source).toMatch(/^[A-Z]/);
      await expect(el.locator('.pt-trans')).toHaveText(`【译】${source}`);
    }
    await expect(ball).toHaveAttribute('data-state', 'done');
    // 闸门放行了：请求确实发出去，没有弹“本页已经是你的目标语言”
    expect((await requests()).google).toBeGreaterThan(0);
    expect(await page.locator(TOAST).allTextContents()).not.toContain(message);
  });

  test('@core TC-E2E-169: 本地化界面形态的页面整页翻译后，目标语言的界面文字不插译文、不标记为已翻译，被拦下的单元数进汇总提示；还原后整页逐字节回到原样（#872）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 与 TC-E2E-168 同一份夹具。闸门放行之后，页面上本来就是目标语言的界面
    // 文字照样进了采集、送了翻译，引擎原样还回来，由单元级兜底（#783）拦下：
    // 不插译文、不标记为已翻译，结束后汇总成一条提示（#785）
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle({ keepCjk: true });
    await gotoFixture('content-foreign');
    const ball = await waitForBall(page);

    // 整页快照：body 里去掉扩展自己挂的界面宿主（悬浮球、提示）
    const pageHtml = () =>
      page.evaluate(() => {
        const body = document.body.cloneNode(true) as HTMLElement;
        body.querySelectorAll('[id^="pt-host-"]').forEach((el) => el.remove());
        return body.outerHTML;
      });
    const UI = '#menu, #crumbs, #title, #review, #about, #buy';
    const before = await pageHtml();
    const uiBefore = await page.locator(UI).evaluateAll((els) => els.map((el) => el.outerHTML));
    expect(uiBefore).toHaveLength(6);

    await ball.click();

    for (const id of ['#en1', '#en2', '#en3', '#en4']) {
      await expect(page.locator(id)).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    }
    await expect(ball).toHaveAttribute('data-state', 'done');
    // 界面文字：没有译文、没有已翻译标记，一个字不动
    await expect(page.locator('#menu, #crumbs, #title, #review, #about, #buy').locator('.pt-trans')).toHaveCount(0);
    for (const sel of UI.split(', ')) {
      await expect(page.locator(sel)).not.toHaveAttribute('data-pt', /.*/);
      await expect(page.locator(sel).locator('[data-pt]')).toHaveCount(0);
    }
    expect(await page.locator(UI).evaluateAll((els) => els.map((el) => el.outerHTML))).toEqual(uiBefore);
    // 被兜底拦下的单元数进汇总：菜单、面包屑、标题、评测、“关于这款游戏”、
    // “加入购物车”共 6 个单元
    const summary = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastSameAsSource', ['6']));
    const toast = page.locator(TOAST);
    await expect(toast).toHaveText(summary, { timeout: 10_000 });
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute('data-purpose', 'status');

    // 还原：整页逐字节回到原样
    await ball.click();
    await expect(page.locator('[data-pt]')).toHaveCount(0, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await pageHtml()).toBe(before);
  });

  test('@core TC-E2E-170: 纯目标语言页面在内容识别这一级上拦下 —— 零请求、页面逐字节不变、弹出说明、悬浮球是未翻译态，再点一次仍如此（#873）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 与 TC-E2E-153 同一份夹具（#795 造的 same-language.html），但验的不是同一件事：
    // - TC-E2E-153 是在旧判定路径（只看检测语言与语言声明，#791）下立的，夹具
    //   声明 zh-CN，拦下来自声明
    // - 这一条验换了判定来源（#843）之后，拦下来自内容识别这一级：点之前先把
    //   声明改成 en，只看声明的话这一页会照常翻译。仍然零请求、仍然弹说明、
    //   悬浮球仍然是未翻译态，才说明内容识别这一级接住了 #777 的那件事
    // 零请求用替身层自己记的已服务请求数，读之前先认 SW 存活标记：实例中途被
    // 换就以“计数不可信”报错，不会假绿（#766）
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle();
    await gotoFixture('same-language');
    const ball = await waitForBall(page);
    await expect(ball).toHaveAttribute('data-state', 'idle');
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'en'));

    // 整页快照：body 里去掉扩展自己挂的界面宿主（悬浮球、提示）
    const pageHtml = () =>
      page.evaluate(() => {
        const body = document.body.cloneNode(true) as HTMLElement;
        body.querySelectorAll('[id^="pt-host-"]').forEach((el) => el.remove());
        return body.outerHTML;
      });
    const before = await pageHtml();
    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));
    const toast = page.locator(TOAST);

    for (let click = 1; click <= 2; click++) {
      await ball.click();
      // 说明已经是目标语言：状态类，同一时刻只有这一条
      await expect(toast).toHaveText(message, { timeout: 10_000 });
      await expect(toast).toHaveCount(1);
      await expect(toast).toHaveAttribute('data-purpose', 'status');
      // 悬浮球是未翻译态，不是完成态
      await expect(ball).toHaveAttribute('data-state', 'idle');
      // 页面逐字节不变：没有译文、没有已翻译标记，超长段落也没被切成切块
      expect(await pageHtml()).toBe(before);
      await expect(page.locator('[data-pt], .pt-chunk, [data-pt-split]')).toHaveCount(0);
      // 一个翻译请求都没发
      expect((await requests()).google).toBe(0);
      // 等这条说明自己消失，下一次点击的说明才是新弹的
      await expect(toast).toHaveCount(0, { timeout: 10_000 });
    }

    // 计数器没失灵：同一页面上划中那段英文引文，划词照常送翻（#794），计数变成 1
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
    expect(await pageHtml()).toBe(before);
  });
});

test.describe('页面级闸门的外文块判据：三种形状（#893，父 #883）', () => {
  // #889 起识别器拿不准就照常翻译，#891、#892 起翻译单元里有够长的外文单元就
  // 照常翻译、没有且目标语言占优才拦下。三种形状各一条，走真实浏览器里的
  // 本地识别。翻译请求数用替身层自己记的已服务请求数（#766）
  const TOAST = '#pt-host-toast .pt-toast';

  /** 整页快照：body 里去掉扩展自己挂的界面宿主（悬浮球、提示）。 */
  const pageHtml = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const body = document.body.cloneNode(true) as HTMLElement;
      body.querySelectorAll('[id^="pt-host-"]').forEach((el) => el.remove());
      return body.outerHTML;
    });

  test('@core TC-E2E-175: 中文界面加外文正文 —— 外文段落都出译文，不弹“已经是目标语言”，中文界面文字一个字不动（#893）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ to: 'zh-CN' });
    // 引擎把中文原样还回来、外文加前缀：中文界面文字由单元级兜底（#783）拦下
    await mockGoogle({ keepCjk: true });
    await gotoFixture('content-foreign');
    const ball = await waitForBall(page);
    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));
    const ui = page.locator('#menu, #crumbs, #title, #review, #about, #buy');
    const uiBefore = await ui.evaluateAll((els) => els.map((el) => el.outerHTML));

    await ball.click();

    // 闸门没有拦：那条说明在这段时间里一次都没出现过（#832）
    await expectNoToastFor(page.locator(TOAST).filter({ hasText: message }), '不弹“已经是目标语言”');
    for (const id of ['#en1', '#en2', '#en3', '#en4']) {
      const el = page.locator(id);
      await expect(el).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
      const source = await el.locator('.pt-origin').textContent();
      await expect(el.locator('.pt-trans')).toHaveText(`【译】${source!.trim()}`);
    }
    await expect(ball).toHaveAttribute('data-state', 'done');
    expect((await requests()).google).toBeGreaterThan(0);
    expect(await ui.evaluateAll((els) => els.map((el) => el.outerHTML))).toEqual(uiBefore);
  });

  test('@core TC-E2E-176: 纯中文页面（夹一句英文引文）—— 零请求、页面逐字节不变、弹出说明（#893）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // #777 的夹具引了一句 78 字符的英文。一句引文不是成块的外文正文，不能让
    // 整页被当成外文页面（#892 把外文块下限定在 245 就是为了它）
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle();
    await gotoFixture('same-language');
    const ball = await waitForBall(page);
    const before = await pageHtml(page);
    const requests = await mockRequests();
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));
    const toast = page.locator(TOAST);

    await ball.click();

    await expect(toast).toHaveText(message, { timeout: 10_000 });
    await expect(toast).toHaveAttribute('data-purpose', 'status');
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect(await pageHtml(page)).toBe(before);
    await expect(page.locator('[data-pt], .pt-chunk, [data-pt-split]')).toHaveCount(0);
    expect((await requests()).google).toBe(0);
  });

  test('@core TC-E2E-177: 中文内容夹大量英文书名、网址与版本号，声明 en —— 闸门放行（接受的取舍，#898），中文段落由单元级兜底拦下不插译文，还原后逐字节回到原样（#893）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    // 接受的取舍（#898，选项 A：闸门判据冻结在 2.1.114，PR #912 的评审）：
    // 照 #851 实测里 justjavac/free-programming-books-zh_CN 与若依文档首页的形状
    // 造的夹具，真实识别器对全页样本给出 zh 58、en 20、不可靠；最长的三个单元
    // 173 zh、115 zh（不可靠）、108 cy（不可靠），证据不足，闸门放行，整页送翻。
    // #902、#905 实测的真实页面同样如此，换判据救不回来。代价是多花一轮配额：
    // 中文段落由单元级兜底（#783）接住，不插译文、不标记已翻译，页面不会乱。
    // 这条用例钉住的就是这个代价的上限
    await seedSettings({ to: 'zh-CN' });
    // 引擎把不含拉丁字母的文字原样还回来，含拉丁字母的加前缀
    await mockGoogle({ keepCjk: true });
    await gotoFixture('content-zh-book-list');
    const ball = await waitForBall(page);
    const before = await pageHtml(page);
    const requests = await mockRequests();
    const gateMessage = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));

    await ball.click();

    // 闸门放行：送翻了，也没弹“本页已经是目标语言”
    await expect.poll(async () => (await requests()).google, { timeout: 20_000 }).toBeGreaterThan(0);
    await expectNoToastFor(page.locator(TOAST).filter({ hasText: gateMessage }), '闸门放行，不弹闸门的说明');
    // 纯中文的单元由单元级兜底拦下：不插译文、不标记已翻译
    for (const sel of ['#toc', '#lang-list > li:first-child']) {
      const el = page.locator(sel);
      await expect(el.locator('.pt-trans')).toHaveCount(0);
      await expect(el).not.toHaveAttribute('data-pt', 'done');
    }
    // 含英文的单元照常出译文
    await expect(page.locator('#books > li').first()).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });

    // 还原：整页逐字节回到原样
    await ball.click();
    await expect.poll(() => pageHtml(page), { timeout: 10_000 }).toBe(before);
  });
});

test.describe('闸门只管整页翻译：判据换了三轮之后，逐段与划词照旧（#868，父 #831）', () => {
  // 页面级闸门只管整页翻译（#794）。判据从语言声明换成本地内容识别（#843），
  // 又加了外文块（#891）与“最长的几个单元”（#903）两级，这条分工没在新判据下
  // 验过。三条都在同一种页面上：先点整页翻译，确认闸门在真实识别器下命中
  // （零请求、弹说明），再走逐段或划词。引擎把中文原样还回来、外文加前缀，
  // 单元级兜底（#783）才有东西可拦
  const TOAST = '#pt-host-toast .pt-toast';

  /** 点整页翻译，确认闸门命中：弹出“已经是目标语言”、零请求、悬浮球是未翻译态。 */
  async function gateHits(
    page: import('@playwright/test').Page,
    serviceWorker: import('@playwright/test').Worker,
    requests: () => Promise<{ google: number }>,
  ): Promise<string> {
    const ball = await waitForBall(page);
    const message = await serviceWorker.evaluate(() => chrome.i18n.getMessage('toastPageSameLanguage'));
    await ball.click();
    await expect(page.locator(TOAST)).toHaveText(message, { timeout: 10_000 });
    await expect(ball).toHaveAttribute('data-state', 'idle');
    expect((await requests()).google).toBe(0);
    return message;
  }

  /** 让各标签页的 content script 划词翻译这段文字（与右键菜单同一条消息）。 */
  const translateSelection = (serviceWorker: import('@playwright/test').Worker, text: string) =>
    serviceWorker.evaluate(async (t: string) => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:translate-selection', text: t });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    }, text);

  test('@core TC-E2E-178: 闸门命中的页面上，逐段翻译对外文段落照常翻译，只翻这一段（#868）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ to: 'zh-CN', showParagraphBtn: true });
    await mockGoogle({ keepCjk: true });
    await gotoFixture('same-language');
    const requests = await mockRequests();
    await gateHits(page, serviceWorker, requests);
    const others = page.locator('#content > :not(#quote)');
    const othersBefore = await others.evaluateAll((els) => els.map((el) => el.outerHTML));

    const quote = page.locator('#quote');
    const source = (await quote.textContent())!.trim();
    await quote.hover();
    const paraBtn = page.locator('.pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();

    await expect(quote).toHaveAttribute('data-pt', 'done', { timeout: 10_000 });
    await expect(quote.locator('.pt-trans')).toHaveText(`【译】${source}`);
    expect((await requests()).google).toBe(1);
    // 只翻了这一段：其余部分一个字不动
    expect(await others.evaluateAll((els) => els.map((el) => el.outerHTML))).toEqual(othersBefore);
  });

  test('@core TC-E2E-179: 闸门命中的页面上，划词对选中的外文照常翻译，弹出译文（#868）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle({ keepCjk: true });
    await gotoFixture('same-language');
    const requests = await mockRequests();
    const pageMessage = await gateHits(page, serviceWorker, requests);
    const content = () => page.locator('#content').evaluate((el) => el.outerHTML);
    const before = await content();

    const quote = (await page.locator('#quote').textContent())!.trim();
    await translateSelection(serviceWorker, quote);

    const contentToast = page.locator(`${TOAST}[data-purpose="content"]`);
    await expect(contentToast).toHaveText(`【译】${quote}`, { timeout: 20_000 });
    await expect(contentToast).not.toContainText(pageMessage);
    expect((await requests()).google).toBe(1);
    expect(await content()).toBe(before);
  });

  test('@core TC-E2E-180: 闸门命中的页面上，划词选中目标语言的文字 —— 走单元级兜底那条说明（#787），不是闸门的提示（#868）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle({ keepCjk: true });
    await gotoFixture('same-language');
    const requests = await mockRequests();
    const pageMessage = await gateHits(page, serviceWorker, requests);
    const selectionMessage = await serviceWorker.evaluate(() =>
      chrome.i18n.getMessage('toastSelectionSameAsSource'),
    );
    expect(selectionMessage).not.toBe(pageMessage);
    const content = () => page.locator('#content').evaluate((el) => el.outerHTML);
    const before = await content();

    const tip = (await page.locator('#tip').textContent())!.trim();
    await translateSelection(serviceWorker, tip);

    // 划词照常送翻（闸门不管划词），译文与原文相同，单元级兜底换成说明：
    // 状态类，同一时刻只有这一条，闸门那条说明被它替换掉
    const toast = page.locator(TOAST);
    await expect(toast).toHaveText(selectionMessage, { timeout: 20_000 });
    await expect(toast).toHaveAttribute('data-purpose', 'status');
    await expectNoToastFor(toast.filter({ hasText: pageMessage }), '不弹闸门的“本页已经是目标语言”');
    // 原文没有被当成译文弹出来
    await expectNoToastFor(page.locator(`${TOAST}[data-purpose="content"]`), '不把原文当译文弹出');
    expect((await requests()).google).toBe(1);
    expect(await content()).toBe(before);
  });
});

// ================================================================
// 整页翻译结束后告知采集时跳过的段落（#727）
// ================================================================

test.describe('整页翻译结束后告知采集时跳过的段落（#727）', () => {
  const TOAST = '#pt-host-toast .pt-toast';

  test('@core TC-E2E-182: 有段落进不了采集的页面整页翻译后出现带数量与主要原因的提示，数字与夹具一致；正常页面上这条提示一次都没出现过；带多个 iframe 的页面只在主文档弹一条、数字是主文档自己的（#764、#761、#762）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    test.setTimeout(90_000);
    await seedSettings({});
    await mockGoogle();
    const skipped = (n: number) =>
      serviceWorker.evaluate((count: string) => chrome.i18n.getMessage('toastSkippedTooLong', [count]), String(n));
    const toast = page.locator(TOAST);

    // 夹具：三段文字超长、两段标记过密，共 5 段进不了采集，主要是文字超长；
    // 导航里的超长段落（非正文区）与还没显示的标签页里的段落（不可见）不算
    await gotoFixture('skip-summary');
    await translateAndWait(page);
    await expect(toast).toHaveText(await skipped(5), { timeout: 10_000 });
    // 提示不改变翻译行为：正常段落照常有译文，被跳过的段落没有
    for (const id of ['p1', 'p2', 'p3']) await expect(page.locator(`#${id}`)).toHaveAttribute('data-pt', 'done');
    for (const id of ['long1', 'long2', 'long3', 'dense1', 'dense2']) {
      await expect(page.locator(`#${id} .pt-trans`)).toHaveCount(0);
    }

    // 724 那条线留下的维基形态夹具：文字真正超长、不该被翻的那一段，报 1
    await gotoFixture('wiki-article');
    await translateAndWait(page);
    await expect(toast).toHaveText(await skipped(1), { timeout: 10_000 });

    // 正常页面：从整页翻译完成起持续采样，任何提示都没出现过（#761）
    await gotoFixture('basic');
    await translateAndWait(page);
    await expectNoToastFor(toast, '正常页面上不该有跳过提示');

    // 带三个 iframe、每个 frame 各有一段超长段落：popup 的整页翻译广播到全部
    // frame，只有主文档弹一条，数字是主文档自己的 1，不跨 frame 汇总（#762）
    await gotoFixture('skip-frames');
    await waitForBall(page);
    const frames = ['#f1', '#f2', '#f3'].map((id) => page.frameLocator(id));
    for (const frame of frames) await expect(frame.locator('#clong')).toHaveCount(1, { timeout: 10_000 });
    // 子框架的 content script 在 document_idle 注入：等各 frame 加载完再留一点余量
    await page.waitForLoadState('load');
    await page.waitForTimeout(500);
    await serviceWorker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    });
    // 持续采样（会重试的断言抓不住一闪而过的东西，#832）：主文档任何时刻至多
    // 一条、只出现过那一条；子框架任何时刻都没有提示
    const seen = new Set<string>();
    let maxMain = 0;
    let inFrames = 0;
    const end = Date.now() + 4_000;
    while (Date.now() < end) {
      const visible: string[] = [];
      for (const t of await toast.all()) {
        if (await t.isVisible().catch(() => false)) visible.push(((await t.textContent()) ?? '').trim());
      }
      visible.forEach((v) => seen.add(v));
      maxMain = Math.max(maxMain, visible.length);
      for (const frame of frames) inFrames += await frame.locator(TOAST).count();
      await page.waitForTimeout(150);
    }
    expect([...seen]).toEqual([await skipped(1)]);
    expect(maxMain).toBe(1);
    expect(inFrames).toBe(0);
    // 子框架照常翻译
    for (const frame of frames) await expect(frame.locator('#c1')).toHaveAttribute('data-pt', 'done');
  });
});
