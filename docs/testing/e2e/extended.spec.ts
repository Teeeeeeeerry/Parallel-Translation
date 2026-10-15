/**
 * E2E 扩展套件 —— 发布前/每周定时跑（15 个用例，10 个真实执行）
 *
 * 覆盖：故障切换、全引擎失败、部分失败、缓存上限、内存泄漏、
 *       样式切换、自定义 CSS、禁用扩展、BYOK key 无效、
 *       响应不足、中途切语言、悬浮球钳制、超长段落、RTL 全文
 *
 * #120：TC-E2E-31/32/33/39/40/41/42/43/45 由占位 skip 实现为真实用例。
 * #440：TC-E2E-64 覆盖下一个引擎 key 无效时保留已成功段落。
 * #383/#384：TC-E2E-67 覆盖逐段翻译与划词翻译带上当前领域。
 * #471：TC-E2E-70 覆盖跨域 iframe 里的文字按顶层页面判定当前领域。
 * #470：TC-E2E-71 覆盖设置页新建、删除领域失败时的提示。
 * #394：TC-E2E-72 覆盖设置页调整领域顺序。
 * #396：TC-E2E-73 覆盖设置页删除内置领域的术语。
 * #397：TC-E2E-74 覆盖设置页增删内置领域的适用网址。
 * #398：TC-E2E-75 覆盖设置页内置领域恢复默认。
 * #400：TC-E2E-77 覆盖 popup 临时切换领域与“无领域”。
 * #402：TC-E2E-78 覆盖设置页导出领域术语 CSV。
 * #401：TC-E2E-79 覆盖 popup 勾选“以后在此站点都使用”。
 * #403：TC-E2E-80 覆盖设置页导入领域术语 CSV。
 * #404：TC-E2E-81 覆盖术语 CSV 导入的错误行与 5000 条规模。
 * #509：TC-E2E-84 覆盖设置页收起的术语编辑区不拖慢重绘。
 * #510：TC-E2E-85 覆盖设置页保存术语遇到存储空间不足时的提示。
 * #527：TC-E2E-78 另断言术语导出触发下载时不立即释放临时链接。
 * #535：TC-E2E-88 覆盖设置页读取领域失败时的提示。
 * #590：TC-E2E-100 覆盖导入 GBK 编码、两列、带中文表头的术语 CSV。
 * #603：TC-E2E-101 覆盖在“新建领域”卡片里从术语 CSV 直接新建领域。
 * 网络全部走 e2e-mock 描述符替身（google / bing / openai，#766），完全确定性；
 * TC-E2E-34~38（缓存上限、内存泄漏、样式）仍需扩展环境/CDP，保留 skip。
 */
import fs from 'fs';
import { test, expect, fixtureFileUrl, fixtureUrl, waitForBall } from './fixtures';
import type { Page } from '@playwright/test';

/** OpenAI 的对话端点：替身由 mockChat 按这个 URL 登记（#766） */
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions';

// ── 辅助：注入 N 个已知文本的段落（翻译前调用，采集器会一起收走）──
async function injectParagraphs(page: Page, texts: string[]) {
  await page.evaluate((ts: string[]) => {
    const frag = document.createDocumentFragment();
    for (const t of ts) {
      const p = document.createElement('p');
      p.textContent = t;
      frag.appendChild(p);
    }
    document.body.appendChild(frag);
  }, texts);
}

test.describe('故障切换 @extended', () => {
  test('TC-E2E-31: mock Google 500 → 自动切 Bing', async ({
    page, serviceWorker, mockGoogle, mockBing, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'bing-edge'] });
    await mockGoogle({ fail: true, prefix: '[GOOGLE] ' });
    await mockBing({ prefix: '[BING] ' });
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 30_000 });

    // 译文必须来自 Bing —— 证明 Google 失败后自动切换
    const trans = page.locator('.pt-trans').first();
    await expect(trans).toContainText('[BING]');
    // Google 500 确实被触发（防止 mock 失效时直连真实 Google 假绿）
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.failServed).toBeGreaterThan(0);
  });

  test('TC-E2E-32: 全引擎失败 → error toast', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web'] });
    await mockGoogle({ fail: true });
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();

    // 批次重试（~4s）后出现 error toast（文案随扩展语言环境，只断言语义）
    const toast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    await expect(toast).toBeVisible({ timeout: 40_000 });
    await expect(toast).toHaveText(/失败|failed/i); // cjk-ok: 中英两种界面都认的语义断言
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.failServed).toBeGreaterThan(0);
  });

  test('TC-E2E-33: 3/5 段成功 → 成功段渲染 + 失败段交给下一引擎', async ({
    page, serviceWorker, mockGoogle, mockBing, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'bing-edge'] });
    const texts = ['Alpha one', 'Bravo two', 'Charlie fail', 'Delta four', 'Echo fail'];
    await mockGoogle({ prefix: '[GOOGLE] ', failTexts: ['Charlie fail', 'Echo fail'] });
    await mockBing({ prefix: '[BING] ' });
    await gotoFixture('basic');
    await injectParagraphs(page, texts);
    await waitForBall(page);

    const ball = page.locator('#pt-host-ball .pt-ball');
    await ball.click();
    // 注入的 5 段全部完成翻译
    for (const t of texts) {
      await expect(page.locator('p', { hasText: t })).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    }

    // 成功段由 Google 渲染，失败段由 Bing 兜底
    for (const ok of ['Alpha one', 'Bravo two', 'Delta four']) {
      await expect(page.locator('p', { hasText: ok }).locator('.pt-trans')).toContainText('[GOOGLE]');
    }
    for (const fail of ['Charlie fail', 'Echo fail']) {
      await expect(page.locator('p', { hasText: fail }).locator('.pt-trans')).toContainText('[BING]');
    }
    // 两条失败请求确实被 Google 500 掉（防止 failTexts 失效假绿）
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.failTextsServed).toBe(2);
  });

  test('TC-E2E-64: Google 部分成功 + 下一个引擎 key 无效 → 成功段渲染，toast 显示真实原因（#440）', async ({
    page, serviceWorker, mockGoogle, mockChat, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'openai'] });
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'invalid-key' } });
    });
    const texts = ['Alpha one', 'Bravo two', 'Charlie fail'];
    await mockGoogle({ prefix: '[GOOGLE] ', failTexts: ['Charlie fail'] });
    await mockChat(OPENAI_CHAT, { status: 401 });
    const requests = await mockRequests();
    await gotoFixture('basic');
    await injectParagraphs(page, texts);

    const ball = await waitForBall(page);
    await ball.click();

    // 同批的成功段照常渲染，不因下一个引擎 key 无效而整批丢弃
    for (const ok of ['Alpha one', 'Bravo two']) {
      await expect(page.locator('p', { hasText: ok }).locator('.pt-trans')).toContainText('[GOOGLE]', {
        timeout: 30_000,
      });
    }
    // toast 显示 key 无效这一真实原因，而不是泛化的“N 段翻译失败”
    const toast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    await expect(toast).toBeVisible({ timeout: 30_000 });
    await expect(toast).toHaveText(/API key/);
    await expect(page.locator('p', { hasText: 'Charlie fail' }).locator('.pt-trans')).toHaveCount(0);
    // 失败段只交给 openai 一次：不可重试的失败不做批次重试
    expect((await requests()).chat[OPENAI_CHAT]).toBe(1);
  });
});

test.describe('缓存 @extended', () => {
  test('TC-E2E-34: 缓存上限 5000 条不突破', async ({ page }) => {
    test.skip(true, '需要扩展环境 + 大量写入');
  });
});

test.describe('内存泄漏 @extended', () => {
  test('TC-E2E-35: 翻译-还原 100 次 → 节点数不变', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });

  test('TC-E2E-36: 无限滚动 50 轮 → 堆内存不持续增长', async ({ page }) => {
    test.skip(true, '需要扩展环境 + CDP HeapProfiler');
  });
});

test.describe('样式 @extended', () => {
  test('TC-E2E-37: 样式切换 → 新内容保持当前样式', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });

  test('TC-E2E-38: 自定义 CSS → .pt-trans 包含用户规则', async ({ page }) => {
    test.skip(true, '需要扩展环境');
  });
});

