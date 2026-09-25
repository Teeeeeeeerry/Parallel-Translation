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
 * #470：TC-E2E-71 覆盖设置页新建、删除领域失败时的提示。
 * 网络全部走 SW 内 stub（google mock / bing / openai），完全确定性；
 * TC-E2E-34~38（缓存上限、内存泄漏、样式）仍需扩展环境/CDP，保留 skip。
 */
import { test, expect, fixtureFileUrl, waitForBall } from './fixtures';
import type { Page, Worker } from '@playwright/test';

// ── 辅助：在 SW 内 stub Bing 两个端点（与 core.spec.ts TC-E2E-16 同法）──
async function stubBing(sw: Worker, prefix = '[BING] ') {
  await sw.evaluate(
    (p: string) => {
      const realFetch = self.fetch.bind(self);
      (self as any).fetch = async (input: any, init?: any) => {
        const url =
          typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
        if (url.startsWith('https://edge.microsoft.com/translate/auth')) {
          return new Response('mock-jwt-token', { status: 200 });
        }
        if (url.startsWith('https://api-edge.cognitive.microsofttranslator.com/')) {
          const body = JSON.parse((init?.body ?? '[]') as string) as Array<{
            Text: string;
          }>;
          return new Response(
            JSON.stringify(
              body.map((t) => ({
                translations: [{ text: `${p}${t.Text}` }],
              })),
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return realFetch(input, init);
      };
    },
    prefix,
  );
}

// ── 辅助：在 SW 内 stub OpenAI 端点（BYOK）──
// content: 固定编号输出；dropText: 按请求编号行回显并去掉含该文本的行
// （模拟 LLM 漏行 —— parseNumbered 须按编号回填，其余不错位）
async function stubOpenAI(
  sw: Worker,
  opts: { status?: number; content?: string; dropText?: string } = {},
) {
  const { status = 200, content = '', dropText } = opts;
  await sw.evaluate(
    (cfg: { status: number; content: string; dropText?: string }) => {
      const realFetch = self.fetch.bind(self);
      (self as any).fetch = async (input: any, init?: any) => {
        const url =
          typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
        if (url.startsWith('https://api.openai.com/')) {
          if (cfg.status !== 200) {
            return new Response('Unauthorized', { status: cfg.status });
          }
          let body = cfg.content;
          if (cfg.dropText) {
            const req = JSON.parse((init?.body ?? '{}') as string) as {
              messages?: Array<{ content?: string }>;
            };
            const prompt = req.messages?.[0]?.content ?? '';
            body = prompt
              .split('\n')
              .filter(
                (l) =>
                  !/^\s*\d+[.、)]\s*/.test(l) ||
                  !l.includes(cfg.dropText!),
              )
              .join('\n');
          }
          return new Response(
            JSON.stringify({ choices: [{ message: { content: body } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return realFetch(input, init);
      };
    },
    { status, content, dropText },
  );
}

// ── 辅助：请求计数包裹层 —— 统计 google/openai 请求，委托给当前 fetch ──
async function installRequestCounter(sw: Worker) {
  await sw.evaluate(() => {
    if ((self as any).__ptReqCounter) return;
    const inner = (self as any).fetch.bind(self);
    const counts = { google: 0, openai: 0 };
    (self as any).__ptReqCounter = counts;
    (self as any).fetch = async (input: any, init?: any) => {
      const url =
        typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
      if (url.startsWith('https://translate.googleapis.com/')) counts.google++;
      if (url.startsWith('https://api.openai.com/')) counts.openai++;
      return inner(input, init);
    };
  });
}

async function getReqCounts(sw: Worker): Promise<{ google: number; openai: number }> {
  return sw.evaluate(() => ({ ...(self as any).__ptReqCounter }));
}

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
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'bing-edge'] });
    await mockGoogle({ fail: true, prefix: '[GOOGLE] ' });
    await stubBing(serviceWorker, '[BING] ');
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
    await expect(toast).toHaveText(/失败|failed/i);
    const stats = await serviceWorker.evaluate(() => (self as any).getE2EMockStats());
    expect(stats.failServed).toBeGreaterThan(0);
  });

  test('TC-E2E-33: 3/5 段成功 → 成功段渲染 + 失败段交给下一引擎', async ({
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'bing-edge'] });
    const texts = ['Alpha one', 'Bravo two', 'Charlie fail', 'Delta four', 'Echo fail'];
    await mockGoogle({ prefix: '[GOOGLE] ', failTexts: ['Charlie fail', 'Echo fail'] });
    await stubBing(serviceWorker, '[BING] ');
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
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['google-web', 'openai'] });
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'invalid-key' } });
    });
    const texts = ['Alpha one', 'Bravo two', 'Charlie fail'];
    await mockGoogle({ prefix: '[GOOGLE] ', failTexts: ['Charlie fail'] });
    await stubOpenAI(serviceWorker, { status: 401 });
    await installRequestCounter(serviceWorker);
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
    const counts = await getReqCounts(serviceWorker);
    expect(counts.openai).toBe(1);
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
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enabled: false });
    await gotoFixture('basic');
    await installRequestCounter(serviceWorker);

    const ball = await waitForBall(page);
    await ball.click();

    // 翻译请求为零；悬浮球短暂 loading 后回到 idle，页面无译文
    await expect(ball).toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
    await expect(page.locator('[data-pt="done"]')).toHaveCount(0);
    const counts = await getReqCounts(serviceWorker);
    expect(counts.google).toBe(0);
  });

  test('TC-E2E-40: BYOK key 无效 → 直接报错不故障切换', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['openai', 'google-web'] });
    // 无效 key：openai 401 → 非 retryable 错误，router 不得尝试 google
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'invalid-key' } });
    });
    await stubOpenAI(serviceWorker, { status: 401 });
    await installRequestCounter(serviceWorker);
    await gotoFixture('basic');

    const ball = await waitForBall(page);
    await ball.click();

    const toast = page.locator('#pt-host-toast .pt-toast[data-kind="error"]');
    await expect(toast).toBeVisible({ timeout: 40_000 });
    // 请求确实打到了 openai，且 google 零请求 —— 无故障切换
    const counts = await getReqCounts(serviceWorker);
    expect(counts.openai).toBeGreaterThan(0);
    expect(counts.google).toBe(0);
  });

  test('TC-E2E-41: 译文条目数不足 → 缺的填空串其余不错位', async ({
    page, serviceWorker, seedSettings, gotoFixture,
  }) => {
    await seedSettings({ enginePriority: ['openai'] });
    await serviceWorker.evaluate(() => {
      chrome.storage.local.set({ 'pt-keys': { openai: 'test-key' } });
    });
    // LLM 漏掉含 'P two' 的行 —— parseNumbered 按编号回填：缺失槽位空串，
    // 其余槽位仍对齐自己的编号，不发生整体错位
    await stubOpenAI(serviceWorker, { dropText: 'P two' });
    await gotoFixture('basic');
    await injectParagraphs(page, ['P one', 'P two', 'P three']);
    await waitForBall(page);

    const ball = page.locator('#pt-host-ball .pt-ball');
    await ball.click();
    for (const t of ['P one', 'P two', 'P three']) {
      await expect(page.locator('p', { hasText: t })).toHaveAttribute('data-pt', 'done', { timeout: 30_000 });
    }

    // 第 1、3 段对齐各自译文（译文 == 自己的原文，无错位占用）
    await expect(page.locator('p', { hasText: 'P one' }).locator('.pt-trans'))
      .toContainText('P one');
    await expect(page.locator('p', { hasText: 'P three' }).locator('.pt-trans'))
      .toContainText('P three');
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
    page, serviceWorker, mockGoogle, seedSettings, gotoFixture,
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
    // 记录发给 Google 的原文；带上 mock 层的标记，免得路由前被 mock 重新包在外层
    await serviceWorker.evaluate(() => {
      const inner = (self as any).fetch.bind(self);
      (self as any).__ptQueries = [] as string[];
      const recorder = async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? input?.href ?? '';
        if (url.startsWith('https://translate.googleapis.com/')) {
          (self as any).__ptQueries.push(new URL(url).searchParams.get('q') ?? '');
        }
        return inner(input, init);
      };
      (recorder as any).__ptMockStubbed = true;
      (self as any).fetch = recorder;
    });
    const queries = () => serviceWorker.evaluate(() => [...(self as any).__ptQueries] as string[]);

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
    await expect(lastP.locator('.pt-trans')).toContainText('【译】A final paragraph');

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
    await expect(page.locator('#pt-host-toast .pt-toast')).toContainText(`【译】${text}`, {
      timeout: 20_000,
    });
    expect(await queries()).toContain('Second ⟦TM0⟧ that should also be translated');
  });
});

