import { defineConfig } from '@playwright/test';
import path from 'path';

const LOGS_DIR = path.resolve('docs/testing/logs');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  // ── 多格式报告：终端 + HTML + JSON ──
  reporter: [
    ['list'],                                              // 终端逐条输出
    ['html', { outputFolder: `${LOGS_DIR}/playwright-html`, open: 'never' }], // 可视化报告
    ['json', { outputFile: `${LOGS_DIR}/playwright-results.json` }],           // 机器可读
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    // 失败时自动截图 + 录屏（方便回溯）
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