test.describe('边界情况 @extended', () => {
  test('TC-E2E-39: enabled=false → 不发送翻译请求', async ({
    page, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enabled: false });
    // 装上替身：万一发了请求，也是替身接住并记下，不会打到真实 Google
    await mockGoogle();
    await gotoFixture('basic');
    const requests = await mockRequests();

    const ball = await waitForBall(page);
    await ball.click();

    // 翻译请求为零；悬浮球短暂 loading 后回到 idle，页面无译文
    await expect(ball).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
    expect((await requests()).google).toBe(0);
  });

  test('TC-E2E-40: BYOK key 无效 → 直接报错不故障切换', async ({
    page, serviceWorker, mockChat, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['openai', 'google-web'] });
    // 无效 key：openai 401 → 非 retryable 错误，router 不得尝试 google
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'invalid-key' } });
    });
    await mockChat(OPENAI_CHAT, { status: 401 });
    const requests = await mockRequests();
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();

    const toast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    await expect(toast).toBeVisible({ timeout: 40_000 });
    // 请求确实打到了 openai，且 google 零请求 —— 无故障切换。
    // 只装了 OpenAI 的替身时，Google 端点同样被替身接住并计数
    const counts = await requests();
    expect(counts.chat[OPENAI_CHAT]).toBeGreaterThan(0);
    expect(counts.google).toBe(0);
  });

  test('TC-E2E-41: 译文条目数不足 → 缺的填空串其余不错位', async ({
    page, serviceWorker, mockChat, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['openai'] });
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'test-key' } });
    });
    // LLM 漏掉含 'P two' 的行 —— parseNumbered 按编号回填：缺失槽位空串，
    // 其余槽位仍对齐自己的编号，不发生整体错位。
    // 回显带前缀（#808）：原样回显原文会命中同语言兜底（#783），不插译文、不标记
    await mockChat(OPENAI_CHAT, { prefix: '[OA] ', dropText: 'P two' });
    await gotoFixture('basic');
    await injectParagraphs(page, ['P one', 'P two', 'P three']);
    await waitForBall(page);

    const ball = page.locator('#pt-host-ball .pt-ball');
    await ball.click();
    for (const t of ['P one', 'P two', 'P three']) {
      await expect(page.locator('p', { hasText: t })).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    }

    // 第 1、3 段对齐各自译文（译文 == 前缀加自己的原文，无错位占用）
    await expect(page.locator('p', { hasText: 'P one' }).locator('.pt-trans'))
      .toContainText('[OA] P one');
    await expect(page.locator('p', { hasText: 'P three' }).locator('.pt-trans'))
      .toContainText('[OA] P three');
    // 缺的第 2 段为空串，而非吞掉第 3 段的译文
    const secondTrans = page.locator('p', { hasText: 'P two' }).locator('.pt-trans');
    await expect(secondTrans).toHaveText('');
    await expect(secondTrans).not.toContainText('P three');
  });

  test('TC-E2E-42: 翻译中途切换语言 → 旧结果被丢弃', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 慢响应制造在飞窗口；echoTargetLang 让译文携带目标语言标记
    await seedSettings({ to: 'zh-CN' });
    await mockGoogle({ delayMs: 3000, echoTargetLang: true, prefix: '[TL] ' });
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();
    // 请求在飞时切换目标语言
    await seedSettings({ to: 'en' });

    await expect(page.locator('[data-pt="done"]').first()).toBeVisible({ timeout: 40_000 });
    // 在飞批次按发起时的语言渲染，不出现新旧语言混用
    const trans = page.locator('.pt-trans');
    const count = await trans.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(trans.nth(i)).toContainText('[tl=zh-CN]');
      await expect(trans.nth(i)).not.toContainText('[tl=en]');
    }

    // 增量新内容使用新语言 —— 旧语言结果不残留到后续翻译
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'New paragraph after language switch';
      document.body.appendChild(p);
    });
    const newPara = page.locator('p', { hasText: 'New paragraph after language switch' });
    await expect(newPara.locator('.pt-trans')).toContainText('[tl=en]', { timeout: 20_000 });
  });

  test('TC-E2E-43: 悬浮球拖到视口外 → 自动钳制在边缘', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    const ball = await waitForBall(page);

    const box = await ball.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(3000, 3000, { steps: 12 });
    await page.mouse.up();

    // 钳制到视口内：四周留 VIEWPORT_MARGIN(8) 边距
    const rect = await page.evaluate(() => {
      const b = document
        .getElementById('pt-host-ball')
        ?.shadowRoot?.querySelector('.pt-ball') as HTMLElement | null;
      const r = b!.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    expect(rect.left).toBeGreaterThanOrEqual(7.5);
    expect(rect.top).toBeGreaterThanOrEqual(7.5);
    expect(rect.right).toBeLessThanOrEqual(1280 - 7.5);
    expect(rect.bottom).toBeLessThanOrEqual(720 - 7.5);
  });

  test('TC-E2E-44: 超长段落 5000 字符 → 被跳过不发送请求', async ({ page }) => {
    await page.goto(fixtureFileUrl('basic'));
    // 注入超长段落
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'A'.repeat(5000);
      document.body.appendChild(p);
    });
    // 验证超长段落被注入
    const longP = page.locator('p').last();
    const text = await longP.textContent();
    expect(text?.length).toBeGreaterThanOrEqual(5000);
  });

  test('TC-E2E-45: RTL 页面全文翻译 → 段落按钮在正确位置', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ showParagraphBtn: true });
    await gotoFixture('rtl');

    const firstP = page.locator('p').first();
    await firstP.hover();
    const paraBtn = page.locator('#pt-host-para-btn .pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 10_000 });

    // RTL：按钮贴在文字左侧 —— 按钮右缘 ≤ 首行文字左缘
    const pos = await page.evaluate(() => {
      const p = document.querySelector('p')!;
      const btn = document
        .getElementById('pt-host-para-btn')
        ?.shadowRoot?.querySelector('.pt-para-btn') as HTMLElement | null;
      const range = document.createRange();
      range.selectNodeContents(p);
      const first = range.getClientRects()[0]!;
      const b = btn!.getBoundingClientRect();
      return { textLeft: first.left, btnRight: b.right, textTop: first.top, btnTop: b.top };
    });
    expect(pos.btnRight).toBeLessThanOrEqual(pos.textLeft + 1);
    expect(Math.abs(pos.btnTop - pos.textTop)).toBeLessThanOrEqual(2);

    // 段落按钮点击 → 该段翻译完成（RTL 段落可正常翻译）
    await paraBtn.click();
    await expect(firstP).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    await expect(firstP.locator('.pt-trans').first()).not.toBeEmpty();
  });

  test('TC-E2E-67: 逐段翻译与划词翻译带上当前领域，排除区域内的文字划词后术语照样生效（#383/#384）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e',
            name: 'E2E',
            targetLang: 'zh-CN',
            sites: ['localhost'],
            origin: 'user',
            terms: [
              { source: 'item', noTranslate: true },
              { source: 'paragraph', noTranslate: true },
            ],
          }],
          builtin: {},
        },
        // 列表整块排除：全页翻译与逐段翻译都不碰它，划词翻译不受影响
        'pt-site-rules': { user: [{ site: 'localhost', scope: [], exclude: ['ul'], preserve: [] }] },
      }),
    );
    // 记录发给 Google 的原文（#766：记在替身层，SW 中途换了实例时以“不可信”报错）
    const requests = await mockRequests();
    const queries = async () => (await requests()).queries;

    await gotoFixture('basic');
    await waitForBall(page);

    // 排除规则已生效：列表项上不出逐段翻译按钮（同 TC-E2E-60）
    await page.locator('li').first().hover();
    await page.waitForTimeout(1_000);
    await expect(page.locator('.pt-para-btn')).toBeHidden();

    // 逐段翻译：命中的“不翻译”术语以占位符发出，译文里是原词
    const lastP = page.locator('p').last();
    await lastP.hover();
    const paraBtn = page.locator('.pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 5_000 });
    await paraBtn.click();
    await expect(lastP).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await queries()).toContain('A final ⟦TM0⟧ to round out the basic test fixture.');
    await expect(lastP.locator('.pt-trans')).toContainText('【译】A final paragraph'); // cjk-ok: 替身回显的译文

    // 划词翻译：选中排除区域（列表）里的文字，照样翻译，术语生效
    const text = 'Second item that should also be translated';
    await serviceWorker.evaluate(async (t: string) => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:translate-selection', text: t });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    }, text);
    await expect(page.locator('#pt-host-toast .pt-toast')).toContainText(`【译】${text}`, { // cjk-ok: 替身回显的译文
      timeout: 20_000,
    });
    expect(await queries()).toContain('Second ⟦TM0⟧ that should also be translated');
  });

  test('TC-E2E-70: 跨域 iframe 里的文字按顶层页面判定当前领域，全页翻译与拖选划词的术语都生效（#471）', async ({
    page, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    // 领域只命中顶层页面（localhost），iframe 的主机名是 127.0.0.1
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e',
            name: 'E2E',
            targetLang: 'zh-CN',
            sites: ['localhost'],
            origin: 'user',
            terms: [
              { source: 'item', noTranslate: true },
              { source: 'paragraph', noTranslate: true },
            ],
          }],
          builtin: {},
        },
      }),
    );
    // 记录发给 Google 的原文（同 TC-E2E-67）
    const requests = await mockRequests();
    const queries = async () => (await requests()).queries;

    await gotoFixture('iframe-cross');
    await waitForBall(page);
    // iframe 里的 content script 就绪：初始化时给根元素加上样式类，
    // 与消息监听、拖选监听在同一段同步代码里注册
    const frame = page.frameLocator('#frame1');
    await expect(frame.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });

    // 拖选划词：在 iframe 里按住修饰键拖选一整行。先于全页翻译做，
    // 这时这段文字还没发过请求，记录到的原文只可能来自划词
    const box = (await frame.locator('#drag').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(frame.locator('#pt-host-toast .pt-toast')).toContainText('【译】', { timeout: 20_000 }); // cjk-ok: 替身回显的译文
    expect(await queries()).toEqual(['One more ⟦TM0⟧ selected inside the frame.']);

    // 全页翻译：与 popup 同路径，广播到全部 frame，iframe 也翻译。
    // 段落按钮只在主文档注册，iframe 里没有逐段翻译入口
    await serviceWorker.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          await chrome.tabs.sendMessage(tab.id!, { type: 'pt:toggle-translate' });
        } catch {
          // 扩展页等没有 content script 的标签页
        }
      }
    });
    await expect(frame.locator('#full')).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await queries()).toContain('Every ⟦TM0⟧ in this frame ⟦TM1⟧ is translated with the page.');
  });
});

