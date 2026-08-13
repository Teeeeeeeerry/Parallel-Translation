import { defineConfig } from '@playwright/test';
import path from 'path';
import { existsSync } from 'fs';

const LOGS_DIR = path.resolve('docs/testing/logs');
const EXTENSION_DIR = path.resolve('.output/chrome-mv3');
const FIXTURES_SERVER = path.resolve('docs/testing/e2e/fixtures-server.mjs');

// 哨兵：缺少构建产物 → 尽早失败，防止 E2E 假绿
if (!existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
  throw new Error(
    `\n⛔ 缺少扩展构建产物: ${EXTENSION_DIR}/manifest.json\n` +
    `请先运行 pnpm build 再执行 E2E 测试。`,
  );
}

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  // 允许通过了 skip 条件的 retry
  forbidOnly: !!process.env.CI,
  // #83: 冷启动时 SW 消息通道可能延迟就绪，增加超时 + 重试缓解
  expect: { timeout: 40_000 },
  retries: 2,

  // ── Fixture 静态服务器（绕开 file:// content script 限制）──
  webServer: {
    command: `node ${FIXTURES_SERVER}`,
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    // 失败时自动截图 + 录屏（方便回溯）
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  // ── 多格式报告：终端 + HTML + JSON ──
  reporter: [
    ['list'],
    ['html', { outputFolder: `${LOGS_DIR}/playwright-html`, open: 'never' }],
    ['json', { outputFile: `${LOGS_DIR}/playwright-results.json` }],
  ],

  // 每个 worker 独立 persistent context → 可全并行
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,

  projects: [
    {
      name: 'chromium',
    },
  ],
});
