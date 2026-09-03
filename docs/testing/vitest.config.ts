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
        'src/changelog/**',
      ],
      exclude: [
        // modal.ts 是纯 DOM 渲染与 shadow 挂载，与 src/ui/** 同类，
        // 本就不在统计范围；changelog 的其余模块都是纯逻辑，全部有单测
        'src/changelog/modal.ts',
      ],
      // #134：门槛键必须是 glob（裸目录键不匹配任何文件，门槛从未生效）。
      // 值取当前实际覆盖率的现实下限（再低会无声失效，再高会立即红灯）。
      // #135：真实引擎 HTTP 路径补测试后 engines 已达 95%+，门槛提到 85%。
      thresholds: {
        'src/engines/**': { lines: 85 },
        'src/dom/**': { lines: 77 },
        'src/storage/**': { lines: 97 },
        'src/hotkeys/**': { lines: 15 },
        'src/styles/**': { lines: 100 },
        'src/queue/**': { lines: 100 },
        'src/runtime/**': { lines: 98 },
        'src/changelog/**': { lines: 90 },
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