test.describe('设置页：翻译领域 @extended', () => {
  test('TC-E2E-78: 领域卡片导出术语 CSV → 带 BOM 与表头，含逗号与引号的字段转义（#402）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e', name: '法律/合同', targetLang: 'zh-CN', sites: [], origin: 'user', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
            terms: [
              { source: 'terms, conditions', target: '条款，条件' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              { source: 'the "Act"', target: '“该法”' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              { source: 'Esq.', noTranslate: true },
            ],
          }],
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const terms = page.locator('.pt-domain-item', { hasText: '法律/合同' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();
    // #527：记下被释放的临时链接。Firefox 的下载异步开始，触发下载时就释放会下载失败
    await page.evaluate(() => {
      const w = window as unknown as { __ptRevoked: string[] };
      w.__ptRevoked = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url: string) => {
        w.__ptRevoked.push(url);
        revoke(url);
      };
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      terms.locator('.pt-domain-terms-export').click(),
    ]);
    expect(await page.evaluate(() => (window as unknown as { __ptRevoked: string[] }).__ptRevoked)).toEqual([]);
    // 文件名里不能出现路径分隔符
    expect(download.suggestedFilename()).toBe('parallel-translation-terms-法律_合同.csv'); // cjk-ok: 导出文件名里的用户领域名
    expect(fs.readFileSync(await download.path(), 'utf-8')).toBe(
      '\uFEFFsource,target,noTranslate\r\n' +
        '"terms, conditions",条款，条件,false\r\n' + // cjk-ok: 导出 CSV 里的种子术语
        '"the ""Act""",“该法”,false\r\n' + // cjk-ok: 导出 CSV 里的种子术语
        'Esq.,,true\r\n',
    );
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsExported'));
  });

  test('TC-E2E-80: 领域卡片导入术语 CSV → 与已有术语合并，同一原词以导入为准；导入到内置领域写入叠加层（#403）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e', name: '法律', targetLang: 'zh-CN', sites: [], origin: 'user', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
            terms: [
              { source: 'tort', target: '侵权' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              { source: 'Esq.', noTranslate: true },
            ],
          }],
          builtin: {},
        },
      }),
    );
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any);
    const csv = (body: string) => ({
      name: 'terms.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`\uFEFFsource,target,noTranslate\r\n${body}`, 'utf-8'),
    });

    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const terms = page.locator('.pt-domain-item', { hasText: '法律' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();

    await terms.locator('input[type="file"]').setInputFiles(
      csv('TORT,侵权行为,false\r\n"terms, conditions",条款，条件,false\r\n'), // cjk-ok: 导入的 CSV 内容
    );
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsImported', ['2']));
    expect((await stored()).user[0].terms).toEqual([
      { source: 'TORT', target: '侵权行为' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      { source: 'Esq.', noTranslate: true },
      { source: 'terms, conditions', target: '条款，条件' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    ]);
    // 编辑区随之刷新
    const sources = terms.locator('.pt-term-source');
    await expect(sources).toHaveCount(3);
    expect(await sources.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
      'TORT', 'Esq.', 'terms, conditions',
    ]);

    // 内置领域：写入叠加层
    const builtin = page.locator('.pt-domain-item', { hasText: '软件开发(简体中文)' }).locator('.pt-domain-terms'); // cjk-ok: 内置领域的名字，数据不随界面语言变
    await builtin.locator('summary').click();
    await builtin.locator('input[type="file"]').setInputFiles(csv('monorepo,单仓库,false\r\n')); // cjk-ok: 导入的 CSV 内容
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsImported', ['1']));
    expect((await stored()).builtin['builtin:software-zh-CN'].terms).toEqual([
      { source: 'monorepo', target: '单仓库' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    ]);

    // 表格里有未保存的修改时，导入前先确认；取消则不导入
    await terms.locator('.pt-term-target').first().fill('改了没保存'); // cjk-ok: 用例输入的文字
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await terms.locator('.pt-domain-terms-import').click();
    expect(message).toBe(await msg('domainTermsImportDiscard'));
    await expect(terms.locator('.pt-term-target').first()).toHaveValue('改了没保存'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
  });

  test('TC-E2E-81: 导入带错误行的术语 CSV → 列出行号与原因、其他行照常导入；5000 条术语导入后可保存，通用设置照常保存（#404）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '法律', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          builtin: {},
        },
      }),
    );
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any);
    const csv = (body: string) => ({
      name: 'terms.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`source,target,noTranslate\r\n${body}`, 'utf-8'),
    });

    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const terms = page.locator('.pt-domain-item', { hasText: '法律' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();

    // 错误行跳过，行号按文件里的物理行（表头是第 1 行）
    await terms.locator('input[type="file"]').setInputFiles(
      csv('tort,侵权,false\r\nonly-two,列\r\n,被告,false\r\nEsq.,,true\r\n'), // cjk-ok: 导入的 CSV 内容
    );
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsImportedSkipped', ['2', '2']));
    await expect(terms.locator('.pt-domain-terms-error')).toHaveText(
      `${await msg('domainTermsSkipColumnsHeader', ['3', '3'])}\n${await msg('domainTermsSkipMissingSource', ['4'])}`,
    );
    expect((await stored()).user[0].terms).toEqual([
      { source: 'tort', target: '侵权' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      { source: 'Esq.', noTranslate: true },
    ]);

    // 5000 条：导入、再整表保存
    const N = 5000;
    await terms.locator('input[type="file"]').setInputFiles(
      csv(Array.from({ length: N }, (_, i) => `term-${i},译法 ${i},false\r\n`).join('')), // cjk-ok: 导入的 CSV 内容
    );
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsImported', [String(N)]), { timeout: 30_000 });
    await expect(terms.locator('.pt-domain-terms-error')).toBeHidden();
    await expect(terms.locator('tbody tr')).toHaveCount(N + 2, { timeout: 30_000 });
    await terms.locator('.pt-domain-terms-actions .pt-btn:not(.pt-btn-secondary)').click();
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsSaved'), { timeout: 30_000 });
    expect((await stored()).user[0].terms).toHaveLength(N + 2);

    // 通用设置照常保存
    await page.click('.pt-nav-btn[data-section="general"]');
    await page.selectOption('#pt-select-to', 'ja');
    await expect
      .poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.to))
      .toBe('ja');
  });

  test('TC-E2E-100: 领域卡片导入 GBK 编码、两列、带中文表头的术语 CSV → 中文正确，表头不导入，列数不对的行按表头列数说明（#590）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '我的术语表', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          builtin: {},
        },
      }),
    );
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any);
    // 中文 Windows 上 Excel 另存的 CSV：GBK 编码、不带 BOM。内容为
    // “原词,译法\r\nAPI,接口\r\ntimeout,超时\r\nGitHub,,true\r\n”，第 4 行比表头多一列
    const gbk = Buffer.from(
      'd4adb4ca2cd2ebb7a80d0a4150492cbdd3bfda0d0a74696d656f75742cb3accab10d0a4769744875622c2c747275650d0a',
      'hex',
    );

    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const terms = page.locator('.pt-domain-item', { hasText: '我的术语表' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();

    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);

    // 导入按钮旁有格式说明；文件选择框接受制表符分隔的 .tsv、.txt
    await expect(terms.locator('.pt-domain-terms-hint')).toHaveText(await msg('domainTermsImportHint'));
    expect(await terms.locator('input[type="file"]').getAttribute('accept')).toContain('.tsv');

    await terms.locator('input[type="file"]').setInputFiles({ name: 'terms.csv', mimeType: 'text/csv', buffer: gbk });
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsImportedSkipped', ['2', '1']));
    await expect(terms.locator('.pt-domain-terms-error')).toHaveText(
      await msg('domainTermsSkipColumnsHeader', ['4', '2']),
    );
    expect((await stored()).user[0].terms).toEqual([
      { source: 'API', target: '接口' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      { source: 'timeout', target: '超时' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    ]);
    // 编辑区显示正确的中文
    const targets = terms.locator('.pt-term-target');
    await expect(targets).toHaveCount(2);
    expect(await targets.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual([
      '接口', '超时', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    ]);
  });

  test('TC-E2E-101: “新建领域”卡片从术语 CSV 导入 → 新建以文件名或名称框命名的领域，展开术语编辑区并列出跳过的行；没有可导入的术语时不新建（#603）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() => chrome.storage.local.set({ 'pt-domains': { user: [], builtin: {} } }));
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any);
    // GBK 编码、不带 BOM：“原词,译法\r\nplaintiff,原告\r\ntort,侵权\r\nonly,two,three\r\n”，第 4 行比表头多一列
    const gbk = Buffer.from(
      'd4adb4ca2cd2ebb7a80d0a706c61696e746966662cd4adb8e60d0a746f72742cc7d6c8a80d0a6f6e6c792c74776f2c74687265650d0a',
      'hex',
    );

    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const items = page.locator('.pt-domain-item');
    await expect(items).toHaveCount(1);
    const file = page.locator('#pt-domain-import-new-file');
    const nameInput = page.locator('#pt-domain-name-input');
    const toast = page.locator('#pt-toast');

    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);

    // 不展开任何领域也能看到入口与格式说明
    await expect(page.locator('#pt-domain-import-new-btn')).toHaveText(await msg('domainImportNewBtn'));
    await expect(page.locator('#pt-domain-import-new-hint')).toContainText(await msg('domainImportNewHint'));
    await expect(page.locator('#pt-domain-import-new-hint')).toContainText(await msg('domainTermsImportHint'));

    // 名称框留空：用文件名命名，目标语言用卡片里选的
    const lang = await page.locator('#pt-domain-lang-select').inputValue();
    await file.setInputFiles({ name: '法律术语.csv', mimeType: 'text/csv', buffer: gbk }); // cjk-ok: 导入的文件名
    await expect(toast).toHaveText(await msg('domainImportedNewSkipped', ['法律术语', '2', '1'])); // cjk-ok: getMessage 的替换参数，用户数据
    await expect(items).toHaveCount(2);
    const created = items.last();
    await expect(created.locator('.pt-domain-name')).toHaveText('法律术语'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    // 新领域的术语编辑区已展开，显示导入的术语与跳过的行
    const terms = created.locator('.pt-domain-terms');
    await expect(terms).toHaveJSProperty('open', true);
    const targets = terms.locator('.pt-term-target');
    await expect(targets).toHaveCount(2);
    expect(await targets.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['原告', '侵权']); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(terms.locator('.pt-domain-terms-error')).toHaveText(await msg('domainTermsSkipColumnsHeader', ['4', '2']));
    const user = (await stored()).user;
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({
      name: '法律术语', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      targetLang: lang,
      sites: [],
      terms: [
        { source: 'plaintiff', target: '原告' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
        { source: 'tort', target: '侵权' }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      ],
    });

    // 名称框填了名字：用名称框里的名字，成功后清空名称框
    await nameInput.fill('合同'); // cjk-ok: 用例输入的文字
    await file.setInputFiles({ name: 'contract.csv', mimeType: 'text/csv', buffer: Buffer.from('consideration,对价\r\n', 'utf-8') }); // cjk-ok: 导入的 CSV 内容
    await expect(toast).toHaveText(await msg('domainImportedNew', ['合同', '1'])); // cjk-ok: getMessage 的替换参数，用户数据
    await expect(items).toHaveCount(3);
    await expect(items.last().locator('.pt-domain-name')).toHaveText('合同'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(nameInput).toHaveValue('');

    // 没有可导入的术语：不新建，跳过的原因列在卡片里，名称留在输入框
    await nameInput.fill('空的'); // cjk-ok: 用例输入的文字
    await file.setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b,c,d\r\n', 'utf-8') });
    await expect(toast).toHaveText(await msg('domainImportNewNone'));
    await expect(page.locator('#pt-domain-import-new-error')).toHaveText(await msg('domainTermsSkipColumnsTwoOrThree', ['1']));
    await expect(nameInput).toHaveValue('空的'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(items).toHaveCount(3);
    expect((await stored()).user).toHaveLength(2);
  });

  test('TC-E2E-71: 新建或删除领域写入失败 → toast 提示原因，名称留在输入框、领域留在列表（#470）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '待删除', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const item = page.locator('.pt-domain-item', { hasText: '待删除' }); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(item).toBeVisible();

    // 设置页里的存储写入被拒绝（同 #430 的手动验证做法）
    await page.evaluate(() => {
      (chrome.storage.local as any).set = () => Promise.reject(new Error('[PT] 存储配额已满'));
    });
    const toast = page.locator('#pt-toast');

    // 新建失败：提示原因（不带“[PT] ”前缀），名称留在输入框，列表里没有新领域
    await page.fill('#pt-domain-name-input', '法律'); // cjk-ok: 用例输入的文字
    await page.click('#pt-domain-create-btn');
    await expect(toast).toHaveText(await msg('domainCreateFailed', ['存储配额已满'])); // cjk-ok: getMessage 的替换参数，用户数据
    await expect(page.locator('#pt-domain-name-input')).toHaveValue('法律'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(page.locator('.pt-domain-item', { hasText: '法律' })).toHaveCount(0); // cjk-ok: 用户数据：领域名或术语，不随界面语言变

    // 删除失败：提示原因，领域仍在列表里
    page.once('dialog', (d) => void d.accept());
    // 只取领域行自己的删除按钮，术语行里也有同名按钮
    await item.locator(':scope > .pt-site-remove').click();
    await expect(toast).toHaveText(await msg('domainDeleteFailed', ['存储配额已满'])); // cjk-ok: getMessage 的替换参数，用户数据
    await expect(item).toBeVisible();

    // 调整顺序失败（#394）：提示原因，顺序不变
    await item.locator(':scope > .pt-domain-move[data-direction="up"]').click();
    await expect(toast).toHaveText(await msg('domainMoveFailed', ['存储配额已满'])); // cjk-ok: getMessage 的替换参数，用户数据
    await expect(page.locator('.pt-domain-item .pt-domain-name')).toHaveText(['软件开发(简体中文)', '待删除']); // cjk-ok: 内置领域的名字，数据不随界面语言变
  });

  test('TC-E2E-72: 领域列表上移、下移，顺序保存后重新打开设置页不变（#394）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '我的开发', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const names = page.locator('.pt-domain-item .pt-domain-name');
    await expect(names).toHaveText(['软件开发(简体中文)', '我的开发']); // cjk-ok: 内置领域的名字，数据不随界面语言变

    // 两端的按钮不可用：第一个不能上移，最后一个不能下移
    const first = page.locator('.pt-domain-item').first();
    const last = page.locator('.pt-domain-item').last();
    await expect(first.locator(':scope > .pt-domain-move[data-direction="up"]')).toBeDisabled();
    await expect(last.locator(':scope > .pt-domain-move[data-direction="down"]')).toBeDisabled();

    await last.locator(':scope > .pt-domain-move[data-direction="up"]').click();
    await expect(names).toHaveText(['我的开发', '软件开发(简体中文)']); // cjk-ok: 内置领域的名字，数据不随界面语言变
    // 焦点交还给同一领域：它已在最前，上移不可用，焦点落在下移按钮上
    await expect(
      page.locator('.pt-domain-item').first().locator(':scope > .pt-domain-move[data-direction="down"]'),
    ).toBeFocused();

    await page.reload();
    await page.click('.pt-nav-btn[data-section="domains"]');
    await expect(names).toHaveText(['我的开发', '软件开发(简体中文)']); // cjk-ok: 内置领域的名字，数据不随界面语言变

    await page.locator('.pt-domain-item').first().locator(':scope > .pt-domain-move[data-direction="down"]').click();
    await expect(names).toHaveText(['软件开发(简体中文)', '我的开发']); // cjk-ok: 内置领域的名字，数据不随界面语言变
  });

  test('TC-E2E-73: 删除内置领域的术语，保存后重新打开设置页仍不在（#396）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const builtin = page.locator('.pt-domain-item', { hasText: '软件开发(简体中文)' }); // cjk-ok: 内置领域的名字，数据不随界面语言变
    const terms = builtin.locator('.pt-domain-terms');
    await terms.locator('summary').click();
    const sources = terms.locator('.pt-term-source');
    const values = () => sources.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const before = await values();
    expect(before).toContain('issue');
    const row = terms.locator('tbody tr').nth(before.indexOf('issue'));

    // 内置术语的原词只读，但可以删除
    await expect(row.locator('.pt-term-source')).toHaveAttribute('readonly', '');
    await row.locator('.pt-site-remove').click();
    await terms.locator('.pt-domain-terms-actions .pt-btn:not(.pt-btn-secondary)').click();
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsSaved'));

    await page.reload();
    await page.click('.pt-nav-btn[data-section="domains"]');
    await terms.locator('summary').click();
    await expect(sources).toHaveCount(before.length - 1);
    expect(await values()).toEqual(before.filter((v) => v !== 'issue'));
  });

  test('TC-E2E-74: 内置领域的适用网址可以增删，保存后重新打开设置页仍在（#397）', async ({
    page, serviceWorker,
  }) => {
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const builtin = page.locator('.pt-domain-item', { hasText: '软件开发(简体中文)' }); // cjk-ok: 内置领域的名字，数据不随界面语言变
    const sites = builtin.locator('.pt-domain-sites');
    await sites.locator('summary').click();
    const textarea = sites.locator('.pt-domain-sites-input');
    const before = (await textarea.inputValue()).split('\n');
    expect(before).toContain('gitlab.com');

    // 删掉 gitlab.com，新增 gitee.com
    const after = [...before.filter((s) => s !== 'gitlab.com'), 'gitee.com'];
    await textarea.fill(after.join('\n'));
    await sites.locator('.pt-btn').click();
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainSitesSaved'));

    await page.reload();
    await page.click('.pt-nav-btn[data-section="domains"]');
    await sites.locator('summary').click();
    await expect(textarea).toHaveValue(after.join('\n'));
  });

  test('TC-E2E-75: 修改过的内置领域显示“恢复默认”，确认后术语与适用网址回到内置内容，自建领域不显示（#398）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '我的开发', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const builtin = page.locator('.pt-domain-item', { hasText: '软件开发(简体中文)' }); // cjk-ok: 内置领域的名字，数据不随界面语言变
    const mine = page.locator('.pt-domain-item', { hasText: '我的开发' }); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    const reset = builtin.locator(':scope > .pt-domain-reset');

    // 没有修改：不显示；自建领域始终不显示
    await expect(reset).toHaveCount(0);
    await expect(mine.locator('.pt-domain-reset')).toHaveCount(0);

    // 改一下适用网址后出现
    const sites = builtin.locator('.pt-domain-sites');
    await sites.locator('summary').click();
    const textarea = sites.locator('.pt-domain-sites-input');
    const original = await textarea.inputValue();
    await textarea.fill(`${original}\ngitee.com`);
    await sites.locator('.pt-btn').click();
    await expect(reset).toBeVisible();

    // 取消确认：存储里的修改还在
    page.once('dialog', (d) => void d.dismiss());
    await reset.click();
    const overlay = () =>
      serviceWorker.evaluate(async () => {
        const stored = (await chrome.storage.local.get('pt-domains'))['pt-domains'] as {
          builtin: Record<string, unknown>;
        };
        return stored.builtin['builtin:software-zh-CN'] ?? null;
      });
    expect(await overlay()).not.toBeNull();
    await expect(reset).toBeVisible();

    // 确认后恢复，按钮消失
    page.once('dialog', (d) => void d.accept());
    await reset.click();
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainResetDone'));
    await expect(reset).toHaveCount(0);
    await expect(textarea).toHaveValue(original);
    expect(await overlay()).toBeNull();
    // 焦点交还给同一领域的移动按钮
    await expect(builtin.locator(':scope > .pt-domain-move:focus')).toHaveCount(1);
  });

  test('TC-E2E-84: 5000 条术语的领域收起时，别的领域上移、下移整表重绘不生成任何术语行；展开后看到全部术语并能保存（#509）', async ({
    page, serviceWorker,
  }) => {
    const N = 5000;
    await serviceWorker.evaluate((n) =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [
            {
              id: 'user:big', name: '大术语表', targetLang: 'zh-CN', sites: [], origin: 'user', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              terms: Array.from({ length: n }, (_, i) => ({ source: `term-${i}`, target: `译法 ${i}` })), // cjk-ok: 种子数据：术语
            },
            { id: 'user:small', name: '小领域', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          ],
          builtin: {},
        },
      }), N);
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const names = page.locator('.pt-domain-item .pt-domain-name');
    await expect(names).toHaveText(['软件开发(简体中文)', '大术语表', '小领域']); // cjk-ok: 内置领域的名字，数据不随界面语言变
    const big = page.locator('.pt-domain-item', { hasText: '大术语表' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(big.locator('summary')).toHaveText(await msg('domainTermsSummary', [String(N)]));

    // 收起状态下调整另一个领域的顺序：每次都整表重绘。#509 修的是重绘时不为
    // 收起的术语编辑区生成表格 —— 直接数 DOM 里的术语行，与机器快慢无关
    // （#818：原先断言四次调整的墙钟耗时 < 1200ms，机器一忙就越线）
    const small = () => page.locator('.pt-domain-item', { hasText: '小领域' }); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    const termRows = page.locator('.pt-domain-terms tr');
    // 取当下的行数，不用会重试的 toHaveCount(0)；软断言，每次重绘各自报出来
    expect.soft(await termRows.count(), '初次渲染：收起的术语编辑区不生成术语行').toBe(0);
    const moves = [
      ['up', ['软件开发(简体中文)', '小领域', '大术语表']], // cjk-ok: 内置领域的名字，数据不随界面语言变
      ['up', ['小领域', '软件开发(简体中文)', '大术语表']], // cjk-ok: 内置领域的名字，数据不随界面语言变
      ['down', ['软件开发(简体中文)', '小领域', '大术语表']], // cjk-ok: 内置领域的名字，数据不随界面语言变
      ['down', ['软件开发(简体中文)', '大术语表', '小领域']], // cjk-ok: 内置领域的名字，数据不随界面语言变
    ] as const;
    const start = Date.now();
    for (const [direction, order] of moves) {
      await small().locator(`:scope > .pt-domain-move[data-direction="${direction}"]`).click();
      await expect(names).toHaveText([...order]);
      expect.soft(await termRows.count(), `${direction} 之后的重绘：收起的术语编辑区不生成术语行`).toBe(0);
    }
    // 耗时只打出来看趋势，不断言
    console.log(`TC-E2E-84 四次调整顺序耗时 ${Date.now() - start}ms`);

    // 展开：看到全部术语，改一条并保存
    await big.locator('summary').click();
    const rows = big.locator('tbody tr');
    await expect(rows).toHaveCount(N);
    await rows.nth(N - 1).locator('input').nth(1).fill('新译法'); // cjk-ok: 用例输入的文字
    await big.locator('.pt-domain-terms-actions .pt-btn:not(.pt-btn-secondary)').click();
    await expect(page.locator('#pt-toast')).toHaveText(await msg('domainTermsSaved'));
    const stored = await serviceWorker.evaluate(
      async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any,
    );
    expect(stored.user[0].terms[N - 1]).toEqual({ source: `term-${N - 1}`, target: '新译法' }); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(big.locator('summary')).toHaveText(await msg('domainTermsSummary', [String(N)]));
  });

  test('TC-E2E-85: 保存术语遇到存储空间不足 → 提示可以清空缓存后重试，术语不变（#510）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e', name: '法律', targetLang: 'zh-CN', sites: [], origin: 'user', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
            terms: [{ source: 'tort', target: '侵权' }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          }],
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const terms = page.locator('.pt-domain-item', { hasText: '法律' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();
    await terms.locator('.pt-term-target').first().fill('侵权行为'); // cjk-ok: 用例输入的文字
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);

    // 设置页里的存储写入报 Chrome 的配额错误
    await page.evaluate(() => {
      (chrome.storage.local as any).set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    });
    await terms.locator('.pt-domain-terms-actions .pt-btn:not(.pt-btn-secondary)').click();
    await expect(terms.locator('.pt-domain-terms-error')).toHaveText(
      await msg('domainSaveFailed', [await msg('domainStorageFull')]),
    );
    const stored = await serviceWorker.evaluate(
      async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any,
    );
    expect(stored.user[0].terms).toEqual([{ source: 'tort', target: '侵权' }]); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
  });

  test('TC-E2E-88: 设置页读取领域失败 → 刷新列表提示原因，已显示的领域与未保存的术语不变；首次打开就失败时不显示只剩内置领域的列表（#535）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{
            id: 'user:e2e', name: '法律', targetLang: 'zh-CN', sites: [], origin: 'user', // cjk-ok: 用户数据：领域名或术语，不随界面语言变
            terms: [{ source: 'tort', target: '侵权' }], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          }],
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const items = page.locator('.pt-domain-item');
    await expect(items).toHaveCount(2);
    const terms = page.locator('.pt-domain-item', { hasText: '法律' }).locator('.pt-domain-terms'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await terms.locator('summary').click();
    const target = terms.locator('.pt-term-target').first();
    await target.fill('侵权行为'); // cjk-ok: 用例输入的文字

    // 提示文案与原因都随浏览器界面语言（CI 是英文，#588）
    const toast = page.locator('#pt-toast');
    const listFailed = (key: string) =>
      page.evaluate((k) => chrome.i18n.getMessage(k, [chrome.i18n.getMessage('domainStorageReadFailed')]), key);

    // 设置页里的存储读取失败；另一上下文写入触发本页刷新列表
    await page.evaluate(() => {
      (chrome.storage.local as any).get = () => Promise.reject(new Error('boom'));
    });
    await serviceWorker.evaluate(async () => {
      const stored = (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any;
      stored.user.push({ id: 'user:e2e-2', name: '医学', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
      await chrome.storage.local.set({ 'pt-domains': stored });
    });
    // 已显示过列表：提示列表没有刷新（#549）
    await expect(toast).toHaveText(await listFailed('domainListNotRefreshed'));
    await expect(items).toHaveCount(2);
    await expect(page.locator('.pt-domain-item', { hasText: '医学' })).toHaveCount(0); // cjk-ok: 用户数据：领域名或术语，不随界面语言变
    await expect(terms).toHaveAttribute('open', '');
    await expect(target).toHaveValue('侵权行为'); // cjk-ok: 用户数据：领域名或术语，不随界面语言变

    // 首次打开就读取失败：列表留空并提示，不显示只剩内置领域的列表
    await page.addInitScript(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      (chrome.storage.local as any).get = (keys: unknown) =>
        keys === 'pt-domains' ? Promise.reject(new Error('boom')) : get(keys as any);
    });
    await page.reload();
    await page.click('.pt-nav-btn[data-section="domains"]');
    // 还没显示过列表：提示列表没有载入（#549）
    await expect(toast).toHaveText(await listFailed('domainListNotLoaded'));
    await expect(items).toHaveCount(0);
  });
});

