/**
 * CI 工作流配置断言（#96 / #112 回归）
 *
 * test.yml 的触发条件就是 CI 的“公共接口”。#96 的教训：e2e-core
 * 只在 pull_request 触发，push 到 main 时被跳过 —— main 分支 CI 一直
 * 显示绿色，但从未真正执行过 e2e-core，翻译链路在 main 上静默断裂
 * 数日才被发现。
 *
 * #112 的教训：断言只覆盖 job 级 if 的一部分（如只查 `not 'push'`），
 * 误加 `pull_request` 也能通过；branches 过滤被误删测试仍然全绿。
 *
 * 因此这里锁定完整判定面：
 * - workflow 级 `on.push.branches` 恰好 `['main']`（特性分支推送不触发）
 * - workflow 级 `on.pull_request` 存在（PR 触发）
 * - Level 3 专属 schedule / workflow_dispatch，不混入 push 或 pull_request
 * - 触发矩阵（事件 × 分支 × Level）表驱动，逐行锁定「触发 / 不触发」
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKFLOW_PATH = path.resolve('.github/workflows/test.yml');

type EventName = 'push' | 'pull_request' | 'schedule' | 'workflow_dispatch';
type Level = 1 | 2 | 3;

interface WorkflowCfg {
  on: {
    push: { branches: string[] } | null;
    pull_request: unknown;
    schedule: unknown;
    workflow_dispatch: unknown;
  };
  jobs: Record<string, { if: string | null }>;
}

function readWorkflow(): string {
  return fs.readFileSync(WORKFLOW_PATH, 'utf-8');
}

/** `key:` 之后到下一个顶层键（列 0）之前的内容 */
function blockAfter(yml: string, key: string): string | null {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** 按 2 空格缩进切出顶层 job 定义块（下一行 2 空格缩进的键即块结束） */
function jobBlock(yml: string, jobName: string): string | null {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `  ${jobName}:`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^  \S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** 提取 job 级 if: 表达式（恰好 4 空格缩进；6 空格的 step 级 `if: always()` 不误中） */
function jobIf(block: string): string | null {
  const m = block.match(/^ {4}if:\s*(.+)$/m);
  return m?.[1]?.trim() ?? null;
}

/** 流式列表 `branches: [main, 'dev']` → ['main', 'dev'] */
function flowList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseWorkflow(yml: string): WorkflowCfg {
  const onBlock = blockAfter(yml, 'on') ?? '';
  const hasOnEvent = (e: string) => new RegExp(`^  ${e}:`, 'm').test(onBlock);

  let pushBranches: string[] | null = null;
  const m = onBlock.match(/^  push:\n    branches:\s*\[([^\]]*)\]/m);
  if (m?.[1] != null) pushBranches = flowList(m[1]);

  const jobs: WorkflowCfg['jobs'] = {};
  for (const name of ['unit-and-build', 'e2e-core', 'hotkeys-macos', 'e2e-full', 'smoke-real-sites']) {
    jobs[name] = { if: jobIf(jobBlock(yml, name) ?? '') };
  }

  return {
    on: {
      push: pushBranches ? { branches: pushBranches } : null,
      pull_request: hasOnEvent('pull_request') ? {} : null,
      schedule: hasOnEvent('schedule') ? {} : null,
      workflow_dispatch: hasOnEvent('workflow_dispatch') ? {} : null,
    },
    jobs,
  };
}

/** workflow 级门：该事件是否触发 workflow（push 还需命中 branches 过滤） */
function workflowTriggered(cfg: WorkflowCfg, event: EventName, branch: string | null): boolean {
  if (event === 'push') {
    return cfg.on.push?.branches.includes(branch ?? '') ?? false;
  }
  return cfg.on[event] != null;
}

/** job 级门：if 表达式是否放行该事件（无 if = 恒放行） */
function jobAllows(cfg: WorkflowCfg, event: EventName, jobName: string): boolean {
  const ifExpr = cfg.jobs[jobName]?.if;
  if (ifExpr == null) return true;
  return ifExpr.includes(`'${event}'`);
}

/** Level 内所有 job 都必须同时触发/不触发，行才成立 */
function levelTriggered(cfg: WorkflowCfg, event: EventName, branch: string | null, level: Level): boolean {
  if (!workflowTriggered(cfg, event, branch)) return false;
  return LEVELS[level].every((job) => jobAllows(cfg, event, job));
}

const LEVELS: Record<Level, string[]> = {
  1: ['unit-and-build'],
  2: ['e2e-core', 'hotkeys-macos'],
  3: ['e2e-full', 'smoke-real-sites'],
};

interface TriggerRow {
  event: EventName;
  branch: string | null;
  level: Level;
  expected: boolean;
}

/** 事件 × 分支 × Level → 期望触发。feature 分支推送必须整行不触发（branches 过滤） */
const MATRIX: TriggerRow[] = [
  // 特性分支推送：#112 锁定点 —— branches 过滤被误删时此处变红
  { event: 'push', branch: 'feature/x', level: 1, expected: false },
  { event: 'push', branch: 'feature/x', level: 2, expected: false },
  { event: 'push', branch: 'feature/x', level: 3, expected: false },
  // main 推送
  { event: 'push', branch: 'main', level: 1, expected: true },
  { event: 'push', branch: 'main', level: 2, expected: true },
  { event: 'push', branch: 'main', level: 3, expected: false },
  // PR（Level 3 专属：#112 锁定点 —— 误加 pull_request 时此处变红）
  { event: 'pull_request', branch: 'main', level: 1, expected: true },
  { event: 'pull_request', branch: 'main', level: 2, expected: true },
  { event: 'pull_request', branch: 'main', level: 3, expected: false },
  // 定时
  { event: 'schedule', branch: null, level: 1, expected: true },
  { event: 'schedule', branch: null, level: 2, expected: false },
  { event: 'schedule', branch: null, level: 3, expected: true },
  // 手动
  { event: 'workflow_dispatch', branch: null, level: 1, expected: true },
  { event: 'workflow_dispatch', branch: null, level: 2, expected: false },
  { event: 'workflow_dispatch', branch: null, level: 3, expected: true },
];

describe('CI 工作流触发条件（#96/#112 回归）', () => {
  const cfg = parseWorkflow(readWorkflow());

  test('workflow 级 on.push.branches 恰好 [main]，特性分支推送不触发', () => {
    expect(cfg.on.push?.branches).toEqual(['main']);
  });

  test('workflow 级 on.pull_request 存在（PR 触发）', () => {
    expect(cfg.on.pull_request).not.toBeNull();
  });

  test('Level 3 专属 schedule / workflow_dispatch，不混入 push 或 pull_request', () => {
    for (const job of LEVELS[3]) {
      const cond = cfg.jobs[job]?.if ?? '';
      expect(cond, `${job} 的 if 条件`).toContain('schedule');
      expect(cond, `${job} 的 if 条件`).toContain('workflow_dispatch');
      expect(cond, `${job} 的 if 条件`).not.toContain('push');
      expect(cond, `${job} 的 if 条件`).not.toContain('pull_request');
    }
  });

  test('触发矩阵：事件 × 分支 × Level 逐行锁定', () => {
    for (const row of MATRIX) {
      const actual = levelTriggered(cfg, row.event, row.branch, row.level);
      const jobs = LEVELS[row.level].join('、');
      const branch = row.branch ?? '—';
      expect(actual, `${row.event} @ ${branch} → Level ${row.level}（${jobs}）`).toBe(row.expected);
    }
  });
});