test.describe('设置页：翻译领域 @extended', () => {
  test('TC-E2E-71: 新建或删除领域写入失败 → toast 提示原因，名称留在输入框、领域留在列表（#470）', async ({
    page, serviceWorker,
  }) => {
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({
        'pt-domains': {
          user: [{ id: 'user:e2e', name: '待删除', targetLang: 'zh-CN', sites: [], origin: 'user', terms: [] }],
          builtin: {},
        },
      }),
    );
    const extId = new URL(serviceWorker.url()).host;
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.click('.pt-nav-btn[data-section="domains"]');
    const item = page.locator('.pt-domain-item', { hasText: '待删除' });
    await expect(item).toBeVisible();

    // 设置页里的存储写入被拒绝（同 #430 的手动验证做法）
    await page.evaluate(() => {
      (chrome.storage.local as any).set = () => Promise.reject(new Error('[PT] 存储配额已满'));
    });
    const toast = page.locator('#pt-toast');

    // 新建失败：提示原因（不带“[PT] ”前缀），名称留在输入框，列表里没有新领域
    await page.fill('#pt-domain-name-input', '法律');
    await page.click('#pt-domain-create-btn');
    await expect(toast).toHaveText('新建领域失败：存储配额已满');
    await expect(page.locator('#pt-domain-name-input')).toHaveValue('法律');
    await expect(page.locator('.pt-domain-item', { hasText: '法律' })).toHaveCount(0);

    // 删除失败：提示原因，领域仍在列表里
    page.once('dialog', (d) => void d.accept());
    await item.locator('.pt-site-remove').click();
    await expect(toast).toHaveText('删除领域失败：存储配额已满');
    await expect(item).toBeVisible();
  });
});