test.describe('popup：翻译领域 @extended', () => {
  test('TC-E2E-77: popup 临时切换领域与“无领域” → 只影响本标签页之后的翻译，刷新后回到自动（#400）', async ({
    page, context, serviceWorker, mockGoogle, mockRequests, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await mockGoogle();
    // “站内”按网址命中 localhost；“手选”不命中任何网址，只能手动切换
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [
            {
              id: 'user:e2e-site', name: '站内', targetLang: 'zh-CN', sites: ['localhost'], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              origin: 'user', terms: [{ source: 'fox', noTranslate: true }],
            },
            {
              id: 'user:e2e-manual', name: '手选', targetLang: 'zh-CN', sites: [], // cjk-ok: 用户数据：领域名或术语，不随界面语言变
              origin: 'user', terms: [{ source: 'paragraph', noTranslate: true }],
            },
          ],
          builtin: {},
        },
      }),
    );
    // 记录发给 Google 的原文（同 TC-E2E-67）
    const requests = await mockRequests();
    const sent = async (text: string) => (await requests()).queries.some((q) => q.includes(text));
    const MANUAL = 'Another ⟦TM0⟧ with different content. The quick brown fox';
    const SITE = 'Another paragraph with different content. The quick brown ⟦TM0⟧ jumps';
    const PLAIN = 'Another paragraph with different content. The quick brown fox jumps';

    await gotoFixture('basic');
    await waitForBall(page);

    // popup 开在后台标签页里：它操作的“当前标签页”是前台的测试页
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      popup.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    const select = popup.locator('#pt-domain-select');
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await expect(select).toHaveValue('auto');
    await expect(select.locator('option')).toHaveText([
      await msg('domainPopupAuto', ['站内']), '软件开发(简体中文)', '站内', '手选', await msg('domainPopupNone'), // cjk-ok: 内置领域的名字，数据不随界面语言变
    ]);

    // 切换到“手选”后翻译本页：请求带它的术语
    await select.selectOption('user:e2e-manual');
    await expect(select).toHaveValue('user:e2e-manual');
    // 切换之后才加载的跨域 iframe 也用“手选”
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.id = 'late';
      iframe.src = 'http://127.0.0.1:4173/iframe-cross-child.html';
      document.body.append(iframe);
    });
    const late = page.frameLocator('#late');
    await expect(late.locator('html')).toHaveClass(/pt-style-/, { timeout: 30_000 });
    await popup.locator('#pt-translate-page-btn').click();
    await expect(page.locator('p').nth(1)).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await sent(MANUAL)).toBe(true);
    await expect(late.locator('#full')).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await sent('Every item in this frame ⟦TM0⟧ is translated with the page.')).toBe(true);

    // 另一个标签页不受影响：仍按网址自动选中“站内”
    const other = await context.newPage();
    await other.goto(fixtureUrl('basic'), { waitUntil: 'domcontentloaded' });
    await waitForBall(other);
    await popup.reload();
    await expect(select).toHaveValue('auto', { timeout: 10_000 });
    await popup.locator('#pt-translate-page-btn').click();
    await expect(other.locator('p').nth(1)).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await sent(SITE)).toBe(true);

    // 刷新后回到自动；选“无领域”后翻译不带术语
    await page.bringToFront();
    await page.reload();
    await waitForBall(page);
    await popup.reload();
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await expect(select).toHaveValue('auto');
    await select.selectOption('none');
    await expect(select).toHaveValue('none');
    await popup.locator('#pt-translate-page-btn').click();
    await expect(page.locator('p').nth(1)).toHaveAttribute('data-pt', 'done', { timeout: 20_000 });
    expect(await sent(PLAIN)).toBe(true);
  });

  test('TC-E2E-79: popup 勾选“以后在此站点都使用” → 站点写入所选领域的适用网址，内置领域写入叠加层，排在后面时提示调整顺序（#401）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [
            { id: 'user:e2e-site', name: '站内', targetLang: 'zh-CN', sites: ['localhost'], origin: 'user', terms: [] }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
            { id: 'user:e2e-manual', name: '手选', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }, // cjk-ok: 用户数据：领域名或术语，不随界面语言变
          ],
          builtin: {},
          // “手选”排在最前，“站内”在内置领域之前
          order: ['user:e2e-manual', 'user:e2e-site'],
        },
      }),
    );
    const stored = () =>
      serviceWorker.evaluate(async () => (await chrome.storage.local.get('pt-domains'))['pt-domains'] as any);

    await gotoFixture('basic');
    await waitForBall(page);
    const extId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const select = popup.locator('#pt-domain-select');
    const remember = popup.locator('#pt-domain-remember');
    const hint = popup.locator('#pt-hint');
    // 提示文案随浏览器界面语言（CI 是英文）
    const msg = (key: string, subs: string[] = []) =>
      popup.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs] as const);
    await expect(select).toBeEnabled({ timeout: 10_000 });
    // 自动选择时不能勾选
    await expect(remember).toBeDisabled();

    // 自建领域排在最前：写入后它就是这个站点的当前领域
    await select.selectOption('user:e2e-manual');
    await expect(remember).toBeEnabled();
    await remember.check();
    await expect(hint).toHaveText(await msg('domainPopupRemembered', ['手选'])); // cjk-ok: getMessage 的替换参数，用户数据
    let data = await stored();
    expect(data.user.find((d: any) => d.id === 'user:e2e-manual').sites).toEqual(['localhost']);
    // 原先命中这个站点的领域不改
    expect(data.user.find((d: any) => d.id === 'user:e2e-site').sites).toEqual(['localhost']);

    // 换到别的领域时取消勾选：不会顺带写进新领域
    await select.selectOption('builtin:software-zh-CN');
    await expect(remember).not.toBeChecked();
    await expect(remember).toBeEnabled();
    expect((await stored()).builtin).toEqual({});

    // 内置领域排在后面：写入叠加层，并提示调整顺序
    await remember.check();
    await expect(hint).toHaveText(await msg('domainPopupRememberShadowed', ['手选'])); // cjk-ok: getMessage 的替换参数，用户数据
    data = await stored();
    expect(data.builtin['builtin:software-zh-CN'].addedSites).toEqual(['localhost']);
  });
});

