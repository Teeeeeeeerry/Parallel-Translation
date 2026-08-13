import { defineConfig } from 'vitest/config';
import path from 'path';

const LOGS_DIR = path.resolve('docs/testing/logs');

export default defineConfig({
  test: {
    // jsdom 用于需要 DOM API 的测试（classify, text, renderer 等）
    environment: 'jsdom',
    include: [
      'docs/testing/unit/**/*.test.ts',
      'docs/testing/integration/**/*.test.ts',
      'docs/testing/artifacts/**/*.test.ts',
    ],
    // ── 多格式报告：终端 + JSON + JUnit ──
    reporters: [
      'default',                                       // 终端实时输出
      ['json', { outputFile: `${LOGS_DIR}/vitest-results.json` }],   // 机器可读
      ['junit', { outputFile: `${LOGS_DIR}/vitest-junit.xml` }],     // CI 集成
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/engines/**',
        'src/dom/**',
        'src/storage/**',
        'src/hotkeys/**',
        'src/styles/**',
        'src/queue/**',
        'src/runtime/**',
      ],
      thresholds: {
        'src/engines': { lines: 85 },
        'src/dom': { lines: 85 },
        'src/storage': { lines: 85 },
        'src/hotkeys': { lines: 85 },
        'src/styles': { lines: 85 },
        'src/queue': { lines: 85 },
        'src/runtime': { lines: 85 },
      },
      // 覆盖率报告也写到 logs 目录
      reportsDirectory: `${LOGS_DIR}/coverage`,
    },
    // 全局 setup：mock chrome API
    setupFiles: ['./docs/testing/setup.ts'],
  },
  resolve: {
    alias: {
      // WXT 路径别名 —— 与 .wxt/tsconfig.json 保持一致
      '~': path.resolve('.'),
      '@': path.resolve('.'),
    },
  },
});
