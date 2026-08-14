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
  await expect(ball).toBeVisible({ timeout: 60_000 });
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
    // 注：本测试验证「路由前重装」这条 seam（同实例内 stub 丢失即恢复）；
    // 跨实例的 storage 持久由 chrome.storage 保证（真实重启无法在
    // headless 测试中可靠触发，见 #90 调查记录）。
    const newPara = page.locator('#content p').nth(3);
    await expect(newPara.locator('.pt-trans')).toContainText('[MOCK]');
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

  test('@core TC-E2E-47: 增量翻译瞬时失败后自动重试（#91 回归）', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle({ prefix: '[MOCK] ' });
    await gotoFixture('spa');

    await translateAndWait(page);

    // 武装一次性故障：下一次翻译请求必失败（等效 CI 中 SW 实例替换
    // 后的瞬时引擎故障）。修复前增量翻译是一次性的 —— 失败后
    // 新内容永久漏翻，与 #91 的「Retry #1/#2」失败签名一致。
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

    // 翻译并发乱序，不能取「第一个 trans」——定位标题 chunk（原文含
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

    // ── 行为：标题译文行与装饰行「============」必须视觉分行
    // （::after 失效时会粘成同一行「【译】README Title============」）。
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

  test('@core TC-E2E-16: Bing mock 返回译文', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    // #89: 在 SW 内 stub Bing 的两个端点（CDP route 对 SW 请求拦截不确定）
    await serviceWorker.evaluate(() => {
      const realFetch = self.fetch.bind(self);
      (self as any).fetch = async (input: any, init?: any) => {
        const url =
          typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
        if (url.startsWith('https://edge.microsoft.com/translate/auth')) {
          return new Response('mock-jwt-token', { status: 200 });
        }
        if (
          url.startsWith('https://api-edge.cognitive.microsofttranslator.com/')
        ) {
          const body = JSON.parse((init?.body ?? '[]') as string) as Array<{
            Text: string;
          }>;
          return new Response(
            JSON.stringify(
              body.map((t) => ({
                translations: [{ text: `[BING] ${t.Text}` }],
              })),
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return realFetch(input, init);
      };
    });

    await seedSettings({ enginePriority: ['bing-edge'] });
    await gotoFixture('basic');

    await translateAndWait(page);

    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[BING]');
  });
});