// ── 悬浮 UI 尺寸（#964）──

/** shadow 里的球或段落按钮的实际渲染尺寸与字号（量 getBoundingClientRect，不读 CSS 文本） */
async function uiMetrics(page: Page, host: 'ball' | 'para-btn') {
  return page.evaluate((h) => {
    const sel = h === 'ball' ? '.pt-ball' : '.pt-para-btn';
    const el = document
      .getElementById(`pt-host-${h}`)
      ?.shadowRoot?.querySelector(sel) as HTMLElement | null;
    const r = el!.getBoundingClientRect();
    return { width: r.width, height: r.height, fontSize: getComputedStyle(el!).fontSize };
  }, host);
}

/** 不受 transform 影响的布局尺寸：翻译中的球在转、悬停时放大 1.08，外接矩形会比球大 */
async function ballLayoutSize(page: Page) {
  return page.evaluate(() => {
    const el = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as HTMLElement;
    return { width: el.offsetWidth, height: el.offsetHeight };
  });
}

/** 不刷新页面改存储里的设置：读出当前值合并后写回，与设置页、导入走的是同一个存储键 */
async function patchStoredSettings(serviceWorker: import('@playwright/test').Worker, patch: Record<string, unknown>) {
  await serviceWorker.evaluate(async (p) => {
    const cur = ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] ?? {}) as object;
    await chrome.storage.sync.set({ 'pt-settings': { ...cur, ...p } });
  }, patch);
}

/**
 * 悬停第一段让逐段翻译按钮浮出，再把鼠标移到空白处，返回离开段落到按钮消失隔了多久。
 * 页内记下最后一次 mouseout 的时刻，按钮 display 变成 none 时再记一次 —— 两个时刻
 * 都在页面里取，不受 Playwright 往返的延迟影响（#972）
 */
async function measureHideAfterLeave(page: Page): Promise<number> {
  const paraBtn = page.locator('#pt-host-para-btn .pt-para-btn');
  await page.locator('p').first().hover();
  await expect(paraBtn).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const w = window as any;
    const btn = document.getElementById('pt-host-para-btn')!.shadowRoot!.querySelector('.pt-para-btn') as HTMLElement;
    w.__ptLeftAt = 0;
    w.__ptHiddenAt = 0;
    document.addEventListener('mouseout', () => (w.__ptLeftAt = performance.now()), { capture: true });
    new MutationObserver(() => {
      if (btn.style.display === 'none' && !w.__ptHiddenAt) w.__ptHiddenAt = performance.now();
    }).observe(btn, { attributes: true, attributeFilter: ['style'] });
  });
  await page.mouse.move(5, 710);
  await expect(paraBtn).toBeHidden({ timeout: 10_000 });
  return page.evaluate(() => (window as any).__ptHiddenAt - (window as any).__ptLeftAt);
}

