/**
 * engines/shared.ts — classifyStatus 公共判定 单元测试（#239）
 *
 * 表驱动：状态码 × 各引擎 → 失败类别。自带 key 引擎的 401/403 →
 * invalid-key、429 → quota、其余非 2xx → transient；免 key 引擎一律
 * transient（bing-edge 401 会话失效仍可重试）。
 *
 * #1147：删掉了“请求是否携带 key”参数 —— 所有调用点都传 true，自带 key 引擎
 * 缺 key 时骨架根本不发请求；原先“未携带 key 一律 transient”的用例随之删除。
 */
import { describe, test, expect } from 'vitest';
import { classifyStatus } from '~/src/engines/shared';
import type { FailureCategory } from '~/src/engines/types';

interface Case {
  engineId: string;
  status: number;
  expected: FailureCategory;
}

const KEYED_CASES: Case[] = [
  { engineId: 'openai', status: 401, expected: 'invalid-key' },
  { engineId: 'openai', status: 403, expected: 'invalid-key' },
  { engineId: 'openai', status: 429, expected: 'quota' },
  { engineId: 'openai', status: 500, expected: 'transient' },
  { engineId: 'openai', status: 503, expected: 'transient' },
  { engineId: 'deepl', status: 401, expected: 'invalid-key' },
  { engineId: 'deepl', status: 403, expected: 'invalid-key' },
  { engineId: 'deepl', status: 429, expected: 'quota' },
  { engineId: 'deepl', status: 500, expected: 'transient' },
  { engineId: 'gemini', status: 401, expected: 'invalid-key' },
  { engineId: 'gemini', status: 403, expected: 'invalid-key' },
  { engineId: 'gemini', status: 429, expected: 'quota' },
  { engineId: 'gemini', status: 500, expected: 'transient' },
];

const KEYLESS_CASES: Case[] = [
  { engineId: 'google-web', status: 401, expected: 'transient' },
  { engineId: 'google-web', status: 403, expected: 'transient' },
  { engineId: 'google-web', status: 429, expected: 'transient' },
  { engineId: 'google-web', status: 500, expected: 'transient' },
  // 免 key 引擎的 401 同样瞬时可重试
  { engineId: 'bing-edge', status: 401, expected: 'transient' },
  { engineId: 'bing-edge', status: 403, expected: 'transient' },
  { engineId: 'bing-edge', status: 429, expected: 'transient' },
  { engineId: 'bing-edge', status: 500, expected: 'transient' },
];

describe('classifyStatus 表驱动', () => {
  for (const c of KEYED_CASES) {
    test(`${c.engineId} ${c.status} → ${c.expected}`, () => {
      expect(classifyStatus(c.engineId, { status: c.status })).toBe(
        c.expected,
      );
    });
  }

  for (const c of KEYLESS_CASES) {
    test(`${c.engineId} ${c.status} → ${c.expected}（免 key 引擎）`, () => {
      expect(classifyStatus(c.engineId, { status: c.status })).toBe(
        c.expected,
      );
    });
  }

});
