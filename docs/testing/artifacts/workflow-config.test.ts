/**
 * CI 工作流配置断言（#96 回归）
 *
 * test.yml 的触发条件就是 CI 的“公共接口”。#96 的教训：e2e-core
 * 只在 pull_request 触发，push 到 main 时被跳过 —— main 分支 CI 一直
 * 显示绿色，但从未真正执行过 e2e-core，翻译链路在 main 上静默断裂
 * 数日才被发现。
 *
 * 这些断言锁定触发矩阵：
 * - e2e-core / hotkeys-macos：push 与 pull_request 两条路径都必须跑
 *   （main 上的推送不再“带病绿色”）
 * - e2e-full / smoke-real-sites：保持 schedule / workflow_dispatch 专属，
 *   不与推送路径混用（避免定时冒烟与常规推送重复执行）
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKFLOW_PATH = path.resolve('.github/workflows/test.yml');

function readWorkflow(): string {
  return fs.readFileSync(WORKFLOW_PATH, 'utf-8');
}

/** 按 2 空格缩进切出顶层 job 定义块（下一行 2 空格缩进的键即块结束） */
function jobBlock(yml: string, jobName: string): string | null {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `  ${jobName}:`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^  \S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** 提取 job 内的 if: 表达式（4 空格缩进） */
function jobIf(block: string): string | null {
  const m = block.match(/^\s{4}if:\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

describe('CI 工作流触发条件（#96 回归）', () => {
  const yml = readWorkflow();

  test('e2e-core 在 push 与 pull_request 两条路径均触发', () => {
    const cond = jobIf(jobBlock(yml, 'e2e-core') ?? '');
    expect(cond, 'e2e-core 的 if 条件').toContain('pull_request');
    expect(cond, 'e2e-core 的 if 条件').toContain('push');
  });

  test('hotkeys-macos 在 push 与 pull_request 两条路径均触发', () => {
    const cond = jobIf(jobBlock(yml, 'hotkeys-macos') ?? '');
    expect(cond, 'hotkeys-macos 的 if 条件').toContain('pull_request');
    expect(cond, 'hotkeys-macos 的 if 条件').toContain('push');
  });

  test('e2e-full 保持仅在 schedule / workflow_dispatch 触发', () => {
    const cond = jobIf(jobBlock(yml, 'e2e-full') ?? '');
    expect(cond).toContain('schedule');
    expect(cond).toContain('workflow_dispatch');
    expect(cond).not.toContain('push');
  });

  test('smoke-real-sites 保持仅在 schedule / workflow_dispatch 触发', () => {
    const cond = jobIf(jobBlock(yml, 'smoke-real-sites') ?? '');
    expect(cond).toContain('schedule');
    expect(cond).toContain('workflow_dispatch');
    expect(cond).not.toContain('push');
  });
});