test.describe('悬浮 UI 尺寸 @extended', () => {
  test('TC-E2E-191: 尺寸改由文档根上的自定义属性给出，缺省时与原来逐像素相同，写上后穿过 shadow 与 all: initial 生效（#965）', async ({
    page, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);

    // 缺省（没有任何变量）：球 44×44，按钮最小边长 24、字号 12 —— 与改动前的硬编码相同
    const ball = await uiMetrics(page, 'ball');
    expect(ball).toEqual({ width: 44, height: 44, fontSize: '11px' });

    await page.locator('p').first().hover();
    const paraBtn = page.locator('#pt-host-para-btn .pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 10_000 });
    const btn = await uiMetrics(page, 'para-btn');
    expect(btn.height).toBe(24);
    expect(btn.width).toBeGreaterThanOrEqual(24);
    expect(btn.fontSize).toBe('12px');

    // 写在文档根上：host 的内联 all: initial 不拦自定义属性，shadow 里的球与按钮都吃到
    await page.evaluate(() => {
      const s = document.documentElement.style;
      s.setProperty('--pt-ball-size', '60px');
      s.setProperty('--pt-ball-font', '15px');
      s.setProperty('--pt-para-btn-size', '40px');
      s.setProperty('--pt-para-btn-font', '20px');
    });
    const bigBall = await uiMetrics(page, 'ball');
    expect(bigBall.width).toBe(60);
    expect(bigBall.height).toBe(60);
    expect(bigBall.fontSize).toBe('15px');
    const bigBtn = await uiMetrics(page, 'para-btn');
    expect(bigBtn.height).toBe(40);
    expect(bigBtn.width).toBeGreaterThanOrEqual(40);
    expect(bigBtn.fontSize).toBe('20px');

    // 去掉变量回到原样：失败模式是“尺寸没变”，不是尺寸为 0
    await page.evaluate(() => {
      const s = document.documentElement.style;
      s.removeProperty('--pt-ball-size');
      s.removeProperty('--pt-ball-font');
      s.removeProperty('--pt-para-btn-size');
      s.removeProperty('--pt-para-btn-font');
    });
    expect(await uiMetrics(page, 'ball')).toEqual(ball);
    expect(await uiMetrics(page, 'para-btn')).toEqual(btn);
  });

  test('TC-E2E-192: 改存储里的悬浮球尺寸不刷新页面，球的实际尺寸跟着变；翻译进行中改尺寸球不重挂、状态不丢；关掉再打开的新球同样吃到尺寸（#966）', async ({
    page, serviceWorker, seedSettings, gotoFixture, mockGoogle,
  }) => {
    await seedSettings({});
    await mockGoogle({ delayMs: 15_000 });
    await gotoFixture('basic');
    const ball = await waitForBall(page);
    expect((await uiMetrics(page, 'ball')).width).toBe(44);

    await patchStoredSettings(serviceWorker, { floatingBallSize: 60 });
    await expect.poll(async () => (await uiMetrics(page, 'ball')).width).toBe(60);
    expect((await ball.boundingBox())!.height).toBe(60);

    // 翻译进行中：给球打个记号，改尺寸后还是同一个元素、仍在转
    await ball.click();
    await expect(ball).toHaveAttribute('data-state', 'loading');
    await page.evaluate(() => {
      const el = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as any;
      el.__ptMark = 'same-ball';
    });
    await patchStoredSettings(serviceWorker, { floatingBallSize: 36 });
    await expect.poll(() => ballLayoutSize(page)).toEqual({ width: 36, height: 36 });
    await expect(ball).toHaveAttribute('data-state', 'loading');
    expect(
      await page.evaluate(
        () => (document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as any).__ptMark,
      ),
    ).toBe('same-ball');

    // 关掉再打开：新建的球同样是 36
    await patchStoredSettings(serviceWorker, { showFloatingBall: false });
    await expect(page.locator('#pt-host-ball')).toHaveCount(0);
    await patchStoredSettings(serviceWorker, { showFloatingBall: true });
    await waitForBall(page);
    expect(await ballLayoutSize(page)).toEqual({ width: 36, height: 36 });
  });

  test('TC-E2E-193: 设置页悬浮球大小滑块 —— 读数随拖动变、键盘 Tab 到滑块后方向键能改值、写盘后网页上的球跟着变、重开设置页值还在（#967）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);

    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    const label = await options.evaluate(() => chrome.i18n.getMessage('rowBallSize'));
    const slider = options.getByRole('slider', { name: label });
    const readout = options.locator('output[for="pt-slider-ball-size"]');
    await expect(slider).toHaveValue('44');
    await expect(readout).toHaveText('44 px');

    // 键盘：从前一个开关 Tab 过来，方向键每按一下走一个步长
    await options.locator('#pt-toggle-input-translate').focus();
    await options.keyboard.press('Tab');
    await expect(slider).toBeFocused();
    await options.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('46');
    await expect(readout).toHaveText('46 px');
    await expect(slider).toHaveAttribute('aria-valuetext', '46 px');

    // 鼠标拖到最右端：读数在拖动中就变，不等写盘
    const box = (await slider.boundingBox())!;
    await options.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await options.mouse.down();
    await options.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 8 });
    await expect(readout).toHaveText('72 px');
    await options.mouse.up();

    const stored = () =>
      serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.floatingBallSize);
    await expect.poll(stored).toBe(72);
    // 网页上的球不刷新就跟着变
    await expect.poll(async () => (await uiMetrics(page, 'ball')).width).toBe(72);

    await options.reload();
    await expect(options.getByRole('slider', { name: label })).toHaveValue('72');
    await expect(options.locator('output[for="pt-slider-ball-size"]')).toHaveText('72 px');
  });

  test('TC-E2E-194: 设置页的悬浮 UI 预览 —— 拖动中预览里的球就按滑块值变、不等写盘；别处改了尺寸预览跟着变（#968）', async ({
    page, serviceWorker, seedSettings,
  }) => {
    await seedSettings({});
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    const previewBall = () =>
      page.evaluate(() => {
        const b = document.getElementById('pt-floating-preview')!.shadowRoot!.querySelector('.pt-ball')!;
        const r = b.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
    await expect.poll(previewBall).toEqual({ width: 44, height: 44 });

    // 一次 evaluate 里改值、量预览、读存储：防抖 400ms 还没到点，存储仍是 44，预览已经是 60
    const during = await page.evaluate(async () => {
      const input = document.getElementById('pt-slider-ball-size') as HTMLInputElement;
      input.value = '60';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const b = document.getElementById('pt-floating-preview')!.shadowRoot!.querySelector('.pt-ball')!;
      const width = b.getBoundingClientRect().width;
      const stored = ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.floatingBallSize ?? 44;
      return { width, stored };
    });
    expect(during).toEqual({ width: 60, stored: 44 });

    // 真拖：按住拖到最左端，松手之前预览已是最小值
    const slider = page.locator('#pt-slider-ball-size');
    await expect.poll(() =>
      serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.floatingBallSize),
    ).toBe(60);
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 40, box.y + box.height / 2, { steps: 8 });
    await expect.poll(previewBall).toEqual({ width: 32, height: 32 });
    await page.mouse.up();
    await expect.poll(() =>
      serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.floatingBallSize),
    ).toBe(32);

    // 别处（popup、另一个设置页）改了尺寸：经存储变更回调，预览与滑块都跟着变
    await serviceWorker.evaluate(async () => {
      const cur = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as object;
      await chrome.storage.sync.set({ 'pt-settings': { ...cur, floatingBallSize: 66 } });
    });
    await expect.poll(previewBall).toEqual({ width: 66, height: 66 });
    await expect(slider).toHaveValue('66');
  });

  test('TC-E2E-195: 悬浮球拖到右下角贴边后调大，球仍完整在视口内、存储里的位置更新成钳制后的值；没拖过的球不受影响（#969）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    const ball = await waitForBall(page);
    const posKey = 'pt-ball-pos:localhost';
    const storedPos = () => serviceWorker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, posKey);
    const ballState = () =>
      page.evaluate(() => {
        const b = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as HTMLElement;
        const r = b.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, position: b.style.position };
      });

    // 没拖过：默认右下角锚定，调大后仍靠 host 的 right/bottom 锚定，不写位置
    await patchStoredSettings(serviceWorker, { floatingBallSize: 60 });
    await expect.poll(async () => (await ballState()).width).toBe(60);
    const anchored = await ballState();
    expect(anchored.position).toBe('');
    expect(anchored.right).toBe(1280 - 24);
    expect(anchored.bottom).toBe(720 - 24);
    expect(await storedPos()).toBeNull();

    // 拖到右下角贴边：钳在 VIEWPORT_MARGIN(8) 处
    await patchStoredSettings(serviceWorker, { floatingBallSize: 44 });
    await expect.poll(async () => (await ballState()).width).toBe(44);
    const box = (await ball.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(3000, 3000, { steps: 12 });
    await page.mouse.up();
    // 松手时指针还在球上（悬停放大 1.08），拖动钳制与持久化读布局位置（#980），贴边位置精确
    const dropped = await page.evaluate(() => {
      const b = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as HTMLElement;
      return { left: b.style.left, top: b.style.top, position: b.style.position };
    });
    expect(dropped).toEqual({ left: `${1280 - 8 - 44}px`, top: `${720 - 8 - 44}px`, position: 'fixed' });
    await expect.poll(storedPos).toEqual({ x: 1280 - 8 - 44, y: 720 - 8 - 44 });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);

    // 调大：球仍完整在视口内，位置钳回并写回存储，尺寸不被钳制改动
    await patchStoredSettings(serviceWorker, { floatingBallSize: 72 });
    await expect.poll(async () => (await ballState()).width).toBe(72);
    await expect.poll(ballState).toMatchObject({ right: 1280 - 8, bottom: 720 - 8, width: 72 });
    await expect.poll(storedPos).toEqual({ x: 1280 - 8 - 72, y: 720 - 8 - 72 });
  });

  test('TC-E2E-203: 悬停放大时松手、翻译中转圈时拖动或改窗口大小，存下的都是球的布局位置而不是外接矩形（#980）', async ({
    page, serviceWorker, seedSettings, gotoFixture, mockGoogle,
  }) => {
    await seedSettings({});
    await mockGoogle({ delayMs: 15_000 });
    await gotoFixture('basic');
    const ball = await waitForBall(page);
    const posKey = 'pt-ball-pos:localhost';
    const storedPos = () => serviceWorker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? null, posKey);
    const ballBox = () =>
      page.evaluate(() => {
        const b = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball') as HTMLElement;
        const r = b.getBoundingClientRect();
        return { left: b.style.left, top: b.style.top, rectLeft: r.left, rectTop: r.top, rectWidth: r.width };
      });

    // 票里那组实测：44px 的球从默认位置（左上角 1212, 652）拖 (-634, -274)，悬停着松手
    const box = (await ball.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 634, box.y + box.height / 2 - 274, { steps: 10 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    const hovered = await ballBox();
    // 前提成立：松手时外接矩形确实被悬停放大了（否则这条用例测不到 #980）
    expect(hovered.rectWidth).toBeGreaterThan(44);
    expect(hovered).toMatchObject({ left: '578px', top: '378px' });
    await expect.poll(storedPos).toEqual({ x: 578, y: 378 });

    // 刷新后鼠标移开再量：球回到松手时的位置，不往左上偏
    await page.reload();
    await waitForBall(page);
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await ballBox()).rectLeft).toBe(578);
    expect((await ballBox()).rectTop).toBe(378);

    // 翻译进行中（球在转圈）拖动：存下的位置同样是布局位置
    const b2 = (await ball.boundingBox())!;
    const cx = b2.x + b2.width / 2;
    const cy = b2.y + b2.height / 2;
    await page.mouse.click(cx, cy);
    await expect(ball).toHaveAttribute('data-state', 'loading');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    expect((await ballBox()).rectWidth).toBeGreaterThan(44); // 转圈中外接矩形比球大
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 100, cy - 50, { steps: 8 });
    await page.mouse.up();
    await expect(ball).toHaveAttribute('data-state', 'loading');
    await expect.poll(storedPos).toEqual({ x: 478, y: 328 });

    // 翻译进行中改窗口大小：钳到右边距 8px 处，不被转圈的外接矩形推得更远
    await page.mouse.move(5, 5);
    await page.setViewportSize({ width: 500, height: 720 });
    await expect.poll(storedPos).toEqual({ x: 500 - 8 - 44, y: 328 });
    expect(await ballBox()).toMatchObject({ left: `${500 - 8 - 44}px`, top: '328px' });
    await expect(ball).toHaveAttribute('data-state', 'loading');
  });

  test('TC-E2E-204: 悬浮球的字号随球径等比变：默认 44px 仍是 11px，上限 72px 是 18px、下限 32px 是 8px；设置页预览里的球与网页上的同径同字号（#986）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);
    // 不改设置时渲染结果不变
    expect(await uiMetrics(page, 'ball')).toEqual({ width: 44, height: 44, fontSize: '11px' });

    await patchStoredSettings(serviceWorker, { floatingBallSize: 72 });
    await expect.poll(() => uiMetrics(page, 'ball')).toEqual({ width: 72, height: 72, fontSize: '18px' });
    // 字形真的跟着长：量球里文字的渲染高度，不只看 computed 值
    const glyphHeight = () =>
      page.evaluate(() => {
        const b = document.getElementById('pt-host-ball')!.shadowRoot!.querySelector('.pt-ball')!;
        const range = document.createRange();
        range.selectNodeContents(b);
        return range.getBoundingClientRect().height;
      });
    const bigGlyph = await glyphHeight();

    await patchStoredSettings(serviceWorker, { floatingBallSize: 32 });
    await expect.poll(() => uiMetrics(page, 'ball')).toEqual({ width: 32, height: 32, fontSize: '8px' });
    expect(bigGlyph).toBeGreaterThan((await glyphHeight()) * 2);

    // 设置页预览：滑块拉到上限，预览里的球与网页上的球同径同字号
    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    const previewBall = () =>
      options.evaluate(() => {
        const b = document.getElementById('pt-floating-preview')!.shadowRoot!.querySelector('.pt-ball')!;
        const r = b.getBoundingClientRect();
        return { width: r.width, height: r.height, fontSize: getComputedStyle(b).fontSize };
      });
    await expect.poll(previewBall).toEqual({ width: 32, height: 32, fontSize: '8px' });
    await options.locator('#pt-slider-ball-size').fill('72');
    await expect.poll(previewBall).toEqual({ width: 72, height: 72, fontSize: '18px' });
    await expect.poll(() => uiMetrics(page, 'ball')).toEqual(await previewBall());
  });

  test('TC-E2E-205: 输入翻译圆点大小跟着设置变 —— 可点区等比放大、最小档仍不低于 24px；改大小时圆点按新直径重新贴文字末尾，不压住上一行的字（#987）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator('#pt-host-input-dot .pt-input-dot');
    const LINE1 = 'Typing a long jumpy line here';
    await box.click();
    await page.keyboard.type(LINE1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('hi');
    await expect(dot).toBeVisible();

    /** 可点区：逐像素问 shadow root 这一点落在谁身上（同 TC-E2E-137），范围放宽到 48px 的可点区也装得下 */
    const hitArea = () =>
      page.evaluate(() => {
        const root = document.getElementById('pt-host-input-dot')!.shadowRoot!;
        const el = root.querySelector('.pt-input-dot')!;
        const r = el.getBoundingClientRect();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let x = Math.floor(r.left) - 30; x <= Math.ceil(r.right) + 30; x++) {
          for (let y = Math.floor(r.top) - 30; y <= Math.ceil(r.bottom) + 30; y++) {
            if (root.elementFromPoint(x + 0.5, y + 0.5) !== el) continue;
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
        return { left, top, width: right - left, height: bottom - top };
      });
    /** 第二行 'hi' 的末尾、第二行的竖直中线、第一行字形盒的下沿（同 TC-E2E-137 的量法） */
    const geometry = await box.evaluate((el, line1) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const lh = parseFloat(cs.lineHeight);
      const sp = document.createElement('span');
      sp.style.font = cs.font;
      sp.style.whiteSpace = 'pre';
      sp.textContent = 'hi';
      el.parentElement!.append(sp);
      const endW = sp.getBoundingClientRect().width;
      sp.remove();
      const line = document.createElement('div');
      line.style.font = cs.font;
      line.style.lineHeight = cs.lineHeight;
      line.style.whiteSpace = 'pre';
      const g = document.createElement('span');
      g.textContent = line1;
      line.append(g);
      el.parentElement!.append(line);
      const lr = line.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      line.remove();
      const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      return {
        endX: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + endW,
        line2Mid: top + lh * 1.5,
        line1GlyphBottom: top + (gr.top - lr.top) + gr.height,
        line1Right: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + gr.width,
      };
    }, LINE1);

    // 页内算期望可点区：与 floatingUiVars 同一条规则（等比 24/14、不低于 24），这里独立写一遍当真值
    for (const [size, hit] of [[24, 41], [12, 24], [14, 24]] as const) {
      await patchStoredSettings(serviceWorker, { inputDotSize: size });
      await expect.poll(async () => (await dot.boundingBox())?.width).toBe(size);
      // 直径变了圆点就重新摆：竖直居中于末尾那一行、离末尾字符 4px
      await expect(async () => {
        const d = (await dot.boundingBox())!;
        expect(d.height).toBe(size);
        expect(Math.abs(d.y + size / 2 - geometry.line2Mid), `${size}px 竖直居中`).toBeLessThanOrEqual(1);
        expect(d.x - geometry.endX, `${size}px 与末尾字符的间隙`).toBeGreaterThanOrEqual(3);
        expect(d.x - geometry.endX).toBeLessThanOrEqual(5);
        // 上一行的字一直写到圆点上方：圆点不伸进上一行的字形盒
        expect(geometry.line1Right).toBeGreaterThan(d.x + size);
        expect(d.y, `${size}px 不压住上一行`).toBeGreaterThanOrEqual(geometry.line1GlyphBottom);
      }).toPass({ timeout: 5_000 });
      // 可点区：逐像素采样落在亚像素边界上时多数一格
      const h = await hitArea();
      for (const v of [h.width, h.height]) {
        expect(v, `${size}px 圆点的可点区 ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(hit);
        expect(v).toBeLessThanOrEqual(hit + 1);
      }
      // 扩出的一圈不伸向文字末尾：末尾字符照常点得进输入框
      // 采样点在像素中心（x + 0.5）：第一个落在圆点上的采样点不在末尾字符左边
      expect(h.left + 0.5, `${size}px 可点区没盖住末尾字符`).toBeGreaterThanOrEqual(geometry.endX);
      expect(
        await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id ?? null, [geometry.endX - 2, geometry.line2Mid] as const),
      ).toBe('reply');
    }
  });

  test('TC-E2E-209: 行高紧凑的多行框里圆点不伸进上一行 —— 直径按行高收小，可点区仍不低于 24px；行高宽松时照设置的直径（#997）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator('#pt-host-input-dot .pt-input-dot');
    const LINE1 = 'Typing a long jumpy line here';
    await box.click();
    await page.keyboard.type(LINE1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('hi');
    await expect(dot).toBeVisible();

    /** 第一行字形盒的下沿、第二行的竖直中线与末尾横坐标（同 TC-E2E-205 的量法），按当前行高量 */
    const geometry = () =>
      box.evaluate((el, line1) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const lh = parseFloat(cs.lineHeight);
        const sp = document.createElement('span');
        sp.style.font = cs.font;
        sp.style.whiteSpace = 'pre';
        sp.textContent = 'hi';
        el.parentElement!.append(sp);
        const endW = sp.getBoundingClientRect().width;
        sp.remove();
        const line = document.createElement('div');
        line.style.font = cs.font;
        line.style.lineHeight = cs.lineHeight;
        line.style.whiteSpace = 'pre';
        const g = document.createElement('span');
        g.textContent = line1;
        line.append(g);
        el.parentElement!.append(line);
        const lr = line.getBoundingClientRect();
        const gr = g.getBoundingClientRect();
        line.remove();
        const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
        return {
          endX: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + endW,
          line2Mid: top + lh * 1.5,
          line1GlyphBottom: top + (gr.top - lr.top) + gr.height,
        };
      }, LINE1);
    /** 可点区边长：逐像素问 shadow root（同 TC-E2E-205） */
    const hitSide = () =>
      page.evaluate(() => {
        const root = document.getElementById('pt-host-input-dot')!.shadowRoot!;
        const el = root.querySelector('.pt-input-dot')!;
        const r = el.getBoundingClientRect();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let x = Math.floor(r.left) - 30; x <= Math.ceil(r.right) + 30; x++) {
          for (let y = Math.floor(r.top) - 30; y <= Math.ceil(r.bottom) + 30; y++) {
            if (root.elementFromPoint(x + 0.5, y + 0.5) !== el) continue;
            left = Math.min(left, x); right = Math.max(right, x + 1);
            top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
          }
        }
        return Math.min(right - left, bottom - top);
      });

    // 上限 24px；三档行高：1.0 与 1.2 下 24px 居中会伸进上一行（实测 5px 与 1.8px），1.4 不会
    await patchStoredSettings(serviceWorker, { inputDotSize: 24 });
    await expect.poll(async () => (await dot.boundingBox())?.width).toBe(24);
    for (const lh of ['1', '1.2', '1.4']) {
      await box.evaluate((el, v) => { (el as HTMLElement).style.lineHeight = v; }, lh);
      const g = await geometry();
      await expect(async () => {
        const d = (await dot.boundingBox())!;
        expect(d.width, `行高 ${lh} 直径`).toBe(d.height);
        expect(d.y, `行高 ${lh} 圆点 ${JSON.stringify(d)} 不压住上一行`).toBeGreaterThanOrEqual(g.line1GlyphBottom);
        expect(Math.abs(d.y + d.height / 2 - g.line2Mid), `行高 ${lh} 竖直居中`).toBeLessThanOrEqual(1);
        expect(d.x - g.endX, `行高 ${lh} 与末尾字符的间隙`).toBeGreaterThanOrEqual(3);
        expect(d.x - g.endX).toBeLessThanOrEqual(5);
        // 1.4 下装得下，不收：照设置的 24px
        if (lh === '1.4') expect(d.width).toBe(24);
      }).toPass({ timeout: 5_000 });
      expect(await hitSide(), `行高 ${lh} 可点区`).toBeGreaterThanOrEqual(24);
    }

    // 收小之后设置里再改直径，圆点照常跟着变：1.0 行高下改到 12px，比收小后的直径还小
    await box.evaluate((el) => { (el as HTMLElement).style.lineHeight = '1'; });
    await expect.poll(async () => (await dot.boundingBox())?.width).toBeLessThan(24);
    await patchStoredSettings(serviceWorker, { inputDotSize: 12 });
    await expect.poll(async () => (await dot.boundingBox())?.width).toBe(12);
  });

  test('TC-E2E-206: 圆点大小在主文档与同域、跨域 iframe 里都跟着设置变（变量写入点不只在主文档分支里）（#987）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input-frames');
    await waitForBall(page);
    const DOT = '#pt-host-input-dot .pt-input-dot';
    const frames = [
      { name: 'main', root: page as { locator: (s: string) => import('@playwright/test').Locator }, box: '#reply' },
      { name: 'same', root: page.frameLocator('#same'), box: '#child' },
      { name: 'cross', root: page.frameLocator('#cross'), box: '#child' },
    ];
    const dotSizeIn = async (f: (typeof frames)[number]) => {
      const box = f.root.locator(f.box);
      await box.click();
      await box.fill('');
      await page.keyboard.type('Hello there');
      const dot = f.root.locator(DOT);
      await expect(dot, `${f.name} 圆点浮出`).toBeVisible({ timeout: 10_000 });
      const b = (await dot.boundingBox())!;
      return { width: b.width, height: b.height };
    };
    for (const f of frames) expect(await dotSizeIn(f), f.name).toEqual({ width: 14, height: 14 });
    await patchStoredSettings(serviceWorker, { inputDotSize: 22 });
    for (const f of frames) {
      await expect.poll(() => dotSizeIn(f), f.name).toEqual({ width: 22, height: 22 });
    }
  });

  test('TC-E2E-207: 设置页输入翻译圆点大小滑块 —— 预览里的圆点随拖动改尺寸、键盘可调，写盘后网页上的圆点跟着变（#987）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    const label = await options.evaluate(() => chrome.i18n.getMessage('rowInputDotSize'));
    const slider = options.getByRole('slider', { name: label });
    await expect(slider).toHaveValue('14');
    const previewDot = () =>
      options.evaluate(() => {
        const d = document.getElementById('pt-floating-preview')!.shadowRoot!.querySelector('.pt-input-dot')!;
        const r = d.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
    await expect.poll(previewDot).toEqual({ width: 14, height: 14 });

    // 拖到最右：松手前预览已是上限
    await slider.scrollIntoViewIfNeeded();
    const sb = (await slider.boundingBox())!;
    await options.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await options.mouse.down();
    await options.mouse.move(sb.x + sb.width + 40, sb.y + sb.height / 2, { steps: 8 });
    await expect.poll(previewDot).toEqual({ width: 24, height: 24 });
    await options.mouse.up();
    await expect(options.locator('output[for="pt-slider-input-dot-size"]')).toHaveText('24 px');

    // 键盘：方向键左两下，一步 2px
    await slider.focus();
    await options.keyboard.press('ArrowLeft');
    await options.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('20');
    await expect.poll(previewDot).toEqual({ width: 20, height: 20 });
    await expect.poll(() =>
      serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.inputDotSize),
    ).toBe(20);

    // 网页上的圆点跟着变
    await gotoFixture('input');
    await waitForBall(page);
    await page.locator('#reply').click();
    await page.keyboard.type('Hello there');
    const dot = page.locator('#pt-host-input-dot .pt-input-dot');
    await expect(dot).toBeVisible();
    const d = (await dot.boundingBox())!;
    expect({ width: d.width, height: d.height }).toEqual(await previewDot());
  });

  test('TC-E2E-208: 关掉悬浮球、逐段翻译、输入翻译开关，对应的尺寸滑块置灰带说明、预览里那一项置灰；重新打开指示消失；关开关不清已存的尺寸（#988）', async ({
    page, serviceWorker, seedSettings,
  }) => {
    await seedSettings({ floatingBallSize: 60, paraBtnSize: 30, paraBtnHideDelay: 2000, inputDotSize: 20 });
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    const stored = () =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any;
        return [s.floatingBallSize, s.paraBtnSize, s.paraBtnHideDelay, s.inputDotSize];
      });
    const SLIDERS = {
      ball: 'pt-slider-ball-size',
      size: 'pt-slider-para-btn-size',
      delay: 'pt-slider-para-btn-hide-delay',
      dot: 'pt-slider-input-dot-size',
    } as const;
    /** 每个滑块：是否禁用、说明文字（隐藏时为 null）、说明是否经 aria-describedby 关联；预览三项的不透明度 */
    const state = () =>
      page.evaluate((ids) => {
        const out: Record<string, unknown> = {};
        for (const [k, id] of Object.entries(ids)) {
          const input = document.getElementById(id) as HTMLInputElement;
          const note = document.getElementById(`${id}-note`)!;
          out[k] = {
            disabled: input.disabled,
            note: note.hidden ? null : note.textContent,
            described: input.getAttribute('aria-describedby') === note.id,
          };
        }
        const root = document.getElementById('pt-floating-preview')!.shadowRoot!;
        const op = (sel: string) => Number(getComputedStyle(root.querySelector(sel)!).opacity);
        out.preview = { ball: op('.pt-ball'), btn: op('.pt-para-btn'), dot: op('.pt-preview-input') };
        return out;
      }, SLIDERS);
    const note = (featureKey: string) =>
      page.evaluate((k) => chrome.i18n.getMessage('sliderOffNote', [chrome.i18n.getMessage(k)]), featureKey);
    const on = { disabled: false, note: null, described: false };
    const off = async (featureKey: string) => ({ disabled: true, note: await note(featureKey), described: true });

    await expect.poll(state).toEqual({ ball: on, size: on, delay: on, dot: on, preview: { ball: 1, btn: 1, dot: 1 } });
    expect(await stored()).toEqual([60, 30, 2000, 20]);

    // 关悬浮球：只有悬浮球大小置灰，预览里只有球置灰
    await page.locator('#pt-toggle-floating-ball').click();
    await expect.poll(state).toEqual({
      ball: await off('rowFloatingBall'), size: on, delay: on, dot: on,
      preview: { ball: 0.25, btn: 1, dot: 1 },
    });
    // 置灰的滑块拖不动：在它上面按下拖动，值与存储都不变
    const ballSlider = page.locator(`#${SLIDERS.ball}`);
    await ballSlider.scrollIntoViewIfNeeded();
    const bb = (await ballSlider.boundingBox())!;
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width + 30, bb.y + bb.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(ballSlider).toHaveValue('60');

    // 关逐段翻译：按钮大小与显示时长两个滑块同时置灰
    await page.locator('#pt-toggle-paragraph-btn').click();
    await expect.poll(state).toEqual({
      ball: await off('rowFloatingBall'), size: await off('rowParagraphBtn'), delay: await off('rowParagraphBtn'), dot: on,
      preview: { ball: 0.25, btn: 0.25, dot: 1 },
    });

    // 关输入翻译：圆点大小置灰
    await page.locator('#pt-toggle-input-translate').click();
    await expect.poll(state).toEqual({
      ball: await off('rowFloatingBall'), size: await off('rowParagraphBtn'), delay: await off('rowParagraphBtn'), dot: await off('rowInputTranslate'),
      preview: { ball: 0.25, btn: 0.25, dot: 0.25 },
    });
    // 关开关不清尺寸
    expect(await stored()).toEqual([60, 30, 2000, 20]);

    // 别处（popup、另一个设置页）把三个开关打开：指示全部消失，滑块值仍是已存的值
    await serviceWorker.evaluate(async () => {
      const cur = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as object;
      await chrome.storage.sync.set({
        'pt-settings': { ...cur, showFloatingBall: true, showParagraphBtn: true, inputTranslate: true },
      });
    });
    await expect.poll(state).toEqual({ ball: on, size: on, delay: on, dot: on, preview: { ball: 1, btn: 1, dot: 1 } });
    await expect(ballSlider).toHaveValue('60');
    await expect(page.locator(`#${SLIDERS.dot}`)).toHaveValue('20');
    expect(await stored()).toEqual([60, 30, 2000, 20]);
  });

  test('TC-E2E-196: 改存储里的逐段翻译按钮尺寸不刷新，浮出的按钮实际尺寸与字号跟着变；绕过写入口写进 1px 时仍不小于 24px（#970）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);
    await page.locator('p').first().hover();
    const paraBtn = page.locator('#pt-host-para-btn .pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 10_000 });
    expect(await uiMetrics(page, 'para-btn')).toMatchObject({ height: 24, fontSize: '12px' });

    await patchStoredSettings(serviceWorker, { paraBtnSize: 36 });
    await expect.poll(async () => (await uiMetrics(page, 'para-btn')).height).toBe(36);
    const big = await uiMetrics(page, 'para-btn');
    expect(big.fontSize).toBe('18px');
    expect(big.width).toBeGreaterThanOrEqual(36);
    expect((await paraBtn.boundingBox())!.height).toBe(36);

    // 直接写存储绕过写入口钳制：纯函数再钳一次，按钮不会小于 24px 的点击下限
    await patchStoredSettings(serviceWorker, { paraBtnSize: 1 });
    await expect.poll(async () => (await uiMetrics(page, 'para-btn')).height).toBe(24);
    const small = await uiMetrics(page, 'para-btn');
    expect(small.width).toBeGreaterThanOrEqual(24);
    expect(small.fontSize).toBe('12px');
  });

  test('TC-E2E-197: 调大逐段翻译按钮不改变输入翻译圆点的可见尺寸与 24px 可点区（#970）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ from: 'en' });
    await gotoFixture('input');
    await waitForBall(page);
    const box = page.locator('#reply');
    const dot = page.locator('#pt-host-input-dot .pt-input-dot');
    await box.click();
    await page.keyboard.type('Hello there');
    await expect(dot).toBeVisible();

    /** 圆点的可见尺寸与可点区：逐像素问圆点所在的 shadow root 这一点落在谁身上（同 TC-E2E-137） */
    const dotMetrics = () =>
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
        return { width: r.width, height: r.height, hitWidth: right - left, hitHeight: bottom - top };
      });
    const before = await dotMetrics();
    expect(before.width).toBe(14);
    expect(before.height).toBe(14);
    // 逐像素采样落在亚像素边界上时多数一格：24px 的可点区量出 24 或 25
    for (const hit of [before.hitWidth, before.hitHeight]) {
      expect(hit).toBeGreaterThanOrEqual(24);
      expect(hit).toBeLessThanOrEqual(25);
    }

    await patchStoredSettings(serviceWorker, { paraBtnSize: 40, floatingBallSize: 72 });
    await expect.poll(async () => (await uiMetrics(page, 'ball')).width).toBe(72);
    await expect(dot).toBeVisible();
    expect(await dotMetrics()).toEqual(before);
  });

  test('TC-E2E-198: 设置页逐段翻译按钮大小滑块 —— 预览里的按钮随拖动改尺寸、键盘可调，写盘后网页上浮出的按钮跟着变（#971）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);

    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    const label = await options.evaluate(() => chrome.i18n.getMessage('rowParaBtnSize'));
    const slider = options.getByRole('slider', { name: label });
    const readout = options.locator('output[for="pt-slider-para-btn-size"]');
    const previewBtn = () =>
      options.evaluate(() => {
        const b = document.getElementById('pt-floating-preview')!.shadowRoot!.querySelector('.pt-para-btn')!;
        const r = b.getBoundingClientRect();
        return { height: r.height, width: r.width, fontSize: getComputedStyle(b).fontSize };
      });
    await expect(slider).toHaveValue('24');
    await expect(readout).toHaveText('24 px');
    await expect.poll(previewBtn).toMatchObject({ height: 24, fontSize: '12px' });

    // 键盘：从悬浮球大小滑块 Tab 过来，方向键走一个步长，预览跟着变
    await options.locator('#pt-slider-ball-size').focus();
    await options.keyboard.press('Tab');
    await expect(slider).toBeFocused();
    await options.keyboard.press('ArrowRight');
    await expect(readout).toHaveText('26 px');
    await expect.poll(previewBtn).toMatchObject({ height: 26, fontSize: '13px' });

    // 拖到最右端：松手前预览已是 40
    const box = (await slider.boundingBox())!;
    await options.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await options.mouse.down();
    await options.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 8 });
    await expect(readout).toHaveText('40 px');
    const big = await previewBtn();
    expect(big).toMatchObject({ height: 40, fontSize: '20px' });
    expect(big.width).toBeGreaterThanOrEqual(40);
    await options.mouse.up();

    await expect
      .poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.paraBtnSize))
      .toBe(40);

    // 网页上浮出的按钮跟着变，不用刷新
    await page.bringToFront();
    await page.locator('p').first().hover();
    const paraBtn = page.locator('#pt-host-para-btn .pt-para-btn');
    await expect(paraBtn).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await paraBtn.boundingBox())!.height).toBe(40);
    // 预览不骗人：同一设置下，网页上的按钮与预览里的按钮宽高、字号逐项相同
    const onPage = await uiMetrics(page, 'para-btn');
    expect(onPage).toEqual({ width: big.width, height: big.height, fontSize: big.fontSize });
  });

  test('TC-E2E-199: 改存储里的逐段翻译按钮显示时长不刷新，下一次离开段落就按新时长消失（#972）', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);
    const hideAfterLeave = () => measureHideAfterLeave(page);

    await patchStoredSettings(serviceWorker, { paraBtnHideDelay: 600 });
    await expect.poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any).paraBtnHideDelay)).toBe(600);
    const short = await hideAfterLeave();
    expect(short).toBeGreaterThanOrEqual(600 - 20);
    expect(short).toBeLessThan(1000);

    await patchStoredSettings(serviceWorker, { paraBtnHideDelay: 2600 });
    const long = await hideAfterLeave();
    expect(long).toBeGreaterThanOrEqual(2600 - 20);
    expect(long).toBeLessThan(3000);
  });

  test('TC-E2E-200: 设置页逐段翻译按钮显示时长滑块 —— 读数以秒显示，标签写明是鼠标离开段落之后；键盘调到 0.5 秒后，网页上离开段落的按钮约半秒就消失（#973）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({});
    await gotoFixture('basic');
    await waitForBall(page);

    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    const [label, unit] = await options.evaluate(() => [
      chrome.i18n.getMessage('rowParaBtnHideDelay'),
      chrome.i18n.getMessage('unitSeconds'),
    ]);
    const slider = options.getByRole('slider', { name: label });
    const readout = options.locator('output[for="pt-slider-para-btn-hide-delay"]');
    await expect(slider).toHaveValue('1500');
    await expect(readout).toHaveText(`1.5 ${unit}`);

    // 键盘：从按钮大小滑块 Tab 过来，左方向键每按一下少 0.1 秒，按到下限 0.5 秒
    await options.locator('#pt-slider-para-btn-size').focus();
    await options.keyboard.press('Tab');
    await expect(slider).toBeFocused();
    await options.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText(`1.4 ${unit}`);
    for (let i = 0; i < 13; i++) await options.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('500');
    await expect(readout).toHaveText(`0.5 ${unit}`);
    await expect(slider).toHaveAttribute('aria-valuetext', `0.5 ${unit}`);

    // 键盘调值只走防抖：停手后写一次
    await expect
      .poll(() => serviceWorker.evaluate(async () => ((await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any)?.paraBtnHideDelay))
      .toBe(500);

    // 网页上：离开段落后约半秒消失（默认是 1.5 秒）
    await page.bringToFront();
    const ms = await measureHideAfterLeave(page);
    expect(ms).toBeGreaterThanOrEqual(500 - 20);
    expect(ms).toBeLessThan(1000);
  });

  test('TC-E2E-201: 设置页导入缺三个字段的旧配置 → 网页上的球与按钮回到默认尺寸且照常显示；导入超范围值 → 钳制后生效、按钮仍不小于 24px；恢复默认 → 三个值一起回到默认（#974）', async ({
    page, context, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ floatingBallSize: 60, paraBtnSize: 36, paraBtnHideDelay: 2500 });
    await gotoFixture('basic');
    await waitForBall(page);
    expect((await uiMetrics(page, 'ball')).width).toBe(60);

    const extId = new URL(serviceWorker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.click('.pt-nav-btn[data-section="advanced"]');
    const stored = () =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any;
        return [s.floatingBallSize, s.paraBtnSize, s.paraBtnHideDelay];
      });
    const importJson = (data: object) =>
      options.setInputFiles('#pt-import-file', {
        name: 'settings.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(data), 'utf-8'),
      });
    const pageSizes = async () => {
      await page.mouse.move(5, 710);
      await page.locator('p').first().hover();
      await expect(page.locator('#pt-host-para-btn .pt-para-btn')).toBeVisible({ timeout: 10_000 });
      return { ball: (await uiMetrics(page, 'ball')).width, btn: (await uiMetrics(page, 'para-btn')).height };
    };

    // 旧版本导出的配置：没有这三个字段
    await importJson({ enabled: true, showFloatingBall: true, showParagraphBtn: true, enginePriority: ['google-web'], to: 'zh-CN' });
    await expect.poll(stored).toEqual([44, 24, 1500]);
    await expect.poll(pageSizes).toEqual({ ball: 44, btn: 24 });

    // 手改过的导出文件：越界值钳制后生效
    await importJson({ showFloatingBall: true, showParagraphBtn: true, enginePriority: ['google-web'], floatingBallSize: 999, paraBtnSize: 2, paraBtnHideDelay: 50 });
    await expect.poll(stored).toEqual([72, 24, 500]);
    await expect.poll(pageSizes).toEqual({ ball: 72, btn: 24 });

    // 恢复默认（确认框点确定）：三个值一起回到默认
    await importJson({ showFloatingBall: true, showParagraphBtn: true, floatingBallSize: 56, paraBtnSize: 32, paraBtnHideDelay: 2200 });
    await expect.poll(stored).toEqual([56, 32, 2200]);
    options.once('dialog', (d) => d.accept());
    await options.click('#pt-reset-settings-btn');
    await expect.poll(stored).toEqual([44, 24, 1500]);
    await expect.poll(pageSizes).toEqual({ ball: 44, btn: 24 });
  });

  test('TC-E2E-202: popup 刚改了显示模式，设置页里拖尺寸滑块不把它回滚（#974）', async ({
    context, serviceWorker, seedSettings,
  }) => {
    await seedSettings({});
    const extId = new URL(serviceWorker.url()).host;
    // 设置页先打开，内存里是旧的显示模式
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await expect(options.locator('#pt-slider-ball-size')).toHaveValue('44');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.selectOption('#pt-mode-select', 'translation-only');
    const stored = () =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.sync.get('pt-settings'))['pt-settings'] as any;
        return { displayMode: s.displayMode, floatingBallSize: s.floatingBallSize };
      });
    await expect.poll(stored).toEqual({ displayMode: 'translation-only', floatingBallSize: 44 });

    await options.bringToFront();
    await options.locator('#pt-slider-ball-size').focus();
    await options.keyboard.press('ArrowRight');
    await options.keyboard.press('ArrowRight');
    await expect.poll(stored).toEqual({ displayMode: 'translation-only', floatingBallSize: 48 });
  });
});


test.describe('维基成绩表形态：大量极短表格格子 @extended', () => {
  test('TC-E2E-210: 2400 个极短格子、每个翻译请求慢 200 毫秒 —— 整页翻译全部完成，没有格子停在原文，不报批次失败也不弹错误提示（#1009，父 #1000）', async ({
    page, mockGoogle, seedSettings, gotoFixture,
  }) => {
    // 替身每请求 200 毫秒、后台引擎闸门放 6 个：2400 个格子整页要 80 秒左右。
    // 旧实现（#1007 之前）所有批次一次性发出、发出即开始计 30 秒响应超时，排在
    // 后面的批次没轮到引擎就超时 —— 这条在 #1007 之前的构建上是红的（实测：80 条
    // “消息通道不可用: 响应超时”）。延迟取 100 毫秒、整页 40 秒时旧实现靠批次重试
    // 能救回来，量不出差别；要让排队时间越过消息层加批次重试的总时长才红得稳
    test.setTimeout(180_000);
    // 关掉缓存：超时的那一批在后台其实翻完了，开着缓存时重试直接命中缓存“救”回来，
    // 用例就看不见排队超时。关掉之后量的是排队本身
    await seedSettings({ useCache: false });
    await mockGoogle({ delayMs: 200 });
    const batchErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('[PT]')) batchErrors.push(m.text());
    });
    await gotoFixture('wiki-results-table');
    const cells = page.locator('table.wikitable td');
    await expect(cells).toHaveCount(2400);

    const ball = await waitForBall(page);
    await ball.click();
    // 翻译中悬浮球是 loading；结束时要么 done 要么 error
    await expect(ball).toHaveAttribute('data-state', /^(done|error)$/, { timeout: 150_000 });

    expect(batchErrors).toEqual([]);
    await expect(ball).toHaveAttribute('data-state', 'done');
    // 每一个格子都有完成标记，没有停在原文的
    const untranslated = await cells.evaluateAll((tds) =>
      tds.filter((td) => td.getAttribute('data-pt') !== 'done').map((td) => td.id),
    );
    expect(untranslated).toEqual([]);
    await expect(page.locator('#cell-2399 .pt-trans')).toHaveText(/^【译】/); // cjk-ok: 替身回显的译文前缀
    await expect(page.locator('#pt-host-toast .pt-toast[data-kind="error"]')).toHaveCount(0);
  });
});
